// Applies ShastraStack/migrations/*.sql in filename order. Run: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { pool } = require('./pool');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

async function migrate() {
  const dir = path.join(__dirname, '..', '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    logger.info('No migrations to apply');
    return;
  }
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    logger.info({ file }, 'Applying migration');
    await pool.query(sql);
  }
  logger.info('Migrations applied');
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { migrate };
