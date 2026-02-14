import { getDb } from '../database.js';

export async function getUserPermissions(userId) {
  return getDb()('user_permissions as up')
    .join('groups as g', 'up.group_id', 'g.id')
    .where('up.user_id', userId)
    .select('up.*', 'g.name as group_name')
    .orderBy('g.name');
}

export async function getPermission(userId, groupId) {
  return getDb()('user_permissions')
    .where({ user_id: userId, group_id: groupId })
    .first();
}

export async function setPermission(userId, groupId, perms) {
  const db = getDb();
  const existing = await getPermission(userId, groupId);
  const data = {
    can_view: perms.can_view ? 1 : 0,
    can_assign: perms.can_assign ? 1 : 0,
    can_rename: perms.can_rename ? 1 : 0,
    can_makeover: perms.can_makeover ? 1 : 0,
    can_tag: perms.can_tag ? 1 : 0,
  };

  if (existing) {
    await db('user_permissions')
      .where({ user_id: userId, group_id: groupId })
      .update(data);
  } else {
    await db('user_permissions').insert({
      user_id: userId,
      group_id: groupId,
      ...data,
    });
  }
}

export async function removePermission(userId, groupId) {
  await getDb()('user_permissions')
    .where({ user_id: userId, group_id: groupId })
    .del();
}

export async function getGroupUsers(groupId) {
  return getDb()('users as u')
    .join('user_permissions as up', 'u.id', 'up.user_id')
    .where('up.group_id', groupId)
    .where('u.is_leader', 0)
    .select('u.*', 'up.can_view', 'up.can_assign', 'up.can_rename', 'up.can_makeover', 'up.can_tag')
    .orderBy('u.swc_name');
}

export async function getUserAccessibleGroups(userId) {
  return getDb()('groups as g')
    .join('user_permissions as up', 'g.id', 'up.group_id')
    .leftJoin('group_items as gi', 'g.id', 'gi.group_id')
    .where('up.user_id', userId)
    .where('up.can_view', 1)
    .select(
      'g.*',
      'up.can_view', 'up.can_assign', 'up.can_rename', 'up.can_makeover', 'up.can_tag'
    )
    .count('gi.id as item_count')
    .groupBy('g.id')
    .orderBy('g.name');
}

export async function canUserAccess(userId, groupId, permission) {
  const perm = await getPermission(userId, groupId);
  if (!perm) return false;
  const key = `can_${permission}`;
  return !!perm[key];
}
