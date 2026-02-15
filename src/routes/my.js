import { Router } from 'express';
import { requireSubuser, requireAuth } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { getUserAccessibleGroups, getPermission } from '../services/permission-service.js';
import { getGroup, getGroupItems } from '../services/group-service.js';
import { getLeaderClient } from '../swc-client.js';
import { logAction } from '../services/audit-service.js';

const router = Router();

// GET /my/dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
  // Leaders also see this if they happen to visit
  if (req.appUser?.is_leader) return res.redirect('/dashboard');

  const groups = await getUserAccessibleGroups(req.session.userId);
  res.render('my/dashboard', { title: 'My Dashboard', groups });
});

// GET /my/groups/:id
router.get('/groups/:id', requireAuth, async (req, res) => {
  const group = await getGroup(req.params.id);
  if (!group) return res.status(404).render('error', { title: 'Not Found', message: 'Group not found.' });

  // Check permission
  const perms = await getPermission(req.session.userId, group.id);
  if (!perms?.can_view && !req.appUser?.is_leader) {
    setFlash(req, 'danger', 'You do not have access to this group.');
    return res.redirect('/my/dashboard');
  }

  const items = await getGroupItems(group.id);
  const effectivePerms = req.appUser?.is_leader
    ? { can_view: 1, can_assign: 1, can_rename: 1, can_makeover: 1, can_tag: 1 }
    : perms;

  res.render('my/group', { title: group.name, group, items, perms: effectivePerms });
});

// POST /my/groups/:id/actions - execute action via leader's token
router.post('/groups/:id/actions', requireAuth, async (req, res) => {
  const group = await getGroup(req.params.id);
  if (!group) return res.status(404).render('error', { title: 'Not Found', message: 'Group not found.' });

  const perms = await getPermission(req.session.userId, group.id);
  const effectivePerms = req.appUser?.is_leader
    ? { can_view: 1, can_assign: 1, can_rename: 1, can_makeover: 1, can_tag: 1 }
    : perms;

  if (!effectivePerms?.can_view) {
    setFlash(req, 'danger', 'Access denied.');
    return res.redirect('/my/dashboard');
  }

  const { action, entity_type, entity_uid } = req.body;
  const client = getLeaderClient();
  if (!client) {
    setFlash(req, 'danger', 'Leader API connection unavailable.');
    return res.redirect(`/my/groups/${group.id}`);
  }

  try {
    switch (action) {
      case 'assign': {
        if (!effectivePerms.can_assign) throw new Error('Permission denied: assign');
        const { assign_to, assign_type } = req.body;
        if (!assign_to?.trim()) throw new Error('Character/faction name or UID is required');
        const validTypes = ['commander', 'pilot', 'operator'];
        if (!validTypes.includes(assign_type)) throw new Error('Invalid assignment type');
        await client.inventory.entities.updateProperty({
          entityType: entity_type,
          uid: entity_uid,
          [assign_type]: assign_to.trim(),
        });
        await logAction(req.session.userId, 'assign', entity_type, entity_uid, `Assigned ${assign_type} to ${assign_to.trim()}`);
        setFlash(req, 'success', `${assign_type} set to ${assign_to.trim()}.`);
        break;
      }

      case 'rename': {
        if (!effectivePerms.can_rename) throw new Error('Permission denied: rename');
        const { new_name } = req.body;
        if (!new_name?.trim()) throw new Error('New name is required');
        await client.inventory.entities.updateProperty({
          entityType: entity_type,
          uid: entity_uid,
          name: new_name.trim(),
        });
        await logAction(req.session.userId, 'rename', entity_type, entity_uid, `Renamed to "${new_name.trim()}"`);
        setFlash(req, 'success', `${entity_type} ${entity_uid} renamed to "${new_name.trim()}".`);
        break;
      }

      case 'makeover': {
        if (!effectivePerms.can_makeover) throw new Error('Permission denied: makeover');
        const { new_owner } = req.body;
        if (!new_owner?.trim()) throw new Error('New owner name or UID is required');
        await client.inventory.entities.updateProperty({
          entityType: entity_type,
          uid: entity_uid,
          owner: new_owner.trim(),
        });
        await logAction(req.session.userId, 'makeover', entity_type, entity_uid, `Ownership transferred to ${new_owner.trim()}`);
        setFlash(req, 'success', `Ownership of ${entity_type} ${entity_uid} transferred to ${new_owner.trim()}.`);
        break;
      }

      case 'tag': {
        if (!effectivePerms.can_tag) throw new Error('Permission denied: tag');
        const { tag_value, tag_action } = req.body;
        if (!tag_value?.trim()) throw new Error('Tag value is required');
        if (tag_action === 'remove') {
          await client.inventory.entities.removeTag({ entityType: entity_type, uid: entity_uid, tag: tag_value.trim() });
          await logAction(req.session.userId, 'remove_tag', entity_type, entity_uid, `Removed tag "${tag_value.trim()}"`);
        } else {
          await client.inventory.entities.addTag({ entityType: entity_type, uid: entity_uid, tag: tag_value.trim() });
          await logAction(req.session.userId, 'add_tag', entity_type, entity_uid, `Added tag "${tag_value.trim()}"`);
        }
        setFlash(req, 'success', `Tag ${tag_action === 'remove' ? 'removed from' : 'added to'} ${entity_type} ${entity_uid}.`);
        break;
      }

      default:
        throw new Error('Unknown action');
    }
  } catch (err) {
    console.error('Action error:', err);
    setFlash(req, 'danger', `Action failed: ${err.message}`);
  }

  res.redirect(`/my/groups/${group.id}`);
});

export default router;
