import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import * as groupService from '../services/group-service.js';
import { getGroupUsers } from '../services/permission-service.js';
import { logAction } from '../services/audit-service.js';
import { getLeaderClient } from '../swc-client.js';

const router = Router();

// GET /groups - list
router.get('/', requireLeader, async (req, res) => {
  const groups = await groupService.getAllGroups();
  res.render('groups/list', { title: 'Groups', groups });
});

// POST /groups - create
router.post('/', requireLeader, async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) {
    setFlash(req, 'warning', 'Group name is required.');
    return res.redirect('/groups');
  }
  const id = await groupService.createGroup(name.trim(), (description || '').trim());
  await logAction(req.session.userId, 'create_group', null, null, `Created group "${name.trim()}" (id: ${id})`);
  setFlash(req, 'success', `Group "${name.trim()}" created.`);
  res.redirect(`/groups/${id}`);
});

// GET /groups/:id - detail
router.get('/:id', requireLeader, async (req, res) => {
  const group = await groupService.getGroup(req.params.id);
  if (!group) return res.status(404).render('error', { title: 'Not Found', message: 'Group not found.' });

  const items = await groupService.getGroupItems(group.id);
  const groupUsers = await getGroupUsers(group.id);

  res.render('groups/detail', { title: group.name, group, items, groupUsers });
});

// POST /groups/:id/edit - update
router.post('/:id/edit', requireLeader, async (req, res) => {
  const group = await groupService.getGroup(req.params.id);
  if (!group) return res.status(404).render('error', { title: 'Not Found', message: 'Group not found.' });

  const { name, description } = req.body;
  await groupService.updateGroup(group.id, name?.trim() || group.name, (description || '').trim());
  await logAction(req.session.userId, 'edit_group', null, null, `Updated group "${name?.trim()}" (id: ${group.id})`);
  setFlash(req, 'success', 'Group updated.');
  res.redirect(`/groups/${group.id}`);
});

// POST /groups/:id/delete
router.post('/:id/delete', requireLeader, async (req, res) => {
  const group = await groupService.getGroup(req.params.id);
  if (!group) return res.status(404).render('error', { title: 'Not Found', message: 'Group not found.' });

  await groupService.deleteGroup(group.id);
  await logAction(req.session.userId, 'delete_group', null, null, `Deleted group "${group.name}" (id: ${group.id})`);
  setFlash(req, 'success', `Group "${group.name}" deleted.`);
  res.redirect('/groups');
});

// POST /groups/:id/items - add item
router.post('/:id/items', requireLeader, async (req, res) => {
  const { entity_type, entity_uid, entity_name, entity_image } = req.body;
  const group = await groupService.getGroup(req.params.id);
  if (!group) return res.status(404).render('error', { title: 'Not Found', message: 'Group not found.' });

  const added = await groupService.addItemToGroup(group.id, entity_type, entity_uid, entity_name || '', entity_image || '');
  if (added) {
    await logAction(req.session.userId, 'add_to_group', entity_type, entity_uid, `Added to group "${group.name}"`);
    setFlash(req, 'success', `Item added to "${group.name}".`);
  } else {
    setFlash(req, 'info', 'Item already in this group.');
  }

  const redirect = req.body.redirect || `/groups/${group.id}`;
  res.redirect(redirect);
});

// POST /groups/:id/items/:itemId/remove
router.post('/:id/items/:itemId/remove', requireLeader, async (req, res) => {
  await groupService.removeItemFromGroup(req.params.itemId);
  await logAction(req.session.userId, 'remove_from_group', null, null, `Removed item ${req.params.itemId} from group ${req.params.id}`);
  setFlash(req, 'success', 'Item removed from group.');
  res.redirect(`/groups/${req.params.id}`);
});

// POST /groups/:id/items/remove (by entity type/uid)
router.post('/:id/items/remove', requireLeader, async (req, res) => {
  const { entity_type, entity_uid, redirect } = req.body;
  await groupService.removeItemFromGroupByEntity(req.params.id, entity_type, entity_uid);
  await logAction(req.session.userId, 'remove_from_group', entity_type, entity_uid, `Removed from group ${req.params.id}`);
  setFlash(req, 'success', 'Item removed from group.');
  res.redirect(redirect || `/groups/${req.params.id}`);
});

// POST /groups/:id/bulk-actions - leader bulk action on group items
router.post('/:id/bulk-actions', requireLeader, async (req, res) => {
  const group = await groupService.getGroup(req.params.id);
  if (!group) return res.status(404).render('error', { title: 'Not Found', message: 'Group not found.' });

  const { action, items: itemsJson } = req.body;
  const client = getLeaderClient();

  if (!client) {
    setFlash(req, 'danger', 'Leader API connection unavailable.');
    return res.redirect(`/groups/${group.id}`);
  }

  let items;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    setFlash(req, 'danger', 'Invalid item selection.');
    return res.redirect(`/groups/${group.id}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    setFlash(req, 'warning', 'No items selected.');
    return res.redirect(`/groups/${group.id}`);
  }

  let successCount = 0;
  let errorCount = 0;

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
  res.redirect(`/groups/${group.id}`);
});

// POST /groups/:id/bulk-remove - remove multiple items from group
router.post('/:id/bulk-remove', requireLeader, async (req, res) => {
  const group = await groupService.getGroup(req.params.id);
  if (!group) return res.status(404).render('error', { title: 'Not Found', message: 'Group not found.' });

  const { items: itemsJson } = req.body;

  let items;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    setFlash(req, 'danger', 'Invalid item selection.');
    return res.redirect(`/groups/${group.id}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    setFlash(req, 'warning', 'No items selected.');
    return res.redirect(`/groups/${group.id}`);
  }

  let removedCount = 0;
  for (const item of items) {
    await groupService.removeItemFromGroupByEntity(group.id, item.entity_type, item.entity_uid);
    await logAction(req.session.userId, 'remove_from_group', item.entity_type, item.entity_uid, `Bulk: removed from group "${group.name}"`);
    removedCount++;
  }

  setFlash(req, 'success', `${removedCount} item(s) removed from group.`);
  res.redirect(`/groups/${group.id}`);
});

export default router;
