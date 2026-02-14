import { getDb } from '../database.js';

export async function getAllGroups() {
  const db = getDb();
  const groups = await db('groups as g')
    .leftJoin('group_items as gi', 'g.id', 'gi.group_id')
    .select('g.*')
    .count('gi.id as item_count')
    .groupBy('g.id')
    .orderBy('g.name');
  return groups;
}

export async function getGroup(id) {
  return getDb()('groups').where('id', id).first();
}

export async function createGroup(name, description = '') {
  const [id] = await getDb()('groups').insert({ name, description });
  return id;
}

export async function updateGroup(id, name, description) {
  await getDb()('groups').where('id', id).update({ name, description });
}

export async function deleteGroup(id) {
  await getDb()('groups').where('id', id).del();
}

export async function getGroupItems(groupId) {
  return getDb()('group_items')
    .where('group_id', groupId)
    .orderBy(['entity_type', 'entity_name']);
}

export async function addItemToGroup(groupId, entityType, entityUid, entityName, entityImage) {
  try {
    await getDb()('group_items').insert({
      group_id: groupId,
      entity_type: entityType,
      entity_uid: entityUid,
      entity_name: entityName,
      entity_image: entityImage,
    });
    return true;
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) return false;
    throw err;
  }
}

export async function removeItemFromGroup(groupItemId) {
  await getDb()('group_items').where('id', groupItemId).del();
}

export async function removeItemFromGroupByEntity(groupId, entityType, entityUid) {
  await getDb()('group_items')
    .where({ group_id: groupId, entity_type: entityType, entity_uid: entityUid })
    .del();
}

export async function getGroupsForItem(entityType, entityUid) {
  return getDb()('groups as g')
    .join('group_items as gi', 'g.id', 'gi.group_id')
    .where({ 'gi.entity_type': entityType, 'gi.entity_uid': entityUid })
    .select('g.*');
}
