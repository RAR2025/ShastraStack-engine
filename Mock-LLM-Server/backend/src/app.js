const express = require('express');
const cors = require('cors');
const pino = require('pino');
const pinoHttp = require('pino-http');
const mockRoutes = require('./routes/mock');
const adminRoutes = require('./routes/admin');
const { dispatch } = require('./routes/simulator');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function buildApp() {
  const app = express();
  // :5173 (judging console) must be included: the Dashboard reachability check,
  // Schema Lab and Test & Recovery baseline all call the mock from the browser.
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5174,http://localhost:5173,http://localhost:4000,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '256kb' }));
  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.authorization', 'req.headers["x-admin-token"]', '*.token', '*.password', '*.secret'],
    })
  );

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'mock-llm-backend', time: new Date().toISOString() });
  });

  // Admin surface (token-guarded) is separate from simulated business routes.
  app.use('/api/admin', adminRoutes);
  // Legacy deterministic chat demo (kept for compatibility).
  app.use('/api', mockRoutes);
  // Dynamic simulated endpoints (exact method+path match; falls through to 404).
  app.use(dispatch);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { buildApp };
