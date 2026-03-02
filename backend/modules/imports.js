const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  const input = String(text || '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(value);
      value = '';
      if (row.length > 1 || row[0]) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    value += char;
  }
  if (value.length || row.length) {
    row.push(value);
    if (row.length > 1 || row[0]) {
      rows.push(row);
    }
  }
  return rows;
};

const normalizeHeaders = (headers) => headers.map((header) => String(header || '').trim().toLowerCase());

const buildRowObject = (headers, values) => headers.reduce((acc, header, index) => {
  if (header) {
    acc[header] = values[index];
  }
  return acc;
}, {});

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const createImportsRouter = ({
  dbRun,
  sendOk,
  sendError,
  safeJsonStringify,
  requireWorkspaceRole,
  requireBusinessPlan,
  logAudit
}) => {
  const router = require('express').Router();
  const requireMember = requireWorkspaceRole('member');

  router.post('/:type', requireBusinessPlan, requireMember, upload.single('file'), async (req, res) => {
    try {
      const type = String(req.params.type || '').trim().toLowerCase();
      const csvText = req.body?.csv || req.body?.text || (req.file ? req.file.buffer.toString('utf8') : '');
      if (!csvText) return sendError(res, 400, 'Invalid input', 'CSV payload required');
      const rows = parseCsv(csvText);
      if (!rows.length) return sendError(res, 400, 'Invalid input', 'CSV must include rows');
      const headers = normalizeHeaders(rows[0]);
      const dataRows = rows.slice(1);
      if (!headers.length || dataRows.length === 0) {
        return sendError(res, 400, 'Invalid input', 'CSV requires header and data rows');
      }

      const importResult = await dbRun(
        `INSERT INTO imports (workspace_id, type, status, filename, stats_json, created_at)
         VALUES (?, ?, 'running', ?, ?, datetime('now'))`,
        [req.tenantId, type, req.file?.originalname || null, safeJsonStringify({})]
      );

      let inserted = 0;
      let failed = 0;
      for (const row of dataRows) {
        const record = buildRowObject(headers, row);
        try {
          if (type === 'projects') {
            if (!record.name) throw new Error('name required');
            await dbRun(
              `INSERT INTO projects (name, category, status, progress, due, notes, owner_id, tenant_id, workspace_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
              [
                String(record.name).trim(),
                String(record.category || 'general'),
                String(record.status || 'Planning'),
                toNumber(record.progress, 0),
                record.due || null,
                record.notes ? String(record.notes).trim() : null,
                req.user.id,
                req.tenantId,
                req.tenantId
              ]
            );
          } else if (type === 'leads') {
            await dbRun(
              `INSERT INTO leads (name, company, email, phone, source, status, notes, owner_id, tenant_id, workspace_id, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                record.name ? String(record.name).trim() : null,
                record.company ? String(record.company).trim() : null,
                record.email ? String(record.email).trim() : null,
                record.phone ? String(record.phone).trim() : null,
                record.source ? String(record.source).trim() : null,
                String(record.status || 'new'),
                record.notes ? String(record.notes).trim() : null,
                req.user.id,
                req.tenantId,
                req.tenantId,
                req.user.id
              ]
            );
          } else if (type === 'clients') {
            if (!record.name) throw new Error('name required');
            await dbRun(
              `INSERT INTO clients (name, mrr, status, notes, owner_id, tenant_id, workspace_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
              [
                String(record.name).trim(),
                toNumber(record.mrr, 0),
                String(record.status || 'active'),
                record.notes ? String(record.notes).trim() : null,
                req.user.id,
                req.tenantId,
                req.tenantId
              ]
            );
          } else if (type === 'providers') {
            if (!record.name) throw new Error('name required');
            const services = record.services
              ? String(record.services).split(',').map((item) => item.trim()).filter(Boolean)
              : [];
            await dbRun(
              `INSERT INTO providers (name, services, payout_rate, owner_id, tenant_id, workspace_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
              [
                String(record.name).trim(),
                safeJsonStringify(services),
                toNumber(record.payout_rate || record.payoutRate, 0),
                req.user.id,
                req.tenantId,
                req.tenantId
              ]
            );
          } else if (type === 'orders') {
            if (!record.title) throw new Error('title required');
            await dbRun(
              `INSERT INTO orders (title, description, order_type, status, priority, address_from, address_to, scheduled_at, owner_id, tenant_id, workspace_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
              [
                String(record.title).trim(),
                record.description ? String(record.description).trim() : null,
                String(record.order_type || 'delivery'),
                String(record.status || 'new'),
                String(record.priority || 'normal'),
                record.address_from ? String(record.address_from).trim() : null,
                record.address_to ? String(record.address_to).trim() : null,
                record.scheduled_at ? String(record.scheduled_at).trim() : null,
                req.user.id,
                req.tenantId,
                req.tenantId
              ]
            );
          } else {
            throw new Error('Unsupported import type');
          }
          inserted += 1;
        } catch (error) {
          failed += 1;
        }
      }

      const stats = { inserted, failed, total: dataRows.length };
      await dbRun(
        `UPDATE imports
         SET status = 'completed', stats_json = ?, finished_at = datetime('now')
         WHERE id = ?`,
        [safeJsonStringify(stats), importResult.id]
      );
      await logAudit({
        workspaceId: req.tenantId,
        actorType: 'user',
        actorUserId: req.user.id,
        action: 'import',
        entity: 'import',
        entityId: importResult.id,
        meta: { type, inserted, failed }
      });
      return sendOk(res, { id: importResult.id, stats });
    } catch (error) {
      console.error('Import error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to import CSV');
    }
  });

  return router;
};

module.exports = {
  createImportsRouter
};
