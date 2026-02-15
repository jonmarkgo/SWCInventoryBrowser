import { getDb } from '../database.js';

export async function getEnabledOwners() {
  return getDb()('inventory_owners').where('enabled', 1).orderBy('name');
}

export async function getAllOwners() {
  return getDb()('inventory_owners').orderBy('name');
}

export async function enableOwner(uid, name, ownerType, isPrimary = false) {
  const db = getDb();
  await db('inventory_owners')
    .insert({
      uid,
      name,
      owner_type: ownerType,
      enabled: 1,
      is_primary: isPrimary ? 1 : 0,
      created_at: new Date().toISOString(),
    })
    .onConflict('uid')
    .merge({ name, owner_type: ownerType, enabled: 1, is_primary: isPrimary ? 1 : 0 });
}

export async function disableOwner(uid) {
  const db = getDb();
  await db('inventory_owners').where('uid', uid).update({ enabled: 0 });
}

/**
 * Bulk upsert from API faction list + set enabled flags.
 * @param {Array<{uid, name, type, primary}>} apiOwners - owners from API
 * @param {string[]} enabledUids - UIDs to enable (others disabled)
 */
export async function syncOwners(apiOwners, enabledUids) {
  const db = getDb();
  await db.transaction(async (trx) => {
    for (const owner of apiOwners) {
      const enabled = enabledUids.includes(owner.uid) ? 1 : 0;
      await trx('inventory_owners')
        .insert({
          uid: owner.uid,
          name: owner.name,
          owner_type: owner.type,
          enabled,
          is_primary: owner.primary ? 1 : 0,
          created_at: new Date().toISOString(),
        })
        .onConflict('uid')
        .merge({ name: owner.name, owner_type: owner.type, enabled, is_primary: owner.primary ? 1 : 0 });
    }
  });
}

/**
 * If inventory_owners is empty but faction_uid exists in settings, seed it.
 */
export async function seedFromLegacySettings() {
  const db = getDb();
  const count = await db('inventory_owners').count('* as total').first();
  if (count.total > 0) return;

  const uidRow = await db('settings').where('key', 'faction_uid').first();
  const nameRow = await db('settings').where('key', 'faction_name').first();
  if (!uidRow?.value) return;

  await db('inventory_owners').insert({
    uid: uidRow.value,
    name: nameRow?.value || 'Unknown Faction',
    owner_type: 'faction',
    enabled: 1,
    is_primary: 1,
    created_at: new Date().toISOString(),
  });

  console.log(`[owners] Seeded legacy faction ${uidRow.value} into inventory_owners`);
}
