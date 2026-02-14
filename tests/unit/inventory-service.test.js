import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { setupTestDb, teardownTestDb, cleanTables } from '../setup.js';
import { getDb } from '../../src/database.js';

// Mock the SWC client so we don't make real API calls
vi.mock('../../src/swc-client.js', () => ({
  getLeaderClient: vi.fn(() => null),
}));

import {
  getInventory,
  getEntity,
  getInventorySummary,
  ENTITY_TYPES,
} from '../../src/services/inventory-service.js';

describe('inventory-service', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await teardownTestDb(); });
  beforeEach(async () => { await cleanTables(); });

  // Helper to seed inventory cache directly
  async function seedCache(items) {
    const db = getDb();
    for (const item of items) {
      await db('inventory_cache').insert({
        owner_uid: item.owner_uid || '1:1000',
        entity_type: item.entity_type || 'ships',
        entity_uid: item.entity_uid,
        entity_name: item.entity_name || '',
        entity_image: item.entity_image || '',
        entity_data: JSON.stringify(item.entity_data || { uid: item.entity_uid, name: item.entity_name }),
        cached_at: item.cached_at || new Date().toISOString(),
      });
    }
  }

  describe('ENTITY_TYPES', () => {
    it('contains all 10 entity types', () => {
      expect(ENTITY_TYPES).toHaveLength(10);
      expect(ENTITY_TYPES).toContain('ships');
      expect(ENTITY_TYPES).toContain('items');
      expect(ENTITY_TYPES).toContain('vehicles');
      expect(ENTITY_TYPES).toContain('stations');
      expect(ENTITY_TYPES).toContain('facilities');
      expect(ENTITY_TYPES).toContain('materials');
    });
  });

  describe('getInventory (from cache)', () => {
    it('returns cached items with pagination', async () => {
      await seedCache([
        { entity_uid: '5:1', entity_name: 'Alpha Ship', entity_type: 'ships' },
        { entity_uid: '5:2', entity_name: 'Beta Ship', entity_type: 'ships' },
        { entity_uid: '5:3', entity_name: 'Gamma Ship', entity_type: 'ships' },
      ]);

      const result = await getInventory('1:1000', 'ships', { page: 1, limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.pages).toBe(2);
      expect(result.page).toBe(1);
    });

    it('returns second page', async () => {
      await seedCache([
        { entity_uid: '5:1', entity_name: 'Alpha', entity_type: 'ships' },
        { entity_uid: '5:2', entity_name: 'Beta', entity_type: 'ships' },
        { entity_uid: '5:3', entity_name: 'Gamma', entity_type: 'ships' },
      ]);

      const result = await getInventory('1:1000', 'ships', { page: 2, limit: 2 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].entity_name).toBe('Gamma');
    });

    it('filters by search term', async () => {
      await seedCache([
        { entity_uid: '5:1', entity_name: 'X-Wing Fighter', entity_type: 'ships' },
        { entity_uid: '5:2', entity_name: 'Y-Wing Bomber', entity_type: 'ships' },
        { entity_uid: '5:3', entity_name: 'TIE Interceptor', entity_type: 'ships' },
      ]);

      const result = await getInventory('1:1000', 'ships', { search: 'Wing' });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('only returns items for the correct owner', async () => {
      await seedCache([
        { entity_uid: '5:1', entity_name: 'Mine', owner_uid: '1:1000', entity_type: 'ships' },
        { entity_uid: '5:2', entity_name: 'Theirs', owner_uid: '1:2000', entity_type: 'ships' },
      ]);

      const result = await getInventory('1:1000', 'ships');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].entity_name).toBe('Mine');
    });

    it('only returns items for the correct entity type', async () => {
      await seedCache([
        { entity_uid: '5:1', entity_name: 'Ship', entity_type: 'ships' },
        { entity_uid: '10:1', entity_name: 'Item', entity_type: 'items' },
      ]);

      const result = await getInventory('1:1000', 'ships');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].entity_name).toBe('Ship');
    });

    it('returns parsed entity_data', async () => {
      await seedCache([
        {
          entity_uid: '5:1',
          entity_name: 'X-Wing',
          entity_type: 'ships',
          entity_data: { uid: '5:1', name: 'X-Wing', stats: { hull: 100 } },
        },
      ]);

      const result = await getInventory('1:1000', 'ships');
      expect(result.items[0].entity_data).toEqual({
        uid: '5:1', name: 'X-Wing', stats: { hull: 100 },
      });
    });

    it('returns empty result when no cache exists', async () => {
      const result = await getInventory('1:1000', 'ships');
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.cacheAge).toBeNull();
    });
  });

  describe('getEntity', () => {
    it('returns a cached entity', async () => {
      await seedCache([
        {
          entity_uid: '5:42',
          entity_name: 'Millennium Falcon',
          entity_type: 'ships',
          entity_data: { uid: '5:42', name: 'Millennium Falcon', class: 'YT-1300' },
        },
      ]);

      const entity = await getEntity('ships', '5:42');
      expect(entity).toBeTruthy();
      expect(entity.entity_name).toBe('Millennium Falcon');
      expect(entity.entity_data.class).toBe('YT-1300');
    });

    it('returns null when entity not found and no client', async () => {
      const entity = await getEntity('ships', '5:9999');
      expect(entity).toBeNull();
    });
  });

  describe('getInventorySummary', () => {
    it('returns counts per entity type', async () => {
      await seedCache([
        { entity_uid: '5:1', entity_type: 'ships' },
        { entity_uid: '5:2', entity_type: 'ships' },
        { entity_uid: '10:1', entity_type: 'items' },
      ]);

      const summary = await getInventorySummary('1:1000');
      expect(summary).toHaveLength(2);
      const ships = summary.find(s => s.entity_type === 'ships');
      const items = summary.find(s => s.entity_type === 'items');
      expect(ships.count).toBe(2);
      expect(items.count).toBe(1);
    });

    it('returns empty array when no cache', async () => {
      const summary = await getInventorySummary('1:1000');
      expect(summary).toEqual([]);
    });
  });
});
