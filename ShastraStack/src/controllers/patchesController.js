const { query } = require('../db/pool');

async function list(req, res, next) {
  try {
    const p = Math.max(1, Number(req.query.page) || 1);
    const ps = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const conds = ['patch_id IS NOT NULL'];
    const params = [];
    if (req.query.toolId) {
      params.push(String(req.query.toolId));
      conds.push(`tool_ref = $${params.length}`);
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      conds.push(`status = $${params.length}`);
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const [{ rows: countRows }, { rows }] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total FROM patch_history ${where}`, params),
      query(
        `SELECT patch_id, tool_ref, execution_ref, operations, diagnosis, status,
          adapter_version_before, adapter_version_after, downstream_version, error, created_at
         FROM patch_history ${where} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, ps, (p - 1) * ps]
      ),
    ]);
    res.json({ data: rows, page: p, pageSize: ps, total: countRows[0].total });
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try {
    const id = String(req.params.patchId || '');
    if (!id || id.length > 100) {
      const err = new Error('Invalid patchId');
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const { rows } = await query(
      `SELECT patch_id, tool_ref, execution_ref, operations, diagnosis, status,
        adapter_version_before, adapter_version_after, downstream_version, error, created_at
       FROM patch_history WHERE patch_id = $1`,
      [id]
    );
    if (!rows[0]) {
      const err = new Error(`Patch not found: ${id}`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
}

module.exports = { list, get };
