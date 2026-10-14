const express = require('express');
const cors = require('cors');
const pino = require('pino');
const pinoHttp = require('pino-http');
const healthRoutes = require('./routes/health');
const toolsRoutes = require('./routes/tools');
const logsRoutes = require('./routes/logs');
const patchesRoutes = require('./routes/patches');
const metricsRoutes = require('./routes/metrics');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function buildApp() {
  const app = express();

  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://localhost:5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '256kb' }));
  app.use(
    pinoHttp({
      logger,
      redact: [
        'req.headers.authorization', 'req.headers.cookie',
        'req.body.headers.authorization', 'req.body.headers.cookie',
        'req.body.input.password', 'req.body.input.token',
        '*.password', '*.token', '*.secret',
      ],
    })
  );

  app.use('/', healthRoutes);
  app.use('/v1/tools', toolsRoutes);
  app.use('/v1/logs', logsRoutes);
  app.use('/v1/patches', patchesRoutes);
  app.use('/v1/metrics', metricsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { buildApp };
