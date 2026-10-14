const express = require('express');
const cors = require('cors');
const pino = require('pino');
const pinoHttp = require('pino-http');
const healthRoutes = require('./routes/health');
const dashboardRoutes = require('./routes/dashboard');
const toolsRoutes = require('./routes/tools');
const logsRoutes = require('./routes/logs');
const patchesRoutes = require('./routes/patches');
const metricsRoutes = require('./routes/metrics');
const engineRoutes = require('./routes/engine');
const { maybeLocalAuth } = require('./middleware/localAuth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function buildApp() {
  const app = express();
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '256kb' }));
  // Never log credentials or sensitive request bodies.
  app.use(
    pinoHttp({
      logger,
      redact: [
        'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-token"]',
        'req.body.headers.authorization', 'req.body.headers.cookie',
        'req.body.input.password', 'req.body.input.token',
        '*.password', '*.token', '*.secret', '*.apiKey', '*.api_key',
      ],
    })
  );

  app.use('/', healthRoutes);
  // Optional local token for mutating /api routes (open when APP_API_TOKEN unset).
  app.use('/api', maybeLocalAuth);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/tools', toolsRoutes);
  app.use('/api/logs', logsRoutes);
  app.use('/api/patches', patchesRoutes);
  app.use('/api/metrics', metricsRoutes);
  app.use('/api/engine', engineRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { buildApp };
