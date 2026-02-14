import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, cleanTables, createTestUser, createTestGroup } from '../setup.js';
import {
  getUserPermissions,
  getPermission,
  setPermission,
  removePermission,
  getGroupUsers,
  getUserAccessibleGroups,
  canUserAccess,
} from '../../src/services/permission-service.js';

describe('permission-service', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await teardownTestDb(); });
  beforeEach(async () => { await cleanTables(); });

  describe('setPermission / getPermission', () => {
    it('creates a new permission record', async () => {
      const user = await createTestUser({ swc_name: 'Pilot' });
      const group = await createTestGroup({ name: 'Fleet' });

      await setPermission(user.id, group.id, {
        can_view: true, can_assign: true, can_rename: false, can_makeover: false, can_tag: false,
      });

      const perm = await getPermission(user.id, group.id);
      expect(perm).toBeTruthy();
      expect(perm.can_view).toBe(1);
      expect(perm.can_assign).toBe(1);
      expect(perm.can_rename).toBe(0);
      expect(perm.can_makeover).toBe(0);
      expect(perm.can_tag).toBe(0);
    });

    it('updates an existing permission record', async () => {
      const user = await createTestUser({ swc_name: 'Pilot' });
      const group = await createTestGroup({ name: 'Fleet' });

      await setPermission(user.id, group.id, {
        can_view: true, can_assign: false, can_rename: false, can_makeover: false, can_tag: false,
      });
      await setPermission(user.id, group.id, {
        can_view: true, can_assign: true, can_rename: true, can_makeover: true, can_tag: true,
      });

      const perm = await getPermission(user.id, group.id);
      expect(perm.can_assign).toBe(1);
      expect(perm.can_rename).toBe(1);
      expect(perm.can_makeover).toBe(1);
      expect(perm.can_tag).toBe(1);
    });
  });

  describe('getPermission', () => {
    it('returns undefined when no permission exists', async () => {
      const perm = await getPermission(999, 999);
      expect(perm).toBeUndefined();
    });
  });

  describe('removePermission', () => {
    it('deletes the permission record', async () => {
      const user = await createTestUser({ swc_name: 'Pilot' });
      const group = await createTestGroup({ name: 'Fleet' });
      await setPermission(user.id, group.id, {
        can_view: true, can_assign: false, can_rename: false, can_makeover: false, can_tag: false,
      });

      await removePermission(user.id, group.id);
      const perm = await getPermission(user.id, group.id);
      expect(perm).toBeUndefined();
    });

    it('is a no-op if permission does not exist', async () => {
      // Should not throw
      await removePermission(999, 999);
    });
  });

  describe('getUserPermissions', () => {
    it('returns all group permissions for a user with group names', async () => {
      const user = await createTestUser({ swc_name: 'Pilot' });
      const g1 = await createTestGroup({ name: 'Alpha' });
      const g2 = await createTestGroup({ name: 'Beta' });

      await setPermission(user.id, g1.id, {
        can_view: true, can_assign: true, can_rename: false, can_makeover: false, can_tag: false,
      });
      await setPermission(user.id, g2.id, {
        can_view: true, can_assign: false, can_rename: true, can_makeover: false, can_tag: false,
      });

      const perms = await getUserPermissions(user.id);
      expect(perms).toHaveLength(2);
      expect(perms[0].group_name).toBe('Alpha');
      expect(perms[1].group_name).toBe('Beta');
    });

    it('returns empty array for user with no permissions', async () => {
      const user = await createTestUser({ swc_name: 'Nobody' });
      const perms = await getUserPermissions(user.id);
      expect(perms).toEqual([]);
    });
  });

  describe('getGroupUsers', () => {
    it('returns non-leader users with permissions on a group', async () => {
      const leader = await createTestUser({ swc_name: 'Leader', is_leader: 1 });
      const sub1 = await createTestUser({ swc_name: 'Sub1' });
      const sub2 = await createTestUser({ swc_name: 'Sub2' });
      const group = await createTestGroup({ name: 'Fleet' });

      await setPermission(leader.id, group.id, {
        can_view: true, can_assign: true, can_rename: true, can_makeover: true, can_tag: true,
      });
      await setPermission(sub1.id, group.id, {
        can_view: true, can_assign: true, can_rename: false, can_makeover: false, can_tag: false,
      });
      await setPermission(sub2.id, group.id, {
        can_view: true, can_assign: false, can_rename: false, can_makeover: false, can_tag: true,
      });

      const users = await getGroupUsers(group.id);
      // Should not include leader
      expect(users).toHaveLength(2);
      expect(users.map(u => u.swc_name).sort()).toEqual(['Sub1', 'Sub2']);
      const s1 = users.find(u => u.swc_name === 'Sub1');
      expect(s1.can_assign).toBe(1);
      expect(s1.can_tag).toBe(0);
    });
  });

  describe('getUserAccessibleGroups', () => {
    it('returns groups user can view with item counts and permissions', async () => {
      const { addItemToGroup } = await import('../../src/services/group-service.js');
      const user = await createTestUser({ swc_name: 'Pilot' });
      const g1 = await createTestGroup({ name: 'Alpha' });
      const g2 = await createTestGroup({ name: 'Beta' });
      const g3 = await createTestGroup({ name: 'Gamma' });

      // Add items to g1
      await addItemToGroup(g1.id, 'ships', '5:100', 'X-Wing', '');
      await addItemToGroup(g1.id, 'ships', '5:101', 'Y-Wing', '');

      // Give user access to g1 (view+assign) and g2 (view only), not g3
      await setPermission(user.id, g1.id, {
        can_view: true, can_assign: true, can_rename: false, can_makeover: false, can_tag: false,
      });
      await setPermission(user.id, g2.id, {
        can_view: true, can_assign: false, can_rename: false, can_makeover: false, can_tag: false,
      });

      const groups = await getUserAccessibleGroups(user.id);
      expect(groups).toHaveLength(2);
      const alpha = groups.find(g => g.name === 'Alpha');
      expect(alpha.item_count).toBe(2);
      expect(alpha.can_assign).toBe(1);
    });

    it('does not return groups where can_view is 0', async () => {
      const user = await createTestUser({ swc_name: 'Pilot' });
      const group = await createTestGroup({ name: 'Hidden' });
      await setPermission(user.id, group.id, {
        can_view: false, can_assign: true, can_rename: false, can_makeover: false, can_tag: false,
      });

      const groups = await getUserAccessibleGroups(user.id);
      expect(groups).toHaveLength(0);
    });
  });

  describe('canUserAccess', () => {
    it('returns true when user has the specific permission', async () => {
      const user = await createTestUser({ swc_name: 'Pilot' });
      const group = await createTestGroup({ name: 'Fleet' });
      await setPermission(user.id, group.id, {
        can_view: true, can_assign: true, can_rename: false, can_makeover: false, can_tag: false,
      });

      expect(await canUserAccess(user.id, group.id, 'view')).toBe(true);
      expect(await canUserAccess(user.id, group.id, 'assign')).toBe(true);
      expect(await canUserAccess(user.id, group.id, 'rename')).toBe(false);
    });

    it('returns false when no permission record exists', async () => {
      expect(await canUserAccess(999, 999, 'view')).toBe(false);
    });
  });
});
