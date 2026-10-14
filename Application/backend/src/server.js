require('dotenv').config();
const pino = require('pino');
const { buildApp } = require('./app');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = Number(process.env.PORT || 3000);

const app = buildApp();
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Application backend listening');
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

module.exports = { app, server };
