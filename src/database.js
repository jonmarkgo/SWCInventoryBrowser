import Knex from 'knex';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

let knex;

export function getDb() {
  if (!knex) {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    knex = Knex({
      client: 'better-sqlite3',
      connection: { filename: config.dbPath },
      useNullAsDefault: true,
    });
  }
  return knex;
}

// For testing: override the knex instance (e.g. with an in-memory DB)
export function setDb(instance) {
  knex = instance;
}

// For testing: close and clear the connection
export async function closeDb() {
  if (knex) {
    await knex.destroy();
    knex = null;
  }
}

export async function initDatabase() {
  const db = getDb();

  // Settings table
  if (!(await db.schema.hasTable('settings'))) {
    await db.schema.createTable('settings', (t) => {
      t.text('key').primary();
      t.text('value');
    });
  }

  // Groups table
  if (!(await db.schema.hasTable('groups'))) {
    await db.schema.createTable('groups', (t) => {
      t.increments('id').primary();
      t.text('name').notNullable();
      t.text('description').defaultTo('');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // Group items table
  if (!(await db.schema.hasTable('group_items'))) {
    await db.schema.createTable('group_items', (t) => {
      t.increments('id').primary();
      t.integer('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE');
      t.text('entity_type').notNullable();
      t.text('entity_uid').notNullable();
      t.text('entity_name').defaultTo('');
      t.text('entity_image').defaultTo('');
      t.timestamp('added_at').defaultTo(db.fn.now());
      t.unique(['group_id', 'entity_type', 'entity_uid']);
    });
  }

  // Users table
  if (!(await db.schema.hasTable('users'))) {
    await db.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('swc_uid').unique().notNullable();
      t.text('swc_name').notNullable();
      t.integer('is_leader').defaultTo(0);
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // User permissions table
  if (!(await db.schema.hasTable('user_permissions'))) {
    await db.schema.createTable('user_permissions', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.integer('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE');
      t.integer('can_view').defaultTo(1);
      t.integer('can_assign').defaultTo(0);
      t.integer('can_rename').defaultTo(0);
      t.integer('can_makeover').defaultTo(0);
      t.integer('can_tag').defaultTo(0);
      t.unique(['user_id', 'group_id']);
    });
  }

  // Audit log table
  if (!(await db.schema.hasTable('audit_log'))) {
    await db.schema.createTable('audit_log', (t) => {
      t.increments('id').primary();
      t.integer('user_id').references('id').inTable('users');
      t.text('action').notNullable();
      t.text('entity_type');
      t.text('entity_uid');
      t.text('details').defaultTo('');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // Inventory owners table
  if (!(await db.schema.hasTable('inventory_owners'))) {
    await db.schema.createTable('inventory_owners', (t) => {
      t.text('uid').primary();
      t.text('owner_type').notNullable();
      t.text('name').notNullable();
      t.integer('enabled').defaultTo(1);
      t.integer('is_primary').defaultTo(0);
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // Inventory cache table
  if (!(await db.schema.hasTable('inventory_cache'))) {
    await db.schema.createTable('inventory_cache', (t) => {
      t.increments('id').primary();
      t.text('owner_uid').notNullable();
      t.text('entity_type').notNullable();
      t.text('entity_uid').notNullable();
      t.text('entity_name').defaultTo('');
      t.text('entity_image').defaultTo('');
      t.text('entity_data').defaultTo('{}');
      t.timestamp('cached_at').defaultTo(db.fn.now());
      t.index(['owner_uid', 'entity_type']);
    });
  }
}
