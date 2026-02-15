import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { getInventory, getEntity, refreshAll, getMultiOwnerInventory, refreshAllOwners, ENTITY_TYPES } from '../services/inventory-service.js';
import { getGroupsForItem, getAllGroups, addItemToGroup } from '../services/group-service.js';
import { getEnabledOwners } from '../services/owner-service.js';
import { getLeaderClient } from '../swc-client.js';
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

  const owners = await getEnabledOwners();
  if (owners.length === 0) {
    setFlash(req, 'warning', 'No owners configured. Please configure owners in the dashboard.');
    return res.redirect('/dashboard');
  }

  const ownerUids = owners.map(o => o.uid);
  const page = parseInt(req.query.page) || 1;
  const search = req.query.search || '';
  const ownerFilter = req.query.owner || '';
  const result = await getMultiOwnerInventory(ownerUids, currentType, { page, search, ownerFilter });

  // Build a map of groups for displayed items
  const groupMap = {};
  for (const item of result.items) {
    const key = item.entity_type + ':' + item.entity_uid;
    groupMap[key] = await getGroupsForItem(item.entity_type, item.entity_uid);
  }

  // Build owner name map for the owner column
  const ownerMap = {};
  for (const o of owners) {
    ownerMap[o.uid] = o.name;
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
    owners,
    ownerMap,
    ownerFilter,
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
        const { assign_to, assign_type } = req.body;
        if (!assign_to?.trim()) throw new Error('Character/faction name or UID is required');
        const validTypes = ['commander', 'pilot', 'operator'];
        if (!validTypes.includes(assign_type)) throw new Error('Invalid assignment type');
        await client.inventory.entities.updateProperty({
          entityType, uid: entityUid, [assign_type]: assign_to.trim(),
        });
        await logAction(req.session.userId, 'assign', entityType, entityUid, `Assigned ${assign_type} to ${assign_to.trim()}`);
        setFlash(req, 'success', `${assign_type} set to ${assign_to.trim()}.`);
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
        const { new_owner } = req.body;
        if (!new_owner?.trim()) throw new Error('New owner name or UID is required');
        await client.inventory.entities.updateProperty({
          entityType, uid: entityUid, owner: new_owner.trim(),
        });
        await logAction(req.session.userId, 'makeover', entityType, entityUid, `Ownership transferred to ${new_owner.trim()}`);
        setFlash(req, 'success', `Ownership transferred to ${new_owner.trim()}.`);
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

// POST /inventory/bulk-action - leader bulk action on multiple items
router.post('/bulk-action', requireLeader, async (req, res) => {
  const { action, items: itemsJson } = req.body;
  const client = getLeaderClient();

  if (!client) {
    setFlash(req, 'danger', 'Leader API connection unavailable.');
    return res.redirect('/inventory');
  }

  let items;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    setFlash(req, 'danger', 'Invalid item selection.');
    return res.redirect('/inventory');
  }

  if (!Array.isArray(items) || items.length === 0) {
    setFlash(req, 'warning', 'No items selected.');
    return res.redirect('/inventory');
  }

  let successCount = 0;
  let errorCount = 0;
  const redirectType = items[0]?.entity_type || 'ships';

  for (const item of items) {
    const { entity_type, entity_uid } = item;
    if (!entity_type || !entity_uid) { errorCount++; continue; }

    try {
      switch (action) {
        case 'assign': {
          const { assign_to, assign_type } = req.body;
          if (!assign_to?.trim()) throw new Error('Target is required');
          const validTypes = ['commander', 'pilot', 'operator'];
          if (!validTypes.includes(assign_type)) throw new Error('Invalid assignment type');
          await client.inventory.entities.updateProperty({
            entityType: entity_type, uid: entity_uid, [assign_type]: assign_to.trim(),
          });
          await logAction(req.session.userId, 'assign', entity_type, entity_uid, `Bulk: assigned ${assign_type} to ${assign_to.trim()}`);
          break;
        }
        case 'rename': {
          const { new_name } = req.body;
          if (!new_name?.trim()) throw new Error('New name is required');
          await client.inventory.entities.updateProperty({
            entityType: entity_type, uid: entity_uid, name: new_name.trim(),
          });
          await logAction(req.session.userId, 'rename', entity_type, entity_uid, `Bulk: renamed to "${new_name.trim()}"`);
          break;
        }
        case 'makeover': {
          const { new_owner } = req.body;
          if (!new_owner?.trim()) throw new Error('New owner is required');
          await client.inventory.entities.updateProperty({
            entityType: entity_type, uid: entity_uid, owner: new_owner.trim(),
          });
          await logAction(req.session.userId, 'makeover', entity_type, entity_uid, `Bulk: ownership transferred to ${new_owner.trim()}`);
          break;
        }
        case 'tag': {
          const { tag_value, tag_action } = req.body;
          if (!tag_value?.trim()) throw new Error('Tag value is required');
          if (tag_action === 'remove') {
            await client.inventory.entities.removeTag({ entityType: entity_type, uid: entity_uid, tag: tag_value.trim() });
            await logAction(req.session.userId, 'remove_tag', entity_type, entity_uid, `Bulk: removed tag "${tag_value.trim()}"`);
          } else {
            await client.inventory.entities.addTag({ entityType: entity_type, uid: entity_uid, tag: tag_value.trim() });
            await logAction(req.session.userId, 'add_tag', entity_type, entity_uid, `Bulk: added tag "${tag_value.trim()}"`);
          }
          break;
        }
        default:
          throw new Error('Unknown action');
      }
      successCount++;
    } catch (err) {
      console.error(`Bulk action error on ${entity_type} ${entity_uid}:`, err.message);
      errorCount++;
    }
  }

  if (successCount > 0) setFlash(req, 'success', `${action} completed on ${successCount} item(s).`);
  if (errorCount > 0) setFlash(req, 'warning', `${errorCount} item(s) failed.`);
  res.redirect(`/inventory/${redirectType}`);
});

// POST /inventory/bulk-add-to-group - add multiple items to a group
router.post('/bulk-add-to-group', requireLeader, async (req, res) => {
  const { group_id, items: itemsJson } = req.body;

  let items;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    setFlash(req, 'danger', 'Invalid item selection.');
    return res.redirect('/inventory');
  }

  if (!group_id || !Array.isArray(items) || items.length === 0) {
    setFlash(req, 'warning', 'No items selected or no group chosen.');
    return res.redirect('/inventory');
  }

  let addedCount = 0;
  for (const item of items) {
    const added = await addItemToGroup(parseInt(group_id), item.entity_type, item.entity_uid, item.entity_name || '', item.entity_image || '');
    if (added) {
      await logAction(req.session.userId, 'add_to_group', item.entity_type, item.entity_uid, `Bulk: added to group ${group_id}`);
      addedCount++;
    }
  }

  setFlash(req, 'success', `${addedCount} item(s) added to group.`);
  const redirectType = items[0]?.entity_type || 'ships';
  res.redirect(`/inventory/${redirectType}`);
});

// POST /inventory/refresh - refresh cache for all enabled owners
router.post('/refresh', requireLeader, async (req, res) => {
  const owners = await getEnabledOwners();
  if (owners.length === 0) {
    setFlash(req, 'warning', 'No owners configured. Please configure owners in the dashboard.');
    return res.redirect('/dashboard');
  }

  const ownerUids = owners.map(o => o.uid);
  const specificType = req.body.type;

  try {
    if (specificType && ENTITY_TYPES.includes(specificType)) {
      // Refresh specific type for all owners
      for (const uid of ownerUids) {
        await getInventory(uid, specificType, { forceRefresh: true });
      }
      setFlash(req, 'success', `${specificType} cache refreshed for ${ownerUids.length} owner(s).`);
      return res.redirect(`/inventory/${specificType}`);
    } else {
      await refreshAllOwners(ownerUids);
      setFlash(req, 'success', `All inventory caches refreshed for ${ownerUids.length} owner(s).`);
      return res.redirect('/dashboard');
    }
  } catch (err) {
    console.error('Refresh error:', err);
    setFlash(req, 'danger', `Refresh failed: ${err.message}`);
    return res.redirect('/dashboard');
  }
});

export default router;
