// Reusable RabbitMQ publisher for structured audit events.
// Guarantees: durable exchange + durable queue, persistent messages, publisher
// confirms, bounded reconnect backoff, bounded in-flight (backpressure overflows
// to the durable PG outbox instead of memory), graceful shutdown.
//
// Dead-letter policy (declared here, shared with the worker):
//   main queue --(x-dead-letter-exchange)--> DLX exchange --(routing key = log
//   queue name)--> DLQ. DLQ is durable with no TTL and manual retention: operators
//   inspect via the management UI (:15672) and purge after triage. Failed events
//   are never silently dropped — they land in the DLQ or stay in the outbox.
const { logger, logLocal } = require('./logger');
const { assertValidEvent } = require('./logEventSchema');
const { isCritical } = require('./eventTypes');
const outbox = require('./outbox');

const MAX_INFLIGHT = 500;
const CONFIRM_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 5000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 30000;
const DRAIN_INTERVAL_MS = 30000;
const DRAIN_BATCH = 100;

function config() {
  return {
    url: process.env.RABBITMQ_URL || 'amqp://shastra:change_me_local_only@localhost:5672',
    exchange: process.env.RABBITMQ_LOG_EXCHANGE || 'shastrastack.logs',
    queue: process.env.RABBITMQ_LOG_QUEUE || 'shastrastack.logs',
  };
}

function topology() {
  const { exchange, queue } = config();
  return {
    exchange,
    queue,
    routingKey: queue,
    dlxExchange: `${exchange}.dlx`,
    dlq: `${queue}.dlq`,
  };
}

const state = {
  connection: null,
  channel: null,
  connecting: null,
  inFlight: 0,
  backoffMs: BACKOFF_BASE_MS,
  drainTimer: null,
  closed: false,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureTopology(channel) {
  const t = topology();
  await channel.assertExchange(t.exchange, 'direct', { durable: true });
  await channel.assertExchange(t.dlxExchange, 'direct', { durable: true });
  await channel.assertQueue(t.dlq, { durable: true });
  await channel.bindQueue(t.dlq, t.dlxExchange, t.routingKey);
  await channel.assertQueue(t.queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': t.dlxExchange },
  });
  await channel.bindQueue(t.queue, t.exchange, t.routingKey);
  return t;
}

async function connectOnce() {
  // Late require keeps unit tests (no broker) free of connection side effects.
  const amqp = require('amqplib');
  const { url } = config();
  const connection = await amqp.connect(url, { timeout: CONNECT_TIMEOUT_MS });
  connection.on('error', (err) => {
    logger.warn({ err: err && err.message }, 'RabbitMQ connection error');
    handleDisconnect();
  });
  connection.on('close', () => handleDisconnect());
  const channel = await connection.createConfirmChannel();
  const t = await ensureTopology(channel);
  channel.on('error', () => handleDisconnect());
  channel.on('close', () => handleDisconnect());
  state.connection = connection;
  state.channel = channel;
  state.backoffMs = BACKOFF_BASE_MS;
  logLocal('info', {
    eventId: `conn-${Date.now()}`, eventType: 'execution.completed', timestamp: new Date().toISOString(),
    severity: 'info', data: { message: 'RabbitMQ publisher connected', exchange: t.exchange, queue: t.queue },
  });
  scheduleDrain();
  return channel;
}

function handleDisconnect() {
  if (state.channel) { try { state.channel.removeAllListeners(); } catch (_) { /* ignore */ } }
  state.channel = null;
  if (state.connection) { try { state.connection.removeAllListeners(); } catch (_) { /* ignore */ } }
  state.connection = null;
}

async function ensureChannel() {
  if (state.closed) throw new Error('Publisher is shut down');
  if (state.channel) return state.channel;
  if (!state.connecting) {
    state.connecting = connectOnce().finally(() => { state.connecting = null; });
  }
  return state.connecting;
}

function publishConfirmed(channel, exchange, routingKey, body) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Publisher confirm timed out')), CONFIRM_TIMEOUT_MS);
    channel.publish(exchange, routingKey, Buffer.from(body), { persistent: true }, (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(true);
    });
  });
}

// Durable fallback: the event survives in PostgreSQL and is republished later.
// Throws only when the outbox itself is unreachable AND the event is critical.
async function fallbackToOutbox(event, cause) {
  try {
    await outbox.insertOutbox(event);
    return { transport: 'outbox', eventId: event.eventId, durable: true, reason: cause };
  } catch (outboxErr) {
    if (isCritical(event.eventType, event.severity)) {
      const err = new Error(`Critical audit event could not be stored: ${outboxErr.message}`);
      err.code = 'AUDIT_DURABILITY_FAILED';
      throw err;
    }
    logLocal('error', {
      eventId: event.eventId, eventType: event.eventType, timestamp: event.timestamp,
      severity: 'error', data: { message: 'Audit event dropped: broker and outbox unreachable', cause },
    });
    return { transport: 'dropped', eventId: event.eventId, durable: false, reason: cause };
  }
}

async function publishEvent(event, { critical } = {}) {
  assertValidEvent(event);
  const isCrit = critical !== undefined ? critical : isCritical(event.eventType, event.severity);
  if (state.inFlight >= MAX_INFLIGHT) {
    // Backpressure: bounded memory — overflow goes to the durable outbox.
    return fallbackToOutbox(event, 'publisher saturated (backpressure)');
  }
  state.inFlight += 1;
  try {
    const channel = await ensureChannel();
    const t = topology();
    await publishConfirmed(channel, t.exchange, t.routingKey, JSON.stringify(event));
    // NOTE: transport success is NOT durability — the event is durably audited
    // only after the consumer persists it (see trace/audit endpoints).
    return { transport: 'rabbitmq', eventId: event.eventId, durable: false };
  } catch (err) {
    handleDisconnect();
    scheduleReconnect();
    return fallbackToOutbox(event, err.message);
  } finally {
    state.inFlight = Math.max(0, state.inFlight - 1);
  }
}

let reconnectScheduled = false;
function scheduleReconnect() {
  if (reconnectScheduled || state.closed) return;
  reconnectScheduled = true;
  const delay = Math.min(state.backoffMs, BACKOFF_CAP_MS);
  state.backoffMs = Math.min(state.backoffMs * 2, BACKOFF_CAP_MS);
  setTimeout(() => {
    reconnectScheduled = false;
    if (state.closed || state.channel) return;
    ensureChannel()
      .then(() => drainOutbox())
      .catch(() => scheduleReconnect()); // bounded backoff continues in background
  }, delay).unref();
}

let drainScheduled = false;
function scheduleDrain() {
  if (drainScheduled || state.closed) return;
  drainScheduled = true;
  state.drainTimer = setInterval(() => {
    drainOutbox().catch((err) => logLocal('warn', {
      eventId: `drain-${Date.now()}`, eventType: 'execution.failed', timestamp: new Date().toISOString(),
      severity: 'warn', data: { message: `Outbox drain failed: ${err.message}` },
    }));
  }, DRAIN_INTERVAL_MS);
  if (state.drainTimer.unref) state.drainTimer.unref();
}

async function drainOutbox(batch = DRAIN_BATCH) {
  let channel;
  try {
    channel = await ensureChannel();
  } catch (_) {
    return { drained: 0, reason: 'broker unavailable' };
  }
  const t = topology();
  const rows = await outbox.claimDueOutbox(batch);
  let drained = 0;
  for (const row of rows) {
    try {
      const event = typeof row.event === 'string' ? JSON.parse(row.event) : row.event;
      assertValidEvent(event);
      // eslint-disable-next-line no-await-in-loop
      await publishConfirmed(channel, t.exchange, t.routingKey, JSON.stringify(event));
      // eslint-disable-next-line no-await-in-loop
      await outbox.markOutboxSent(row.id);
      drained += 1;
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await outbox.markOutboxFailed(row.id, err).catch(() => {});
      handleDisconnect();
      scheduleReconnect();
      break;
    }
  }
  return { drained };
}

async function close() {
  state.closed = true;
  if (state.drainTimer) clearInterval(state.drainTimer);
  const deadline = Date.now() + 5000;
  while (state.inFlight > 0 && Date.now() < deadline) await sleep(100); // eslint-disable-line no-await-in-loop
  try { if (state.channel) await state.channel.close(); } catch (_) { /* ignore */ }
  try { if (state.connection) await state.connection.close(); } catch (_) { /* ignore */ }
  state.channel = null;
  state.connection = null;
}

function _resetForTests() {
  state.connection = null;
  state.channel = null;
  state.connecting = null;
  state.inFlight = 0;
  state.backoffMs = BACKOFF_BASE_MS;
  state.closed = false;
  reconnectScheduled = false;
  if (state.drainTimer) clearInterval(state.drainTimer);
  state.drainTimer = null;
  drainScheduled = false;
}

module.exports = {
  config, topology, publishEvent, drainOutbox, scheduleDrain, close,
  MAX_INFLIGHT, _resetForTests, _state: state,
};
