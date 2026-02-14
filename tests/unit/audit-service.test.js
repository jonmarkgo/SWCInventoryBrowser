import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, cleanTables, createTestUser } from '../setup.js';
import { logAction, getAuditLog } from '../../src/services/audit-service.js';

describe('audit-service', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await teardownTestDb(); });
  beforeEach(async () => { await cleanTables(); });

  describe('logAction', () => {
    it('inserts an audit log entry', async () => {
      const user = await createTestUser({ swc_name: 'Leader' });
      await logAction(user.id, 'create_group', null, null, 'Created group "Fleet"');

      const result = await getAuditLog();
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].action).toBe('create_group');
      expect(result.rows[0].details).toBe('Created group "Fleet"');
      expect(result.rows[0].user_name).toBe('Leader');
    });

    it('stores entity type and uid', async () => {
      const user = await createTestUser({ swc_name: 'Pilot' });
      await logAction(user.id, 'assign', 'ships', '5:100', 'Assigned to 1:999');

      const result = await getAuditLog();
      expect(result.rows[0].entity_type).toBe('ships');
      expect(result.rows[0].entity_uid).toBe('5:100');
    });

    it('allows null user_id for system actions', async () => {
      await logAction(null, 'system_refresh', null, null, 'Auto refresh');
      const result = await getAuditLog();
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].user_name).toBeNull();
    });
  });

  describe('getAuditLog', () => {
    it('returns entries in descending order by time', async () => {
      const user = await createTestUser({ swc_name: 'Leader' });
      await logAction(user.id, 'action_1', null, null, 'First');
      await logAction(user.id, 'action_2', null, null, 'Second');
      await logAction(user.id, 'action_3', null, null, 'Third');

      const result = await getAuditLog();
      expect(result.rows).toHaveLength(3);
      // Most recent first
      expect(result.rows[0].action).toBe('action_3');
      expect(result.rows[2].action).toBe('action_1');
    });

    it('paginates results', async () => {
      const user = await createTestUser({ swc_name: 'Leader' });
      for (let i = 0; i < 5; i++) {
        await logAction(user.id, `action_${i}`, null, null, `Action ${i}`);
      }

      const page1 = await getAuditLog({ page: 1, limit: 2 });
      expect(page1.rows).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.pages).toBe(3);
      expect(page1.page).toBe(1);

      const page2 = await getAuditLog({ page: 2, limit: 2 });
      expect(page2.rows).toHaveLength(2);

      const page3 = await getAuditLog({ page: 3, limit: 2 });
      expect(page3.rows).toHaveLength(1);
    });

    it('filters by userId', async () => {
      const u1 = await createTestUser({ swc_name: 'User1' });
      const u2 = await createTestUser({ swc_name: 'User2' });
      await logAction(u1.id, 'action_a', null, null, '');
      await logAction(u2.id, 'action_b', null, null, '');
      await logAction(u1.id, 'action_c', null, null, '');

      const result = await getAuditLog({ userId: u1.id });
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
      result.rows.forEach(r => expect(r.user_name).toBe('User1'));
    });

    it('filters by action substring', async () => {
      const user = await createTestUser({ swc_name: 'Leader' });
      await logAction(user.id, 'create_group', null, null, '');
      await logAction(user.id, 'delete_group', null, null, '');
      await logAction(user.id, 'assign', null, null, '');

      const result = await getAuditLog({ action: 'group' });
      expect(result.rows).toHaveLength(2);
    });

    it('filters by entity type', async () => {
      const user = await createTestUser({ swc_name: 'Leader' });
      await logAction(user.id, 'assign', 'ships', '5:100', '');
      await logAction(user.id, 'assign', 'items', '10:200', '');
      await logAction(user.id, 'rename', 'ships', '5:101', '');

      const result = await getAuditLog({ entityType: 'ships' });
      expect(result.rows).toHaveLength(2);
    });

    it('combines multiple filters', async () => {
      const user = await createTestUser({ swc_name: 'Leader' });
      await logAction(user.id, 'assign', 'ships', '5:100', '');
      await logAction(user.id, 'assign', 'items', '10:200', '');
      await logAction(user.id, 'rename', 'ships', '5:101', '');

      const result = await getAuditLog({ action: 'assign', entityType: 'ships' });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].entity_uid).toBe('5:100');
    });

    it('returns empty result set with no entries', async () => {
      const result = await getAuditLog();
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.pages).toBe(0);
    });
  });
});
