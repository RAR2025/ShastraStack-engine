// Execution pipeline:
// 1. validate client input vs clientSchema
// 2. apply active adapter rules
// 3. validate transformed request vs known downstreamSchema
// 4. send via Axios with timeout
// 5. validate 2xx responses vs registered responseSchema
// 6-12. classify, diagnose (evidence only), propose structured ops, validate the
// proposal + transformed payload, retry at most once in memory, commit only on
// verified success, else roll back and return a truthful failure.
const axios = require('axios');
const { performance } = require('perf_hooks');
const { query } = require('../db/pool');
const { newExecutionId } = require('../utils/ids');
const registry = require('./toolRegistry');
const { adaptRequest, adaptResponse, applyHeaderOperations } = require('./adapter');
const { classifyFailure } = require('../recovery/errorHandler');
const { diagnose, validateAgainst } = require('../recovery/schemaDiagnoser');
const { planFromDiagnosis } = require('../recovery/patchPlanner');
const { assertProposalValid, commitPatch, recordRollback } = require('../recovery/patchManager');
const { logEvent } = require('./auditLogger');
const { redactSensitive } = require('../utils/redact');

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function redactHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    out[k] = /auth|cookie|token|secret|key/i.test(k) ? '[redacted]' : v;
  }
  return out;
}

function hasIdempotencyProtection(tool, callerHeaders, idempotencyKey) {
  if (IDEMPOTENT_METHODS.has(String(tool.method).toUpperCase())) return true;
  if (idempotencyKey) return true;
  const h = callerHeaders || {};
  const keys = Object.keys(h).map((k) => k.toLowerCase());
  if (keys.includes('x-idempotency-key') || keys.includes('idempotency-key')) return true;
  if (tool.recoveryPolicy && tool.recoveryPolicy.duplicateProtectionMechanism) return true;
  return false;
}

async function sendDownstream({ tool, body, headers, timeoutMs, isGet }) {
  const url = `${tool.baseUrl}${tool.path}`;
  const config = {
    method: tool.method,
    url,
    timeout: timeoutMs,
    headers,
    validateStatus: () => true, // classify manually
  };
  if (isGet) config.params = body;
  else config.data = body;
  const res = await axios(config);
  return res;
}

async function persistExecution(row) {
  await query(
    `INSERT INTO executions
       (execution_id, tool_id, tool_ref, status, classification, patch_operations,
        client_schema_version, downstream_schema_version, adapter_version,
        retry_count, recovery_result, failure_at, duration_ms,
        request_body, downstream_request, downstream_response, response_body, error,
        llm_tokens_baseline, llm_tokens_recovery, token_overhead, finished_at)
     VALUES ($1, NULL, $2, $3, $4, $5::jsonb,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17,
        0, 0, 0, NOW())`,
    [
      row.executionId, row.toolRef, row.status, row.classification || null,
      JSON.stringify(row.patchOperations || []),
      row.clientSchemaVersion ?? null, row.downstreamSchemaVersion ?? null, row.adapterVersion ?? null,
      row.retryCount || 0, row.recoveryResult || null, row.failureAt || null, row.durationMs ?? null,
      JSON.stringify(redactSensitive(row.requestBody ?? null)), JSON.stringify(redactSensitive(row.downstreamRequest ?? null)),
      JSON.stringify(redactSensitive(row.downstreamResponse ?? null)), JSON.stringify(redactSensitive(row.responseBody ?? null)),
      row.error || null,
    ]
  );
}

async function executeTool({ toolId, input, headers = {}, idempotencyKey = null, actor = 'client' }) {
  const started = performance.now();
  const executionId = newExecutionId();
  const tool = await registry.getTool(toolId);
  if (!tool) {
    const err = new Error(`Tool not found: ${toolId}`);
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  const policy = tool.recoveryPolicy || { maxRetries: 1, allowAutomaticPatch: true };
  const maxRetries = policy.maxRetries !== undefined ? policy.maxRetries : 1;
  const activeOps = (tool.adapterRules && tool.adapterRules.operations) || [];
  const elapsed = () => Math.round(performance.now() - started);

  // Exactly-once emission per key within this execution: one request passes
  // through several modules, but each finding is published a single time.
  const emitted = new Set();
  async function emitOnce(key, eventType, data, extra = {}) {
    if (emitted.has(key)) return;
    emitted.add(key);
    try {
      await logEvent({ actor, eventType, toolId, executionRef: executionId, metadata: data || {}, ...extra });
    } catch (_) { /* audit must not break execution responses */ }
  }

  async function finish(row, auditAction) {
    const full = {
      executionId, toolRef: toolId, durationMs: elapsed(),
      clientSchemaVersion: 1, downstreamSchemaVersion: tool.downstreamVersion,
      adapterVersion: tool.version, retryCount: 0, ...row,
    };
    await persistExecution(full);
    // HTTP returns on the execution outcome; audit travels async when configured.
    const terminalType = full.status === 'success' ? 'execution.completed'
      : full.status === 'recovered' ? 'recovery.completed'
      : (full.retryCount > 0 || (full.patchOperations || []).length > 0) ? 'recovery.failed'
      : 'execution.failed';
    try {
      await logEvent({
        actor, action: auditAction, entity: 'execution', entity_id: executionId,
        eventType: terminalType,
        severity: full.status === 'client_error' ? 'warn' : undefined,
        toolId,
        metadata: {
          toolId, status: full.status, classification: full.classification,
          recoveryResult: full.recoveryResult, retryCount: full.retryCount,
          durationMs: full.durationMs,
          patchOpCount: (full.patchOperations || []).length,
        },
        executionRef: executionId,
      });
    } catch (_) { /* audit must not break execution responses */ }
    return full;
  }

  await emitOnce('started', 'execution.started', { toolId, method: tool.method, path: tool.path });

  // --- 1. client validation ---
  const clientCheck = validateAgainst(tool.clientSchema, input);
  if (!clientCheck.valid) {
    const rec = await finish({
      status: 'client_error', classification: 'USER_INPUT_ERROR', failureAt: 'client_validation',
      requestBody: input, error: 'Client input failed clientSchema validation.',
    }, 'execution.client_error');
    return {
      executionId, status: 'client_error', classification: 'USER_INPUT_ERROR',
      error: 'Invalid client input.', details: clientCheck.errors,
      durationMs: rec.durationMs,
    };
  }

  // --- 2. adapt ---
  let adapted;
  try {
    adapted = adaptRequest(input, activeOps, []);
  } catch (err) {
    const rec = await finish({
      status: 'failed', classification: 'ADAPTER_ERROR', failureAt: 'adapt',
      requestBody: input, error: err.message,
    }, 'execution.failed');
    return { executionId, status: 'failed', classification: 'ADAPTER_ERROR', error: err.message, durationMs: rec.durationMs };
  }

  // --- 3. request validation vs known downstream schema ---
  // Pre-send diagnosis runs ONLY when no adapter is active. A committed adapter
  // is trusted: its output may legitimately differ from the stale known schema
  // (that difference IS the healed drift), so it must be sent and judged by
  // downstream evidence, not "repaired" back to the old shape.
  const reqCheck = validateAgainst(tool.downstreamSchema, adapted);
  let candidate = null; // { operations, diagnosis }
  if (!reqCheck.valid && activeOps.length > 0) {
    try {
      await logEvent({
        actor, action: 'execution.adapter_bypass', entity: 'execution', entity_id: executionId,
        metadata: { toolId, reason: 'Active adapter output differs from stale known schema; sending for downstream verdict.' },
        executionRef: executionId,
      });
    } catch (_) { /* ignore */ }
  }
  if (!reqCheck.valid && activeOps.length === 0) {
    const classification = classifyFailure({ stage: 'request_validation', ajvErrors: reqCheck.errors });
    const diagnosis = diagnose({
      scope: 'request', knownSchema: tool.downstreamSchema, actual: adapted,
      ajvErrors: reqCheck.errors, httpStatus: 0, httpBody: null,
    });
    if (!policy.allowAutomaticPatch || maxRetries < 1) {
      const rec = await finish({
        status: 'failed', classification: classification.category, failureAt: 'request_validation',
        requestBody: input, downstreamRequest: adapted, error: 'Adapted request failed downstream schema and auto-patch is disabled.',
      }, 'execution.failed');
      return { executionId, status: 'failed', classification: classification.category, error: rec.error, details: reqCheck.errors, durationMs: rec.durationMs };
    }
    const proposal = planFromDiagnosis({ ...diagnosis, evidence: { ...diagnosis.evidence, scope: 'request' } }, tool);
    if (!proposal.supported) {
      await emitOnce('rejected-request-validation', 'patch.rejected', { reason: proposal.reason, scope: 'request' });
      await recordRollback({
        toolId, executionRef: executionId, diagnosis, operations: [],
        downstreamVersion: tool.downstreamVersion,
        error: proposal.reason,
      });
      const rec = await finish({
        status: 'failed', classification: 'SCHEMA_DRIFT_AMBIGUOUS', failureAt: 'request_validation',
        requestBody: input, downstreamRequest: adapted,
        error: `Supported drift diagnosis unavailable: ${proposal.reason}`,
      }, 'execution.failed');
      return { executionId, status: 'failed', classification: 'SCHEMA_DRIFT_AMBIGUOUS', error: rec.error, durationMs: rec.durationMs };
    }
    // Validate proposal + dry-run transformed payload before any retry.
    assertProposalValid(proposal.operations);
    const dryRun = adaptRequest(input, activeOps, proposal.operations);
    const dryCheck = validateAgainst(tool.downstreamSchema, dryRun);
    if (!dryCheck.valid) {
      await recordRollback({
        toolId, executionRef: executionId, diagnosis, operations: proposal.operations,
        downstreamVersion: tool.downstreamVersion, error: 'Candidate adapter still fails downstream schema.',
      });
      const rec = await finish({
        status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', failureAt: 'request_validation',
        requestBody: input, downstreamRequest: adapted, error: 'Candidate patch failed validation; rolled back.',
      }, 'execution.failed');
      return { executionId, status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', error: rec.error, details: dryCheck.errors, durationMs: rec.durationMs };
    }
    candidate = { operations: proposal.operations, diagnosis };
    await emitOnce('drift-request-validation', 'schema.drift_detected', {
      kind: diagnosis.kind, scope: 'request', opCount: proposal.operations.length,
    });
    adapted = dryRun; // verified candidate applied in memory
  }

  // --- headers (static config + candidate ADD_HEADER + safe caller headers) ---
  const callerSafe = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (/^(authorization|cookie|set-cookie)$/i.test(k)) continue; // never accept secrets via execute headers
    if (typeof v === 'string') callerSafe[k] = v;
  }
  const candidateHeaderOps = candidate ? candidate.operations.filter((o) => o.op === 'ADD_HEADER') : [];
  const activeHeaderOps = activeOps.filter((o) => o.op === 'ADD_HEADER');
  const outHeaders = {
    'content-type': 'application/json',
    ...(tool.headers || {}),
    ...applyHeaderOperations({}, [...activeHeaderOps, ...candidateHeaderOps]),
    ...callerSafe,
  };

  // --- 4. send (+ single retry only when a verified candidate exists) ---
  const isGet = String(tool.method).toUpperCase() === 'GET';
  const attempts = candidate && maxRetries >= 1 ? 2 : 1;
  // Non-idempotent writes must not be resent without duplicate protection.
  const mayResend = hasIdempotencyProtection(tool, headers, idempotencyKey);
  let res;
  let retryCount = 0;
  try {
    res = await sendDownstream({ tool, body: adapted, headers: outHeaders, timeoutMs: tool.timeoutMs, isGet });
    if (candidate && attempts === 1) {
      // Candidate existed but policy forbids the resend (unreachable: candidate
      // path already validated in-memory, single send below still proceeds).
    }
  } catch (err) {
    const axiosCode = err.code || '';
    const classification = classifyFailure({ stage: 'downstream', httpStatus: 0, axiosCode, axiosMessage: err.message });
    if (candidate) {
      await recordRollback({
        toolId, executionRef: executionId, diagnosis: candidate.diagnosis, operations: candidate.operations,
        downstreamVersion: tool.downstreamVersion, error: `Retry transport failed: ${err.message}`,
      });
    }
    const rec = await finish({
      status: 'failed', classification: classification.category, failureAt: 'downstream',
      requestBody: input, downstreamRequest: adapted, retryCount,
      error: classification.reason,
    }, 'execution.failed');
    return { executionId, status: 'failed', classification: classification.category, error: rec.error, durationMs: rec.durationMs };
  }

  // --- 5+. classify HTTP outcome ---
  const status = res.status;
  const responseBody = res.data === undefined ? null : res.data;

  async function commitCandidateAndFinish(extra) {
    const { patchId, tool: updated } = await commitPatch({
      toolId, operations: candidate.operations, executionRef: executionId,
      diagnosis: candidate.diagnosis, expectedVersion: tool.version,
      downstreamVersion: tool.downstreamVersion,
    });
    const rec = await finish({
      status: 'recovered', classification: 'SCHEMA_DRIFT', recoveryResult: 'recovered',
      patchOperations: candidate.operations, retryCount,
      adapterVersion: updated.version,
      requestBody: input, downstreamRequest: adapted,
      downstreamResponse: responseBody, responseBody: extra.responseBody ?? responseBody,
      ...extra,
    }, 'execution.recovered');
    return {
      executionId, status: 'recovered', classification: 'SCHEMA_DRIFT',
      data: extra.responseBody ?? responseBody,
      recovery: { patchId, operations: candidate.operations, retryCount, adapterVersion: updated.version },
      durationMs: rec.durationMs,
    };
  }

  if (status >= 200 && status < 300) {
    // Validate response vs registered responseSchema.
    const respCheck = validateAgainst(tool.responseSchema, responseBody);
    if (respCheck.valid) {
      if (candidate) {
        // Request-side candidate verified by this 2xx: commit.
        return commitCandidateAndFinish({});
      }
      const rec = await finish({
        status: 'success', classification: null, recoveryResult: 'none',
        requestBody: input, downstreamRequest: adapted,
        downstreamResponse: responseBody, responseBody,
      }, 'execution.success');
      return { executionId, status: 'success', data: responseBody, durationMs: rec.durationMs, retryCount: 0 };
    }
    // Response drift: adapt the payload locally (no resend → no idempotency risk).
    if (!policy.allowAutomaticPatch) {
      const rec = await finish({
        status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', failureAt: 'response_validation',
        requestBody: input, downstreamRequest: adapted, downstreamResponse: responseBody,
        error: 'Response failed responseSchema and auto-patch is disabled.',
      }, 'execution.failed');
      return { executionId, status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', error: rec.error, details: respCheck.errors, durationMs: rec.durationMs };
    }
    const diagnosis = diagnose({
      scope: 'response', knownSchema: tool.responseSchema, actual: responseBody,
      ajvErrors: respCheck.errors, httpStatus: status, httpBody: responseBody,
    });
    const proposal = planFromDiagnosis({ ...diagnosis, evidence: { ...diagnosis.evidence, scope: 'response' } }, tool);
    if (!proposal.supported) {
      await emitOnce('rejected-response', 'patch.rejected', { reason: proposal.reason, scope: 'response' });
      await recordRollback({
        toolId, executionRef: executionId, diagnosis, operations: [],
        downstreamVersion: tool.downstreamVersion, error: proposal.reason,
      });
      const rec = await finish({
        status: 'failed', classification: 'SCHEMA_DRIFT_AMBIGUOUS', failureAt: 'response_validation',
        requestBody: input, downstreamRequest: adapted, downstreamResponse: responseBody,
        error: `Response drift ambiguous: ${proposal.reason}`,
      }, 'execution.failed');
      return { executionId, status: 'failed', classification: 'SCHEMA_DRIFT_AMBIGUOUS', error: rec.error, durationMs: rec.durationMs };
    }
    assertProposalValid(proposal.operations);
    await emitOnce('drift-response', 'schema.drift_detected', {
      kind: diagnosis.kind, scope: 'response', opCount: proposal.operations.length,
    });
    const adaptedResp = adaptResponse(responseBody, activeOps, proposal.operations);
    const recheck = validateAgainst(tool.responseSchema, adaptedResp);
    if (!recheck.valid) {
      await recordRollback({
        toolId, executionRef: executionId, diagnosis, operations: proposal.operations,
        downstreamVersion: tool.downstreamVersion, error: 'Response candidate still fails responseSchema.',
      });
      const rec = await finish({
        status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', failureAt: 'response_validation',
        requestBody: input, downstreamRequest: adapted, downstreamResponse: responseBody,
        error: 'Response patch failed validation; rolled back.',
      }, 'execution.failed');
      return { executionId, status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', error: rec.error, details: recheck.errors, durationMs: rec.durationMs };
    }
    // Commit response-side ops (merge with any request candidate).
    const mergedOps = [...(candidate ? candidate.operations : []), ...proposal.operations];
    const mergedDiagnosis = candidate
      ? { kind: 'combined', evidence: { request: candidate.diagnosis, response: diagnosis } }
      : diagnosis;
    const { patchId, tool: updated } = await commitPatch({
      toolId, operations: mergedOps, executionRef: executionId,
      diagnosis: mergedDiagnosis, expectedVersion: tool.version,
      downstreamVersion: tool.downstreamVersion,
    });
    const rec = await finish({
      status: 'recovered', classification: 'SCHEMA_DRIFT', recoveryResult: 'recovered',
      patchOperations: mergedOps, retryCount, adapterVersion: updated.version,
      requestBody: input, downstreamRequest: adapted,
      downstreamResponse: responseBody, responseBody: adaptedResp,
    }, 'execution.recovered');
    return {
      executionId, status: 'recovered', classification: 'SCHEMA_DRIFT', data: adaptedResp,
      recovery: { patchId, operations: mergedOps, retryCount, adapterVersion: updated.version },
      durationMs: rec.durationMs,
    };
  }

  // Non-2xx: classify first; only drift candidates proceed.
  const classification = classifyFailure({
    stage: 'downstream', httpStatus: status, httpBody: responseBody, httpHeaders: res.headers || {},
  });
  if (classification.category === 'RATE_LIMITED') {
    const rec = await finish({
      status: 'failed', classification: 'RATE_LIMITED', failureAt: 'downstream',
      requestBody: input, downstreamRequest: adapted, downstreamResponse: responseBody,
      error: classification.retryAfterMs
        ? `Downstream rate limited; retry after ${Math.round(classification.retryAfterMs / 1000)}s (not auto-retried).`
        : 'Downstream rate limited (not auto-retried).',
    }, 'execution.failed');
    return {
      executionId, status: 'failed', classification: 'RATE_LIMITED',
      error: rec.error, downstreamStatus: status, retryAfterMs: classification.retryAfterMs || null,
      durationMs: rec.durationMs,
    };
  }
  if (!classification.patchable) {
    if (candidate) {
      await recordRollback({
        toolId, executionRef: executionId, diagnosis: candidate.diagnosis, operations: candidate.operations,
        downstreamVersion: tool.downstreamVersion,
        error: `Downstream ${status}: ${classification.reason}`,
      });
    }
    const rec = await finish({
      status: 'failed', classification: classification.category, failureAt: 'downstream',
      requestBody: input, downstreamRequest: adapted, downstreamResponse: responseBody,
      error: classification.reason,
    }, 'execution.failed');
    return {
      executionId, status: 'failed', classification: classification.category,
      error: rec.error, downstreamStatus: status, downstreamBody: responseBody,
      durationMs: rec.durationMs,
    };
  }

  // Drift candidate from HTTP error: diagnose with downstream evidence.
  if (!policy.allowAutomaticPatch || maxRetries < 1) {
    const rec = await finish({
      status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', failureAt: 'downstream',
      requestBody: input, downstreamRequest: adapted, downstreamResponse: responseBody,
      error: 'Likely schema drift but automatic patching is disabled by policy.',
    }, 'execution.failed');
    return { executionId, status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', error: rec.error, downstreamStatus: status, durationMs: rec.durationMs };
  }
  // Validate the error payload against downstream request schema for ajv evidence.
  const errAjv = validateAgainst(tool.downstreamSchema, adapted);
  const diagnosis = diagnose({
    scope: 'request', knownSchema: tool.downstreamSchema, actual: adapted,
    ajvErrors: errAjv.errors, httpStatus: status, httpBody: responseBody,
  });
  const proposal = planFromDiagnosis({ ...diagnosis, evidence: { ...diagnosis.evidence, scope: 'request' } }, tool);
  // Dedupe: never recommit operations the active adapter already contains.
  const freshOps = (proposal.operations || []).filter(
    (op) => !activeOps.some((a) => JSON.stringify(a) === JSON.stringify(op))
  );
  if (!proposal.supported || freshOps.length === 0) {
    const reason = proposal.supported
      ? 'Drift already covered by the active adapter; a further change needs an informed schema update, not another blind patch.'
      : proposal.reason;
    await emitOnce('rejected-downstream', 'patch.rejected', { reason, scope: 'request' });
    await recordRollback({
      toolId, executionRef: executionId, diagnosis, operations: [],
      downstreamVersion: tool.downstreamVersion, error: reason,
    });
    const rec = await finish({
      status: 'failed', classification: 'SCHEMA_DRIFT_AMBIGUOUS', failureAt: 'downstream',
      requestBody: input, downstreamRequest: adapted, downstreamResponse: responseBody,
      error: `Drift diagnosis ambiguous: ${reason}`,
    }, 'execution.failed');
    return {
      executionId, status: 'failed', classification: 'SCHEMA_DRIFT_AMBIGUOUS',
      error: rec.error, downstreamStatus: status, downstreamBody: responseBody, durationMs: rec.durationMs,
    };
  }
  proposal.operations = freshOps;
  assertProposalValid(proposal.operations);
  await emitOnce('drift-downstream', 'schema.drift_detected', {
    kind: diagnosis.kind, scope: 'request', opCount: proposal.operations.length, downstreamStatus: status,
  });
  if (!mayResend) {
    await recordRollback({
      toolId, executionRef: executionId, diagnosis, operations: proposal.operations,
      downstreamVersion: tool.downstreamVersion,
      error: 'Non-idempotent write without idempotency key; refusing blind retry.',
    });
    const rec = await finish({
      status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', failureAt: 'downstream',
      requestBody: input, downstreamRequest: adapted, downstreamResponse: responseBody,
      error: 'Likely drift but retry would risk duplicate side effects (supply x-idempotency-key). Patch rolled back.',
    }, 'execution.failed');
    return { executionId, status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', error: rec.error, downstreamStatus: status, durationMs: rec.durationMs };
  }
  // Single retry in memory. NOTE: the retry payload is intentionally NOT validated
  // against the known downstream schema here — in blind mode that schema is
  // stale (that is the drift), so the old contract cannot judge the new shape.
  // Verification comes from the retry outcome + response-schema validation below.
  const retryBody = adaptRequest(input, activeOps, proposal.operations);
  const retryHeaders = {
    ...outHeaders,
    ...applyHeaderOperations({}, proposal.operations.filter((o) => o.op === 'ADD_HEADER')),
  };
  let retryRes;
  try {
    await emitOnce('retry', 'execution.retry_attempted', { attempt: 1, idempotent: mayResend });
    retryRes = await sendDownstream({ tool, body: retryBody, headers: retryHeaders, timeoutMs: tool.timeoutMs, isGet });
    retryCount = 1;
  } catch (err) {
    await recordRollback({
      toolId, executionRef: executionId, diagnosis, operations: proposal.operations,
      downstreamVersion: tool.downstreamVersion, error: `Retry transport failed: ${err.message}`,
    });
    const rec = await finish({
      status: 'failed', classification: 'NETWORK_ERROR', failureAt: 'retry',
      requestBody: input, downstreamRequest: retryBody, retryCount: 0, error: err.message,
    }, 'execution.failed');
    return { executionId, status: 'failed', classification: 'NETWORK_ERROR', error: rec.error, durationMs: rec.durationMs };
  }
  if (retryRes.status >= 200 && retryRes.status < 300) {
    const retryRespCheck = validateAgainst(tool.responseSchema, retryRes.data);
    if (retryRespCheck.valid) {
      const { patchId, tool: updated } = await commitPatch({
        toolId, operations: proposal.operations, executionRef: executionId,
        diagnosis, expectedVersion: tool.version, downstreamVersion: tool.downstreamVersion,
      });
      const rec = await finish({
        status: 'recovered', classification: 'SCHEMA_DRIFT', recoveryResult: 'recovered',
        patchOperations: proposal.operations, retryCount: 1, adapterVersion: updated.version,
        requestBody: input, downstreamRequest: retryBody,
        downstreamResponse: retryRes.data, responseBody: retryRes.data,
      }, 'execution.recovered');
      return {
        executionId, status: 'recovered', classification: 'SCHEMA_DRIFT', data: retryRes.data,
        recovery: { patchId, operations: proposal.operations, retryCount: 1, adapterVersion: updated.version },
        durationMs: rec.durationMs,
      };
    }
  }
  await recordRollback({
    toolId, executionRef: executionId, diagnosis, operations: proposal.operations,
    downstreamVersion: tool.downstreamVersion,
    error: `Retry returned ${retryRes.status}; recovery not verified.`,
  });
  const rec = await finish({
    status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED', failureAt: 'retry',
    requestBody: input, downstreamRequest: retryBody, downstreamResponse: retryRes.data,
    retryCount: 1, error: `Retry did not verify recovery (status ${retryRes.status}); rolled back.`,
  }, 'execution.failed');
  return {
    executionId, status: 'failed', classification: 'SCHEMA_DRIFT_UNRECOVERED',
    error: rec.error, downstreamStatus: retryRes.status, downstreamBody: retryRes.data,
    durationMs: rec.durationMs,
  };
}

module.exports = { executeTool, _redactHeaders: redactHeaders };
