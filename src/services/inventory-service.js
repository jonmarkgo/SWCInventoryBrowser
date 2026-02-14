import { getDb } from '../database.js';
import { getLeaderClient } from '../swc-client.js';
import { config } from '../config.js';

const ENTITY_TYPES = [
  'ships', 'vehicles', 'stations', 'cities', 'facilities',
  'items', 'npcs', 'droids', 'creatures', 'materials'
];

// Cache TTL: 6 hours (inventory doesn't change frequently; manual refresh available)
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// SWC API wraps entities in {attributes, value} - unwrap to get the actual data
function unwrapEntity(raw) {
  return raw?.value && typeof raw.value === 'object' ? raw.value : raw;
}

// Extract uid/name/image from the unwrapped entity data (handles varying formats)
function extractEntityFields(entity, entityType, index) {
  const uid = entity.uid || entity.id || '';
  const name = entity.name || '';
  const image = entity.images?.small || entity.images?.large || '';

  // Materials don't have individual UIDs - generate from type + location
  if (!uid && entityType === 'materials') {
    const typeUid = entity.type?.attributes?.uid || entity.type?.uid || `unknown-${index}`;
    const typeName = entity.type?.value || entity.type?.name || 'Unknown Material';
    const loc = entity.location?.container?.attributes?.uid || 'unknown-loc';
    return {
      uid: `${typeUid}@${loc}`,
      name: `${typeName} (${entity.quantity || 0})`,
      image,
    };
  }

  return { uid: String(uid), name, image };
}

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
  const fetchLimit = config.inventoryFetchLimit;
  const pageSize = fetchLimit > 0 ? Math.min(200, fetchLimit) : 200;
  const limitStr = fetchLimit > 0 ? ` (limit: ${fetchLimit})` : '';

  console.log(`[inventory] Fetching ${entityType} for ${ownerUid}${limitStr}...`);
  const fetchStart = Date.now();

  // Fetch pages from the API (respects INVENTORY_FETCH_LIMIT if set)
  const allEntities = [];
  let startIndex = 1;
  let hasMore = true;
  let pageNum = 0;

  while (hasMore) {
    pageNum++;
    console.log(`[inventory]   ${entityType} page ${pageNum}: requesting items ${startIndex}-${startIndex + pageSize - 1}...`);
    const pageStart = Date.now();

    const result = await client.inventory.entities.list({
      uid: ownerUid,
      entityType,
      assignType: 'owner',
      start_index: startIndex,
      item_count: pageSize,
    });

    const pageMs = Date.now() - pageStart;
    const data = result?.data || result || [];
    if (Array.isArray(data)) {
      allEntities.push(...data);
      console.log(`[inventory]   ${entityType} page ${pageNum}: got ${data.length} items (${pageMs}ms, total so far: ${allEntities.length})`);
      hasMore = data.length === pageSize;
      startIndex += pageSize;
      if (fetchLimit > 0 && allEntities.length >= fetchLimit) {
        console.log(`[inventory]   ${entityType}: hit fetch limit of ${fetchLimit}, stopping`);
        allEntities.length = fetchLimit;
        hasMore = false;
      }
    } else {
      console.log(`[inventory]   ${entityType} page ${pageNum}: unexpected response format (${pageMs}ms)`, typeof data);
      hasMore = false;
    }
  }

  const fetchMs = Date.now() - fetchStart;
  console.log(`[inventory] Fetched ${allEntities.length} ${entityType} in ${fetchMs}ms (${pageNum} API calls). Caching...`);

  // Clear old cache for this type/owner, then insert new data
  await db.transaction(async (trx) => {
    await trx('inventory_cache')
      .where({ entity_type: entityType, owner_uid: ownerUid })
      .del();

    if (allEntities.length === 0) {
      console.log(`[inventory] ${entityType}: nothing to cache (0 items)`);
      return;
    }

    const rows = allEntities.map((raw, idx) => {
      const entity = unwrapEntity(raw);
      const fields = extractEntityFields(entity, entityType, idx);
      return {
        owner_uid: ownerUid,
        entity_type: entityType,
        entity_uid: fields.uid,
        entity_name: fields.name,
        entity_image: fields.image,
        entity_data: JSON.stringify(entity),
        cached_at: new Date().toISOString(),
      };
    });

    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await trx('inventory_cache').insert(batch);
      console.log(`[inventory]   ${entityType}: cached batch ${Math.floor(i / 100) + 1} (${Math.min(i + 100, rows.length)}/${rows.length} rows)`);
    }
  });

  console.log(`[inventory] ${entityType}: done. ${allEntities.length} items cached.`);
  return allEntities.length;
}

export async function getInventory(ownerUid, entityType, { forceRefresh = false, page = 1, limit = 50, search = '' } = {}) {
  const db = getDb();

  // Refresh cache if stale or forced
  if (forceRefresh || await isCacheStale(entityType, ownerUid)) {
    const reason = forceRefresh ? 'forced refresh' : 'cache stale';
    console.log(`[inventory] Cache miss for ${entityType} (${reason}), fetching from API...`);
    try {
      await fetchAndCacheEntities(ownerUid, entityType);
    } catch (err) {
      console.error(`[inventory] Failed to fetch ${entityType} from API:`, err.message);
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
  console.log(`[inventory] Cache miss for entity ${entityType}/${entityUid}, fetching from API...`);
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
  console.log(`[inventory] === Refresh All started for ${ownerUid} ===`);
  const overallStart = Date.now();
  const results = {};
  for (const type of ENTITY_TYPES) {
    try {
      results[type] = await fetchAndCacheEntities(ownerUid, type);
    } catch (err) {
      console.error(`[inventory] ${type}: ERROR - ${err.message}`);
      results[type] = { error: err.message };
    }
  }
  const totalMs = Date.now() - overallStart;
  const summary = Object.entries(results).map(([t, r]) => `${t}: ${typeof r === 'number' ? r : r.error}`).join(', ');
  console.log(`[inventory] === Refresh All complete in ${totalMs}ms === ${summary}`);
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
