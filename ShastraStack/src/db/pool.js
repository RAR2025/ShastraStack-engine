const { Pool } = require('pg');
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const connectionString = process.env.DATABASE_URL || null;

const pool = new Pool(
  connectionString
    ? { connectionString }
    : {
        user: process.env.POSTGRES_USER || 'shastra',
        password: process.env.POSTGRES_PASSWORD || 'shastra_pw',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT || 5432),
        database: process.env.POSTGRES_DB || 'shastrastack',
      }
);

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected pg pool error');
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
