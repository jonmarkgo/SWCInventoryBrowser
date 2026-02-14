import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { getAuditLog } from '../services/audit-service.js';
import { ENTITY_TYPES } from '../services/inventory-service.js';

const router = Router();

router.get('/', requireLeader, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const action = req.query.action || '';
  const entityType = req.query.entity_type || '';

  const result = await getAuditLog({
    page,
    action: action || undefined,
    entityType: entityType || undefined,
  });

  res.render('audit', {
    title: 'Audit Log',
    rows: result.rows,
    page: result.page,
    pages: result.pages,
    total: result.total,
    entityTypes: ENTITY_TYPES,
    filters: { action, entityType },
  });
});

export default router;
