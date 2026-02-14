import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { getDb } from '../database.js';
import { getUserPermissions, setPermission, removePermission } from '../services/permission-service.js';
import { getAllGroups } from '../services/group-service.js';
import { logAction } from '../services/audit-service.js';

const router = Router();

// GET /users - list sub-users
router.get('/', requireLeader, async (req, res) => {
  const db = getDb();
  const users = await db('users').where('is_leader', 0).orderBy('swc_name');

  // Build permissions map for each user
  const permsByUser = {};
  for (const u of users) {
    permsByUser[u.id] = await getUserPermissions(u.id);
  }

  res.render('users/list', { title: 'Users', users, permsByUser });
});

// GET /users/:id - permission editor
router.get('/:id', requireLeader, async (req, res) => {
  const db = getDb();
  const targetUser = await db('users').where('id', req.params.id).first();
  if (!targetUser) return res.status(404).render('error', { title: 'Not Found', message: 'User not found.' });

  const groups = await getAllGroups();
  const userPerms = await getUserPermissions(targetUser.id);

  // Build permission map by group id
  const permMap = {};
  for (const p of userPerms) {
    permMap[p.group_id] = p;
  }

  res.render('users/permissions', { title: `Permissions - ${targetUser.swc_name}`, targetUser, groups, permMap });
});

// POST /users/:id/permissions - save all permissions
router.post('/:id/permissions', requireLeader, async (req, res) => {
  const db = getDb();
  const targetUser = await db('users').where('id', req.params.id).first();
  if (!targetUser) return res.status(404).render('error', { title: 'Not Found', message: 'User not found.' });

  const groups = await getAllGroups();
  const perms = req.body.perms || {};

  for (const group of groups) {
    const groupPerms = perms[group.id];
    if (groupPerms && (groupPerms.can_view || groupPerms.can_assign || groupPerms.can_rename || groupPerms.can_makeover || groupPerms.can_tag)) {
      await setPermission(targetUser.id, group.id, {
        can_view: !!groupPerms.can_view,
        can_assign: !!groupPerms.can_assign,
        can_rename: !!groupPerms.can_rename,
        can_makeover: !!groupPerms.can_makeover,
        can_tag: !!groupPerms.can_tag,
      });
    } else {
      // No permissions checked - remove access
      await removePermission(targetUser.id, group.id);
    }
  }

  await logAction(req.session.userId, 'update_permissions', null, null, `Updated permissions for ${targetUser.swc_name}`);
  setFlash(req, 'success', `Permissions updated for ${targetUser.swc_name}.`);
  res.redirect(`/users/${targetUser.id}`);
});

export default router;
