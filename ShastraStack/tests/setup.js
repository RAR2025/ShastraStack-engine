// Isolated test harness. NEVER touches the development database:
// refuses to run unless DATABASE_URL points at a *test* database,
// then migrates + truncates ONLY that database.
const fs = require('fs');
const path = require('path');

const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://shastra:shastra_pw@localhost:5432/shastrastack_test';

function ensureTestEnv() {
  // Deterministic audit path for tests: direct PostgreSQL inserts, no broker.
  if (!process.env.LOG_TRANSPORT) process.env.LOG_TRANSPORT = 'sync';
  if (process.env.DATABASE_URL && !/test/i.test(process.env.DATABASE_URL)) {
    throw new Error(
      `Refusing to run tests against non-test database: ${process.env.DATABASE_URL}`
    );
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL || TEST_URL;
  if (!/test/i.test(process.env.DATABASE_URL)) {
    throw new Error(`Test DATABASE_URL must contain "test": ${process.env.DATABASE_URL}`);
  }
}

async function migrateTestDb() {
  ensureTestEnv();
  const { pool } = require('../src/db/pool');
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query(sql);
  }
}

async function truncateAll() {
  ensureTestEnv();
  if (!/test/i.test(process.env.DATABASE_URL)) {
    throw new Error('Refusing destructive cleanup on a non-test database');
  }
  const { pool } = require('../src/db/pool');
  await pool.query(
    'TRUNCATE tool_registrations, executions, patch_history, audit_events, outbox_events RESTART IDENTITY CASCADE'
  );
  const registry = require('../src/services/toolRegistry');
  registry._clearCacheForTests();
}

async function closePool() {
  const { pool } = require('../src/db/pool');
  await pool.end();
}

module.exports = { ensureTestEnv, migrateTestDb, truncateAll, closePool, TEST_URL };
