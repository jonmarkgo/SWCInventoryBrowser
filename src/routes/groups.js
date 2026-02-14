import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import * as groupService from '../services/group-service.js';
import { getGroupUsers } from '../services/permission-service.js';
import { logAction } from '../services/audit-service.js';

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

export default router;
