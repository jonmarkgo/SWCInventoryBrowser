import { getDb } from '../database.js';
import { getLeaderClient } from '../swc-client.js';

const ENTITY_TYPES = [
  'ships', 'vehicles', 'stations', 'cities', 'facilities',
  'items', 'npcs', 'droids', 'creatures', 'materials'
];

// Cache TTL: 15 minutes
const CACHE_TTL_MS = 15 * 60 * 1000;

async function isCacheStale(entityType, ownerUid) {
  const db = getDb();
  const row = await db('inventory_cache')
    .where({ entity_type: entityType, owner_uid: ownerUid })
    .max('cached_at as last_cached')
    .first();

  if (!row?.last_cached) return true;
  const cachedAt = new Date(row.last_cached).getTime();
  return (Date.now() - cachedAt) > CACHE_TTL_MS;
}

async function getCacheAge(entityType, ownerUid) {
  const db = getDb();
  const row = await db('inventory_cache')
    .where({ entity_type: entityType, owner_uid: ownerUid })
    .max('cached_at as last_cached')
    .first();
  if (!row?.last_cached) return null;
  return new Date(row.last_cached);
}

async function fetchAndCacheEntities(ownerUid, entityType) {
  const client = getLeaderClient();
  if (!client) throw new Error('Faction leader not authenticated');

  const db = getDb();

  // Fetch all pages from the API
  const allEntities = [];
  let startIndex = 1;
  const pageSize = 200;
  let hasMore = true;

  while (hasMore) {
    const result = await client.inventory.entities.list({
      uid: ownerUid,
      entityType,
      start_index: startIndex,
      item_count: pageSize,
    });

    const data = result?.data || result || [];
    if (Array.isArray(data)) {
      allEntities.push(...data);
      hasMore = data.length === pageSize;
      startIndex += pageSize;
    } else {
      hasMore = false;
    }
  }

  // Clear old cache for this type/owner, then insert new data
  await db.transaction(async (trx) => {
    await trx('inventory_cache')
      .where({ entity_type: entityType, owner_uid: ownerUid })
      .del();

    if (allEntities.length === 0) return;

    const rows = allEntities.map((entity) => ({
      owner_uid: ownerUid,
      entity_type: entityType,
      entity_uid: String(entity.uid || entity.id || ''),
      entity_name: entity.name || '',
      entity_image: entity.images?.small || entity.images?.large || '',
      entity_data: JSON.stringify(entity),
      cached_at: new Date().toISOString(),
    }));

    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      await trx('inventory_cache').insert(rows.slice(i, i + 100));
    }
  });

  return allEntities.length;
}

export async function getInventory(ownerUid, entityType, { forceRefresh = false, page = 1, limit = 50, search = '' } = {}) {
  const db = getDb();

  // Refresh cache if stale or forced
  if (forceRefresh || await isCacheStale(entityType, ownerUid)) {
    try {
      await fetchAndCacheEntities(ownerUid, entityType);
    } catch (err) {
      console.error(`Failed to fetch ${entityType} from API:`, err.message);
      // Fall through to return cached data if available
    }
  }

  const offset = (page - 1) * limit;

  let query = db('inventory_cache')
    .where({ entity_type: entityType, owner_uid: ownerUid });

  let countQuery = db('inventory_cache')
    .where({ entity_type: entityType, owner_uid: ownerUid });

  if (search) {
    query = query.where('entity_name', 'like', `%${search}%`);
    countQuery = countQuery.where('entity_name', 'like', `%${search}%`);
  }

  const rows = await query.orderBy('entity_name').limit(limit).offset(offset);
  const [{ total }] = await countQuery.count('* as total');
  const cacheAge = await getCacheAge(entityType, ownerUid);

  return {
    items: rows.map((r) => ({ ...r, entity_data: JSON.parse(r.entity_data) })),
    total,
    page,
    pages: Math.ceil(total / limit),
    cacheAge,
  };
}

export async function getEntity(entityType, entityUid) {
  const db = getDb();
  const row = await db('inventory_cache')
    .where({ entity_type: entityType, entity_uid: entityUid })
    .first();

  if (row) {
    return { ...row, entity_data: JSON.parse(row.entity_data) };
  }

  // Not in cache - fetch directly from API
  const client = getLeaderClient();
  if (!client) return null;

  try {
    const entity = await client.inventory.entities.get({ entityType, uid: entityUid });
    return {
      entity_type: entityType,
      entity_uid: entityUid,
      entity_data: entity,
      entity_name: entity?.name || '',
      entity_image: entity?.images?.small || '',
    };
  } catch {
    return null;
  }
}

export async function refreshAll(ownerUid) {
  const results = {};
  for (const type of ENTITY_TYPES) {
    try {
      results[type] = await fetchAndCacheEntities(ownerUid, type);
    } catch (err) {
      results[type] = { error: err.message };
    }
  }
  return results;
}

export async function getInventorySummary(ownerUid) {
  return getDb()('inventory_cache')
    .where('owner_uid', ownerUid)
    .select('entity_type')
    .count('* as count')
    .max('cached_at as last_cached')
    .groupBy('entity_type')
    .orderBy('entity_type');
}

export { ENTITY_TYPES };
