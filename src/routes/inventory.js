import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { getInventory, getEntity, refreshAll, ENTITY_TYPES } from '../services/inventory-service.js';
import { getGroupsForItem, getAllGroups } from '../services/group-service.js';
import { getFactionUid } from '../swc-client.js';

const router = Router();

// GET /inventory - redirect to first entity type
router.get('/', requireLeader, (req, res) => {
  res.redirect('/inventory/ships');
});

// GET /inventory/:type - browse entity type
router.get('/:type', requireLeader, async (req, res) => {
  const currentType = req.params.type;
  if (!ENTITY_TYPES.includes(currentType)) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Invalid entity type.' });
  }

  const factionUid = await getFactionUid();
  if (!factionUid) {
    setFlash(req, 'warning', 'No faction configured. Please set your faction in the dashboard.');
    return res.redirect('/dashboard');
  }

  const page = parseInt(req.query.page) || 1;
  const search = req.query.search || '';
  const result = await getInventory(factionUid, currentType, { page, search });

  // Build a map of groups for displayed items
  const groupMap = {};
  for (const item of result.items) {
    const key = item.entity_type + ':' + item.entity_uid;
    groupMap[key] = await getGroupsForItem(item.entity_type, item.entity_uid);
  }

  const groups = await getAllGroups();

  res.render('inventory/browse', {
    title: `Inventory - ${currentType}`,
    entityTypes: ENTITY_TYPES,
    currentType,
    items: result.items,
    total: result.total,
    page: result.page,
    pages: result.pages,
    cacheAge: result.cacheAge,
    search,
    groupMap,
    groups,
  });
});

// GET /inventory/:type/:uid - entity detail
router.get('/:type/:uid', requireLeader, async (req, res) => {
  const { type: entityType, uid } = req.params;
  const entity = await getEntity(entityType, uid);

  if (!entity) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Entity not found.' });
  }

  const itemGroups = await getGroupsForItem(entityType, uid);
  const groups = await getAllGroups();

  res.render('inventory/entity', {
    title: entity.entity_name || uid,
    entityType,
    entity,
    itemGroups,
    groups,
  });
});

// POST /inventory/refresh - refresh cache
router.post('/refresh', requireLeader, async (req, res) => {
  const factionUid = await getFactionUid();
  if (!factionUid) {
    setFlash(req, 'warning', 'No faction configured. Please set your faction in the dashboard.');
    return res.redirect('/dashboard');
  }

  const specificType = req.body.type;

  try {
    if (specificType && ENTITY_TYPES.includes(specificType)) {
      await getInventory(factionUid, specificType, { forceRefresh: true });
      setFlash(req, 'success', `${specificType} cache refreshed.`);
      return res.redirect(`/inventory/${specificType}`);
    } else {
      await refreshAll(factionUid);
      setFlash(req, 'success', 'All inventory caches refreshed.');
      return res.redirect('/dashboard');
    }
  } catch (err) {
    console.error('Refresh error:', err);
    setFlash(req, 'danger', `Refresh failed: ${err.message}`);
    return res.redirect('/dashboard');
  }
});

export default router;
