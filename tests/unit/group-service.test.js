import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, cleanTables, createTestGroup } from '../setup.js';
import {
  getAllGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  getGroupItems,
  addItemToGroup,
  removeItemFromGroup,
  removeItemFromGroupByEntity,
  getGroupsForItem,
} from '../../src/services/group-service.js';

describe('group-service', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await teardownTestDb(); });
  beforeEach(async () => { await cleanTables(); });

  describe('createGroup', () => {
    it('creates a group and returns its id', async () => {
      const id = await createGroup('Fleet Alpha', 'Main fleet');
      expect(id).toBeGreaterThan(0);
    });

    it('creates multiple groups with different ids', async () => {
      const id1 = await createGroup('Fleet Alpha');
      const id2 = await createGroup('Fleet Beta');
      expect(id1).not.toBe(id2);
    });
  });

  describe('getGroup', () => {
    it('returns the group by id', async () => {
      const id = await createGroup('Fleet Alpha', 'Main fleet');
      const group = await getGroup(id);
      expect(group).toBeTruthy();
      expect(group.name).toBe('Fleet Alpha');
      expect(group.description).toBe('Main fleet');
    });

    it('returns undefined for nonexistent group', async () => {
      const group = await getGroup(99999);
      expect(group).toBeUndefined();
    });
  });

  describe('getAllGroups', () => {
    it('returns empty array when no groups', async () => {
      const groups = await getAllGroups();
      expect(groups).toEqual([]);
    });

    it('returns all groups with item counts', async () => {
      const id1 = await createGroup('Alpha');
      const id2 = await createGroup('Beta');
      await addItemToGroup(id1, 'ships', '5:100', 'X-Wing', '');
      await addItemToGroup(id1, 'ships', '5:101', 'Y-Wing', '');

      const groups = await getAllGroups();
      expect(groups).toHaveLength(2);
      const alpha = groups.find(g => g.name === 'Alpha');
      const beta = groups.find(g => g.name === 'Beta');
      expect(alpha.item_count).toBe(2);
      expect(beta.item_count).toBe(0);
    });

    it('returns groups sorted by name', async () => {
      await createGroup('Zebra');
      await createGroup('Alpha');
      await createGroup('Mango');

      const groups = await getAllGroups();
      expect(groups.map(g => g.name)).toEqual(['Alpha', 'Mango', 'Zebra']);
    });
  });

  describe('updateGroup', () => {
    it('updates name and description', async () => {
      const id = await createGroup('Old Name', 'Old desc');
      await updateGroup(id, 'New Name', 'New desc');
      const group = await getGroup(id);
      expect(group.name).toBe('New Name');
      expect(group.description).toBe('New desc');
    });
  });

  describe('deleteGroup', () => {
    it('removes the group', async () => {
      const id = await createGroup('To Delete');
      await deleteGroup(id);
      const group = await getGroup(id);
      expect(group).toBeUndefined();
    });

    it('cascades to group_items', async () => {
      const id = await createGroup('To Delete');
      await addItemToGroup(id, 'ships', '5:100', 'X-Wing', '');
      await deleteGroup(id);
      const items = await getGroupItems(id);
      expect(items).toHaveLength(0);
    });
  });

  describe('addItemToGroup', () => {
    it('adds an item and returns true', async () => {
      const gid = await createGroup('Fleet');
      const result = await addItemToGroup(gid, 'ships', '5:100', 'X-Wing', 'img.png');
      expect(result).toBe(true);
    });

    it('returns false for duplicate item', async () => {
      const gid = await createGroup('Fleet');
      await addItemToGroup(gid, 'ships', '5:100', 'X-Wing', '');
      const result = await addItemToGroup(gid, 'ships', '5:100', 'X-Wing', '');
      expect(result).toBe(false);
    });

    it('allows same entity in different groups', async () => {
      const g1 = await createGroup('Fleet A');
      const g2 = await createGroup('Fleet B');
      const r1 = await addItemToGroup(g1, 'ships', '5:100', 'X-Wing', '');
      const r2 = await addItemToGroup(g2, 'ships', '5:100', 'X-Wing', '');
      expect(r1).toBe(true);
      expect(r2).toBe(true);
    });
  });

  describe('getGroupItems', () => {
    it('returns items in a group sorted by type then name', async () => {
      const gid = await createGroup('Mixed');
      await addItemToGroup(gid, 'ships', '5:100', 'Y-Wing', '');
      await addItemToGroup(gid, 'items', '10:200', 'Bacta', '');
      await addItemToGroup(gid, 'ships', '5:101', 'A-Wing', '');

      const items = await getGroupItems(gid);
      expect(items).toHaveLength(3);
      // items type comes before ships alphabetically
      expect(items[0].entity_type).toBe('items');
      expect(items[1].entity_name).toBe('A-Wing');
      expect(items[2].entity_name).toBe('Y-Wing');
    });
  });

  describe('removeItemFromGroup', () => {
    it('removes item by group_items.id', async () => {
      const gid = await createGroup('Fleet');
      await addItemToGroup(gid, 'ships', '5:100', 'X-Wing', '');
      const items = await getGroupItems(gid);
      await removeItemFromGroup(items[0].id);
      const after = await getGroupItems(gid);
      expect(after).toHaveLength(0);
    });
  });

  describe('removeItemFromGroupByEntity', () => {
    it('removes item by entity type and uid', async () => {
      const gid = await createGroup('Fleet');
      await addItemToGroup(gid, 'ships', '5:100', 'X-Wing', '');
      await addItemToGroup(gid, 'ships', '5:101', 'Y-Wing', '');
      await removeItemFromGroupByEntity(gid, 'ships', '5:100');
      const items = await getGroupItems(gid);
      expect(items).toHaveLength(1);
      expect(items[0].entity_uid).toBe('5:101');
    });
  });

  describe('getGroupsForItem', () => {
    it('returns all groups containing an entity', async () => {
      const g1 = await createGroup('Fleet A');
      const g2 = await createGroup('Fleet B');
      const g3 = await createGroup('Fleet C');
      await addItemToGroup(g1, 'ships', '5:100', 'X-Wing', '');
      await addItemToGroup(g2, 'ships', '5:100', 'X-Wing', '');
      // g3 does not contain this ship

      const groups = await getGroupsForItem('ships', '5:100');
      expect(groups).toHaveLength(2);
      expect(groups.map(g => g.id).sort()).toEqual([g1, g2].sort());
    });

    it('returns empty array when entity is in no groups', async () => {
      const groups = await getGroupsForItem('ships', '5:999');
      expect(groups).toEqual([]);
    });
  });
});
