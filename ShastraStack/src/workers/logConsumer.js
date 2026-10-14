// Log consumer worker (separate process from the Express engine).
// Pipeline: RabbitMQ durable queue -> validate envelope -> PG transaction ->
// parameterized INSERT (idempotent via event_id) -> COMMIT -> ack.
// Failure policy: invalid events go straight to the DLQ (nack, no requeue);
// transient DB failures retry up to MAX_ATTEMPTS via re-publish with an
// x-attempts header, then DLQ. Redelivered originals are acked once the copy
// is queued, so nothing loops forever. Duplicate deliveries are absorbed by
// INSERT ... ON CONFLICT (event_id) DO NOTHING.
//
// Run: npm run worker  (dev: npm run dev:worker)
require('dotenv').config();
const pino = require('pino');
const { pool } = require('../db/pool');
const { assertValidEvent } = require('../logging/logEventSchema');
const { topology } = require('../logging/rabbitmqPublisher');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PREFETCH = Math.min(Math.max(Number(process.env.RABBITMQ_PREFETCH || 10), 1), 1000);
const MAX_ATTEMPTS = 5;
const ATTEMPT_HEADER = 'x-attempts';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseEvent(content) {
  let parsed;
  try {
    parsed = JSON.parse(content.toString('utf8'));
  } catch (_) {
    const err = new Error('Message body is not valid JSON');
    err.code = 'INVALID_LOG_EVENT';
    throw err;
  }
  assertValidEvent(parsed);
  return parsed;
}

function attemptsOf(msg) {
  const raw = msg.properties && msg.properties.headers && msg.properties.headers[ATTEMPT_HEADER];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

// Pure decision helper (unit-testable without a broker):
// 'persist' | 'dlq'  + attempts bookkeeping is done by the caller.
function classifyFailure(kind) {
  if (kind === 'invalid') return { action: 'dlq', reason: 'envelope validation failed' };
  return { action: 'retry-or-dlq' };
}

async function persistEvent(client, event) {
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO audit_events
         (event_id, event_type, severity, occurred_at, actor, action, entity, entity_id, metadata, execution_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.eventId,
        event.eventType,
        event.severity,
        event.timestamp,
        event.actor || 'system',
        event.eventType,
        (event.data && event.data.entity) || '',
        (event.data && (event.data.entityId || event.data.toolId)) || event.executionId || '',
        JSON.stringify(event.data || {}),
        event.executionId || null,
      ]
    );
    await client.query('COMMIT');
    return { stored: true };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

async function processMessage(channel, msg, t) {
  if (!msg) return { action: 'none' };
  const attempts = attemptsOf(msg);
  let event;
  try {
    event = parseEvent(msg.content);
  } catch (err) {
    logger.warn({ err: err.message }, 'Invalid log event; routing to DLQ without requeue');
    channel.nack(msg, false, false); // DLX routes it to the DLQ
    return { action: 'dlq', reason: err.message };
  }
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    return handlePersistFailure(channel, msg, t, event, err, attempts);
  }
  try {
    await persistEvent(client, event);
    channel.ack(msg);
    return { action: 'persisted', eventId: event.eventId, duplicate: false };
  } catch (err) {
    return handlePersistFailure(channel, msg, t, event, err, attempts);
  } finally {
    try { if (client) client.release(); } catch (_) { /* ignore */ }
  }
}

function handlePersistFailure(channel, msg, t, event, err, attempts) {
  logger.warn({ err: err.message, eventId: event.eventId, attempts }, 'Persistence failed');
  if (attempts + 1 >= MAX_ATTEMPTS) {
    channel.nack(msg, false, false); // DLQ for inspection
    return { action: 'dlq', eventId: event.eventId, reason: err.message };
  }
  // Controlled retry: re-publish with bumped attempts, ack the original.
  try {
    channel.publish(t.exchange, t.routingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      headers: { ...(msg.properties.headers || {}), [ATTEMPT_HEADER]: attempts + 1 },
    });
    channel.ack(msg);
    return { action: 'requeued', eventId: event.eventId, attempts: attempts + 1 };
  } catch (pubErr) {
    try { channel.nack(msg, false, true); } catch (_) { /* ignore */ }
    return { action: 'requeued-broker', eventId: event.eventId, reason: pubErr.message };
  }
}

async function declareTopology(channel) {
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

async function run() {
  const amqp = require('amqplib');
  const url = process.env.RABBITMQ_URL || 'amqp://shastra:change_me_local_only@localhost:5672';
  let stopped = false;
  const shutdown = async () => {
    stopped = true;
    try { await channel.cancel(consumerTag); } catch (_) { /* ignore */ }
    try { await channel.close(); } catch (_) { /* ignore */ }
    try { await connection.close(); } catch (_) { /* ignore */ }
    try { await pool.end(); } catch (_) { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let connection;
  let channel;
  let consumerTag = null;
  for (let attempt = 1; !stopped; attempt += 1) {
    try {
      connection = await amqp.connect(url, { timeout: 5000 });
      channel = await connection.createChannel();
      await channel.prefetch(PREFETCH);
      const t = await declareTopology(channel);
      const { consumerTag: tag } = await channel.consume(t.queue, (msg) => {
        processMessage(channel, msg, t).catch((err) =>
          logger.error({ err: err.message }, 'processMessage crashed')
        );
      });
      consumerTag = tag;
      logger.info({ queue: t.queue, prefetch: PREFETCH }, 'Log consumer worker started');
      await new Promise((resolve) => {
        connection.on('close', resolve);
        channel.on('close', resolve);
      });
      logger.warn('Broker connection closed; reconnecting with backoff');
    } catch (err) {
      logger.warn({ err: err.message, attempt }, 'Worker connect/consume failed');
    }
    if (stopped) break;
    await sleep(Math.min(500 * 2 ** Math.min(attempt, 6), 30000));
  }
}

if (require.main === module) {
  run().catch((err) => {
    logger.error({ err: err.message }, 'Worker fatal');
    process.exit(1);
  });
}

module.exports = { run, processMessage, persistEvent, parseEvent, classifyFailure, attemptsOf, MAX_ATTEMPTS };
