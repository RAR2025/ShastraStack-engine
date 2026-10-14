require('dotenv').config();
const pino = require('pino');
const { buildApp } = require('./app');
const { loadActiveAdapters } = require('./services/toolRegistry');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = Number(process.env.PORT || process.env.SHASTRASTACK_PORT || 4000);

async function start() {
  try {
    const count = await loadActiveAdapters();
    logger.info({ count }, 'Active tool adapters loaded');
  } catch (err) {
    logger.warn({ err }, 'Could not load adapters at startup (DB unavailable); continuing with empty cache');
  }
  const app = buildApp();
  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'ShastraStack engine listening');
  });

  function shutdown(signal) {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return { app, server };
}

if (require.main === module) {
  start();
}

module.exports = { start };
