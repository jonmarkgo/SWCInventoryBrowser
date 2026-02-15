import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { getInventory, getEntity, refreshAll, ENTITY_TYPES } from '../services/inventory-service.js';
import { getGroupsForItem, getAllGroups } from '../services/group-service.js';
import { getFactionUid, getLeaderClient } from '../swc-client.js';
import { logAction } from '../services/audit-service.js';

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

// POST /inventory/:type/:uid/action - leader inventory action
router.post('/:type/:uid/action', requireLeader, async (req, res) => {
  const { type: entityType, uid: entityUid } = req.params;
  const { action } = req.body;
  const client = getLeaderClient();

  if (!client) {
    setFlash(req, 'danger', 'Leader API connection unavailable.');
    return res.redirect(`/inventory/${entityType}/${entityUid}`);
  }

  try {
    switch (action) {
      case 'assign': {
        const { new_owner } = req.body;
        if (!new_owner?.trim()) throw new Error('New owner UID is required');
        await client.inventory.entities.updateProperty({
          entityType, uid: entityUid, owner: new_owner.trim(),
        });
        await logAction(req.session.userId, 'assign', entityType, entityUid, `Assigned to ${new_owner.trim()}`);
        setFlash(req, 'success', `Assigned to ${new_owner.trim()}.`);
        break;
      }
      case 'rename': {
        const { new_name } = req.body;
        if (!new_name?.trim()) throw new Error('New name is required');
        await client.inventory.entities.updateProperty({
          entityType, uid: entityUid, name: new_name.trim(),
        });
        await logAction(req.session.userId, 'rename', entityType, entityUid, `Renamed to "${new_name.trim()}"`);
        setFlash(req, 'success', `Renamed to "${new_name.trim()}".`);
        break;
      }
      case 'makeover': {
        const props = {};
        if (req.body.makeover_name?.trim()) props.name = req.body.makeover_name.trim();
        if (req.body.makeover_info?.trim()) props.info = req.body.makeover_info.trim();
        if (Object.keys(props).length === 0) throw new Error('At least one field required for makeover');
        await client.inventory.entities.updateProperty({
          entityType, uid: entityUid, ...props,
        });
        await logAction(req.session.userId, 'makeover', entityType, entityUid, `Makeover: ${JSON.stringify(props)}`);
        setFlash(req, 'success', 'Makeover applied.');
        break;
      }
      case 'tag': {
        const { tag_value, tag_action } = req.body;
        if (!tag_value?.trim()) throw new Error('Tag value is required');
        if (tag_action === 'remove') {
          await client.inventory.entities.removeTag({ entityType, uid: entityUid, tag: tag_value.trim() });
          await logAction(req.session.userId, 'remove_tag', entityType, entityUid, `Removed tag "${tag_value.trim()}"`);
        } else {
          await client.inventory.entities.addTag({ entityType, uid: entityUid, tag: tag_value.trim() });
          await logAction(req.session.userId, 'add_tag', entityType, entityUid, `Added tag "${tag_value.trim()}"`);
        }
        setFlash(req, 'success', `Tag ${tag_action === 'remove' ? 'removed' : 'added'}.`);
        break;
      }
      default:
        throw new Error('Unknown action');
    }
  } catch (err) {
    console.error('Leader action error:', err);
    setFlash(req, 'danger', `Action failed: ${err.message}`);
  }

  res.redirect(`/inventory/${entityType}/${entityUid}`);
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
