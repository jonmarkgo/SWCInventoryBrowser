import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, cleanTables } from '../setup.js';
import { getDb } from '../../src/database.js';
import {
  getEnabledOwners,
  getAllOwners,
  enableOwner,
  disableOwner,
  syncOwners,
  seedFromLegacySettings,
} from '../../src/services/owner-service.js';

describe('owner-service', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await teardownTestDb(); });
  beforeEach(async () => { await cleanTables(); });

  describe('enableOwner / disableOwner', () => {
    it('inserts a new enabled owner', async () => {
      await enableOwner('20:100', 'Test Faction', 'faction', true);
      const owners = await getAllOwners();
      expect(owners).toHaveLength(1);
      expect(owners[0].uid).toBe('20:100');
      expect(owners[0].name).toBe('Test Faction');
      expect(owners[0].owner_type).toBe('faction');
      expect(owners[0].enabled).toBe(1);
      expect(owners[0].is_primary).toBe(1);
    });

    it('upserts on conflict', async () => {
      await enableOwner('20:100', 'Old Name', 'faction', false);
      await enableOwner('20:100', 'New Name', 'faction', true);
      const owners = await getAllOwners();
      expect(owners).toHaveLength(1);
      expect(owners[0].name).toBe('New Name');
      expect(owners[0].is_primary).toBe(1);
    });

    it('disables an owner', async () => {
      await enableOwner('20:100', 'Faction', 'faction');
      await disableOwner('20:100');
      const owners = await getAllOwners();
      expect(owners[0].enabled).toBe(0);
    });
  });

  describe('getEnabledOwners', () => {
    it('returns only enabled owners', async () => {
      await enableOwner('20:100', 'Enabled', 'faction');
      await enableOwner('20:200', 'Disabled', 'faction');
      await disableOwner('20:200');

      const enabled = await getEnabledOwners();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].uid).toBe('20:100');
    });

    it('returns empty array when none', async () => {
      const enabled = await getEnabledOwners();
      expect(enabled).toEqual([]);
    });
  });

  describe('getAllOwners', () => {
    it('returns all owners regardless of enabled state', async () => {
      await enableOwner('20:100', 'A', 'faction');
      await enableOwner('20:200', 'B', 'faction');
      await disableOwner('20:200');

      const all = await getAllOwners();
      expect(all).toHaveLength(2);
    });
  });

  describe('syncOwners', () => {
    it('upserts owners and sets enabled flags', async () => {
      const apiOwners = [
        { uid: '20:100', name: 'Alpha', type: 'faction', primary: true },
        { uid: '20:200', name: 'Beta', type: 'faction', primary: false },
        { uid: '20:300', name: 'Gamma', type: 'faction', primary: false },
      ];

      await syncOwners(apiOwners, ['20:100', '20:300']);

      const all = await getAllOwners();
      expect(all).toHaveLength(3);

      const alpha = all.find(o => o.uid === '20:100');
      expect(alpha.enabled).toBe(1);
      expect(alpha.is_primary).toBe(1);

      const beta = all.find(o => o.uid === '20:200');
      expect(beta.enabled).toBe(0);

      const gamma = all.find(o => o.uid === '20:300');
      expect(gamma.enabled).toBe(1);
    });

    it('updates existing owners on re-sync', async () => {
      await enableOwner('20:100', 'Old Name', 'faction', true);

      const apiOwners = [
        { uid: '20:100', name: 'New Name', type: 'faction', primary: true },
      ];
      await syncOwners(apiOwners, ['20:100']);

      const all = await getAllOwners();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('New Name');
    });
  });

  describe('seedFromLegacySettings', () => {
    it('seeds from faction_uid setting when table is empty', async () => {
      const db = getDb();
      await db('settings').insert({ key: 'faction_uid', value: '20:502' });
      await db('settings').insert({ key: 'faction_name', value: 'Rendili StarDrive' });

      await seedFromLegacySettings();

      const owners = await getAllOwners();
      expect(owners).toHaveLength(1);
      expect(owners[0].uid).toBe('20:502');
      expect(owners[0].name).toBe('Rendili StarDrive');
      expect(owners[0].owner_type).toBe('faction');
      expect(owners[0].enabled).toBe(1);
      expect(owners[0].is_primary).toBe(1);
    });

    it('does not seed if table already has data', async () => {
      await enableOwner('20:100', 'Existing', 'faction');

      const db = getDb();
      await db('settings').insert({ key: 'faction_uid', value: '20:502' });

      await seedFromLegacySettings();

      const owners = await getAllOwners();
      expect(owners).toHaveLength(1);
      expect(owners[0].uid).toBe('20:100');
    });

    it('does nothing when no faction_uid setting', async () => {
      await seedFromLegacySettings();
      const owners = await getAllOwners();
      expect(owners).toEqual([]);
    });

    it('uses "Unknown Faction" when faction_name setting missing', async () => {
      const db = getDb();
      await db('settings').insert({ key: 'faction_uid', value: '20:999' });

      await seedFromLegacySettings();

      const owners = await getAllOwners();
      expect(owners[0].name).toBe('Unknown Faction');
    });
  });
});
