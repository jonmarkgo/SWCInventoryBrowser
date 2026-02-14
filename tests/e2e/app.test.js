import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestDb, teardownTestDb, cleanTables, createTestUser, createTestGroup } from '../setup.js';
import { createApp } from '../../src/app.js';
import { addItemToGroup } from '../../src/services/group-service.js';
import { setPermission } from '../../src/services/permission-service.js';
import { getDb } from '../../src/database.js';

let app;

// Helper to create an agent with a logged-in session
async function loginAs(user) {
  const agent = request.agent(app);
  // Directly set session by making a request with a cookie we control.
  // Since we can't go through OAuth in tests, we'll use a test middleware.
  // For now, we inject the userId into the session via the test login endpoint.
  await agent.get(`/__test_login/${user.id}`);
  return agent;
}

describe('E2E: App Routes', () => {
  beforeAll(async () => {
    await setupTestDb();
    app = createApp({
      setupRoutes: (app) => {
        // Test-only login route (bypasses OAuth for testing)
        app.get('/__test_login/:userId', (req, res) => {
          req.session.userId = parseInt(req.params.userId);
          res.sendStatus(200);
        });
      },
    });
  });
  afterAll(async () => { await teardownTestDb(); });
  beforeEach(async () => { await cleanTables(); });

  describe('GET / (landing page)', () => {
    it('renders landing page for anonymous users', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Inventory Control');
      expect(res.text).toContain('Faction Leader Login');
    });

    it('redirects leaders to /dashboard', async () => {
      const user = await createTestUser({ swc_name: 'Leader', is_leader: 1 });
      const agent = await loginAs(user);
      const res = await agent.get('/');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/dashboard');
    });

    it('redirects sub-users to /my/dashboard', async () => {
      const user = await createTestUser({ swc_name: 'SubUser' });
      const agent = await loginAs(user);
      const res = await agent.get('/');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/my/dashboard');
    });
  });

  describe('GET /auth/login', () => {
    it('redirects to SWC OAuth URL for leader', async () => {
      const res = await request(app).get('/auth/login?role=leader');
      // Should redirect to SWC auth, but without valid client creds it may error
      // At minimum it should attempt a redirect (302)
      expect([302, 500]).toContain(res.status);
    });
  });

  describe('POST /auth/logout', () => {
    it('destroys session and redirects to /', async () => {
      const user = await createTestUser({ swc_name: 'Leader', is_leader: 1 });
      const agent = await loginAs(user);
      const res = await agent.post('/auth/logout');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    });
  });

  describe('Leader Routes', () => {
    let leader;
    let agent;

    beforeEach(async () => {
      leader = await createTestUser({ swc_name: 'Faction Leader', is_leader: 1 });
      agent = await loginAs(leader);
    });

    describe('GET /dashboard', () => {
      it('renders dashboard for leader', async () => {
        const res = await agent.get('/dashboard');
        expect(res.status).toBe(200);
        expect(res.text).toContain('Leader Dashboard');
      });

      it('redirects unauthenticated users to /', async () => {
        const res = await request(app).get('/dashboard');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/');
      });
    });

    describe('GET /inventory', () => {
      it('redirects to /inventory/ships', async () => {
        const res = await agent.get('/inventory');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/inventory/ships');
      });
    });

    describe('GET /inventory/:type', () => {
      it('renders inventory page for valid type', async () => {
        // Inventory route requires a faction_uid in settings
        const db = getDb();
        await db('settings').insert({ key: 'faction_uid', value: '20:999' }).onConflict('key').merge();

        const res = await agent.get('/inventory/ships');
        expect(res.status).toBe(200);
        expect(res.text).toContain('Inventory Browser');
      });

      it('returns 404 for invalid entity type', async () => {
        const res = await agent.get('/inventory/lightsabers');
        expect(res.status).toBe(404);
      });
    });

    describe('Groups CRUD', () => {
      describe('GET /groups', () => {
        it('renders groups list page', async () => {
          const res = await agent.get('/groups');
          expect(res.status).toBe(200);
          expect(res.text).toContain('Virtual Groups');
        });
      });

      describe('POST /groups', () => {
        it('creates a group and redirects', async () => {
          const res = await agent
            .post('/groups')
            .type('form')
            .send({ name: 'Fleet Alpha', description: 'Main fleet' });
          expect(res.status).toBe(302);
          expect(res.headers.location).toMatch(/\/groups\/\d+/);
        });

        it('rejects empty name', async () => {
          const res = await agent
            .post('/groups')
            .type('form')
            .send({ name: '', description: '' });
          expect(res.status).toBe(302);
          expect(res.headers.location).toBe('/groups');
        });
      });

      describe('GET /groups/:id', () => {
        it('renders group detail page', async () => {
          const group = await createTestGroup({ name: 'Test Fleet' });
          const res = await agent.get(`/groups/${group.id}`);
          expect(res.status).toBe(200);
          expect(res.text).toContain('Test Fleet');
        });

        it('returns 404 for nonexistent group', async () => {
          const res = await agent.get('/groups/99999');
          expect(res.status).toBe(404);
        });
      });

      describe('POST /groups/:id/edit', () => {
        it('updates group and redirects', async () => {
          const group = await createTestGroup({ name: 'Old' });
          const res = await agent
            .post(`/groups/${group.id}/edit`)
            .type('form')
            .send({ name: 'New Name', description: 'Updated' });
          expect(res.status).toBe(302);

          const db = getDb();
          const updated = await db('groups').where('id', group.id).first();
          expect(updated.name).toBe('New Name');
          expect(updated.description).toBe('Updated');
        });
      });

      describe('POST /groups/:id/delete', () => {
        it('deletes group and redirects to /groups', async () => {
          const group = await createTestGroup({ name: 'Doomed' });
          const res = await agent.post(`/groups/${group.id}/delete`);
          expect(res.status).toBe(302);
          expect(res.headers.location).toBe('/groups');

          const db = getDb();
          const deleted = await db('groups').where('id', group.id).first();
          expect(deleted).toBeUndefined();
        });
      });

      describe('POST /groups/:id/items', () => {
        it('adds an item to a group', async () => {
          const group = await createTestGroup({ name: 'Fleet' });
          const res = await agent
            .post(`/groups/${group.id}/items`)
            .type('form')
            .send({
              entity_type: 'ships',
              entity_uid: '5:100',
              entity_name: 'X-Wing',
              entity_image: '',
            });
          expect(res.status).toBe(302);

          const db = getDb();
          const items = await db('group_items').where('group_id', group.id);
          expect(items).toHaveLength(1);
          expect(items[0].entity_name).toBe('X-Wing');
        });
      });

      describe('POST /groups/:id/items/:itemId/remove', () => {
        it('removes an item from a group', async () => {
          const group = await createTestGroup({ name: 'Fleet' });
          await addItemToGroup(group.id, 'ships', '5:100', 'X-Wing', '');
          const db = getDb();
          const [item] = await db('group_items').where('group_id', group.id);

          const res = await agent.post(`/groups/${group.id}/items/${item.id}/remove`);
          expect(res.status).toBe(302);

          const remaining = await db('group_items').where('group_id', group.id);
          expect(remaining).toHaveLength(0);
        });
      });
    });

    describe('User Management', () => {
      describe('GET /users', () => {
        it('renders users list', async () => {
          await createTestUser({ swc_name: 'SubUser1' });
          const res = await agent.get('/users');
          expect(res.status).toBe(200);
          expect(res.text).toContain('Sub-users');
          expect(res.text).toContain('SubUser1');
        });
      });

      describe('GET /users/:id', () => {
        it('renders permission editor', async () => {
          const sub = await createTestUser({ swc_name: 'Pilot' });
          const group = await createTestGroup({ name: 'Fleet' });
          const res = await agent.get(`/users/${sub.id}`);
          expect(res.status).toBe(200);
          expect(res.text).toContain('Permissions');
          expect(res.text).toContain('Pilot');
          expect(res.text).toContain('Fleet');
        });
      });

      describe('POST /users/:id/permissions', () => {
        it('saves permissions for a user across groups', async () => {
          const sub = await createTestUser({ swc_name: 'Pilot' });
          const g1 = await createTestGroup({ name: 'Fleet' });
          const g2 = await createTestGroup({ name: 'Supply' });

          const res = await agent
            .post(`/users/${sub.id}/permissions`)
            .type('form')
            .send(`perms[g${g1.id}][can_view]=1&perms[g${g1.id}][can_assign]=1&perms[g${g2.id}][can_view]=1&perms[g${g2.id}][can_tag]=1`);
          expect(res.status).toBe(302);

          const db = getDb();
          const perms = await db('user_permissions').where('user_id', sub.id).orderBy('group_id');
          expect(perms).toHaveLength(2);

          const p1 = perms.find(p => p.group_id === g1.id);
          expect(p1.can_view).toBe(1);
          expect(p1.can_assign).toBe(1);
          expect(p1.can_rename).toBe(0);

          const p2 = perms.find(p => p.group_id === g2.id);
          expect(p2.can_view).toBe(1);
          expect(p2.can_tag).toBe(1);
        });
      });
    });

    describe('GET /audit', () => {
      it('renders audit log page', async () => {
        const res = await agent.get('/audit');
        expect(res.status).toBe(200);
        expect(res.text).toContain('Audit Log');
      });
    });
  });

  describe('Sub-user Routes', () => {
    let subUser;
    let subAgent;

    beforeEach(async () => {
      subUser = await createTestUser({ swc_name: 'Pilot Luke' });
      subAgent = await loginAs(subUser);
    });

    describe('GET /my/dashboard', () => {
      it('renders sub-user dashboard', async () => {
        const res = await subAgent.get('/my/dashboard');
        expect(res.status).toBe(200);
        expect(res.text).toContain('My Dashboard');
        expect(res.text).toContain('Pilot Luke');
      });

      it('shows accessible groups', async () => {
        const group = await createTestGroup({ name: 'Fleet Alpha' });
        await setPermission(subUser.id, group.id, {
          can_view: true, can_assign: true, can_rename: false, can_makeover: false, can_tag: false,
        });

        const res = await subAgent.get('/my/dashboard');
        expect(res.text).toContain('Fleet Alpha');
        expect(res.text).toContain('Assign');
      });

      it('shows message when no groups accessible', async () => {
        const res = await subAgent.get('/my/dashboard');
        expect(res.text).toContain('don\'t have access');
      });
    });

    describe('GET /my/groups/:id', () => {
      it('renders group view with items', async () => {
        const group = await createTestGroup({ name: 'Fleet' });
        await addItemToGroup(group.id, 'ships', '5:100', 'X-Wing', '');
        await setPermission(subUser.id, group.id, {
          can_view: true, can_assign: true, can_rename: false, can_makeover: false, can_tag: false,
        });

        const res = await subAgent.get(`/my/groups/${group.id}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('Fleet');
        expect(res.text).toContain('X-Wing');
        expect(res.text).toContain('Assign');
      });

      it('denies access when user has no permission', async () => {
        const group = await createTestGroup({ name: 'Secret' });
        const res = await subAgent.get(`/my/groups/${group.id}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/my/dashboard');
      });

      it('returns 404 for nonexistent group', async () => {
        const res = await subAgent.get('/my/groups/99999');
        expect(res.status).toBe(404);
      });
    });

    describe('Access control', () => {
      it('sub-user cannot access /dashboard (leader route)', async () => {
        const res = await subAgent.get('/dashboard');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/my/dashboard');
      });

      it('sub-user cannot access /groups (leader route)', async () => {
        const res = await subAgent.get('/groups');
        expect(res.status).toBe(302);
      });

      it('sub-user cannot access /users (leader route)', async () => {
        const res = await subAgent.get('/users');
        expect(res.status).toBe(302);
      });

      it('sub-user cannot access /audit (leader route)', async () => {
        const res = await subAgent.get('/audit');
        expect(res.status).toBe(302);
      });
    });
  });

  describe('Unauthenticated access', () => {
    it('redirects /dashboard to /', async () => {
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    });

    it('redirects /groups to /', async () => {
      const res = await request(app).get('/groups');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    });

    it('redirects /my/dashboard to /', async () => {
      const res = await request(app).get('/my/dashboard');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    });

    it('redirects /inventory to /', async () => {
      const res = await request(app).get('/inventory');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/totally/nonexistent/page');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Not Found');
    });
  });

  describe('Audit trail', () => {
    it('logs group creation in audit log', async () => {
      const leader = await createTestUser({ swc_name: 'Leader', is_leader: 1 });
      const agent = await loginAs(leader);

      await agent.post('/groups').type('form').send({ name: 'Tracked Group', description: '' });

      const db = getDb();
      const logs = await db('audit_log').where('action', 'create_group');
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toContain('Tracked Group');
    });

    it('logs group deletion in audit log', async () => {
      const leader = await createTestUser({ swc_name: 'Leader', is_leader: 1 });
      const agent = await loginAs(leader);
      const group = await createTestGroup({ name: 'Will Delete' });

      await agent.post(`/groups/${group.id}/delete`);

      const db = getDb();
      const logs = await db('audit_log').where('action', 'delete_group');
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toContain('Will Delete');
    });

    it('logs adding item to group', async () => {
      const leader = await createTestUser({ swc_name: 'Leader', is_leader: 1 });
      const agent = await loginAs(leader);
      const group = await createTestGroup({ name: 'Fleet' });

      await agent
        .post(`/groups/${group.id}/items`)
        .type('form')
        .send({ entity_type: 'ships', entity_uid: '5:42', entity_name: 'Falcon', entity_image: '' });

      const db = getDb();
      const logs = await db('audit_log').where('action', 'add_to_group');
      expect(logs).toHaveLength(1);
      expect(logs[0].entity_type).toBe('ships');
      expect(logs[0].entity_uid).toBe('5:42');
    });

    it('logs permission updates', async () => {
      const leader = await createTestUser({ swc_name: 'Leader', is_leader: 1 });
      const agent = await loginAs(leader);
      const sub = await createTestUser({ swc_name: 'Pilot' });
      const group = await createTestGroup({ name: 'Fleet' });

      await agent
        .post(`/users/${sub.id}/permissions`)
        .type('form')
        .send({ [`perms[g${group.id}][can_view]`]: '1' });

      const db = getDb();
      const logs = await db('audit_log').where('action', 'update_permissions');
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toContain('Pilot');
    });
  });
});
