/**
 * Shared test setup: creates an in-memory SQLite DB, initializes schema,
 * and tears it down after each test suite.
 */
import Knex from 'knex';
import { setDb, closeDb } from '../src/database.js';
import { initDatabase } from '../src/database.js';
import { beforeEach, afterAll } from 'vitest';

let db;

export async function setupTestDb() {
  // Close any existing connection
  await closeDb();

  // Create in-memory database
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  setDb(db);
  await initDatabase();
  return db;
}

export async function teardownTestDb() {
  await closeDb();
}

export async function cleanTables() {
  if (!db) return;
  // Clean in reverse order of dependencies
  await db('audit_log').del();
  await db('user_permissions').del();
  await db('group_items').del();
  await db('inventory_cache').del();
  await db('inventory_owners').del();
  await db('users').del();
  await db('groups').del();
  await db('settings').del();
}

/**
 * Insert a test user and return their id.
 */
export async function createTestUser(overrides = {}) {
  const data = {
    swc_uid: overrides.swc_uid || `1:${Math.floor(Math.random() * 99999)}`,
    swc_name: overrides.swc_name || 'Test User',
    is_leader: overrides.is_leader || 0,
    ...overrides,
  };
  const [id] = await db('users').insert(data);
  return { id, ...data };
}

/**
 * Insert a test owner and return it.
 */
export async function createTestOwner(overrides = {}) {
  const data = {
    uid: overrides.uid || `20:${Math.floor(Math.random() * 99999)}`,
    name: overrides.name || 'Test Faction',
    owner_type: overrides.owner_type || 'faction',
    enabled: overrides.enabled ?? 1,
    is_primary: overrides.is_primary ?? 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  await db('inventory_owners').insert(data);
  return data;
}

/**
 * Insert a test group and return it.
 */
export async function createTestGroup(overrides = {}) {
  const data = {
    name: overrides.name || 'Test Group',
    description: overrides.description || '',
    ...overrides,
  };
  const [id] = await db('groups').insert(data);
  return { id, ...data };
}
