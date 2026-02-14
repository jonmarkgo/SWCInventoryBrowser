# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Run server (node server.js)
npm run dev            # Run with auto-restart (node --watch server.js)
npm test               # Run all tests once (vitest run)
npm run test:watch     # Run tests in watch mode (vitest)
npx vitest run tests/unit/group-service.test.js   # Run a single test file
```

## Architecture

This is a Star Wars Combine faction inventory management app. A faction leader authenticates via OAuth, and their token is stored and used to execute all inventory API calls — including actions performed by sub-users.

### App Factory

`src/app.js` exports `createApp({ setupRoutes })`. The optional `setupRoutes` hook lets tests inject routes (e.g. a test login endpoint) before the 404 handler is registered. This is the only way to add test-only routes.

### Two Auth Roles

- **Leader**: Full access. OAuth grants faction inventory scopes. Token persisted in `settings` table and restored on startup via `restoreLeaderClient()`.
- **Sub-user**: Identity-only OAuth (CHARACTER_AUTH + CHARACTER_READ). No token stored. All inventory operations go through the leader's client.

Middleware chain: `sessionUserMiddleware` (always) → `requireAuth` / `requireLeader` / `requireSubuser` (per-route).

### Inventory Caching

`inventory-service.js` fetches from the SWC API and caches in SQLite. Cache TTL is 6 hours. The `INVENTORY_FETCH_LIMIT` env var caps items fetched per entity type (useful for testing). The SWC API wraps entities in `{attributes, value}` — `unwrapEntity()` handles this. Materials lack individual UIDs, so they get synthetic keys (`typeUid@locationUid`).

### Database

Knex with better-sqlite3. `getDb()` lazily initializes; `setDb()`/`closeDb()` exist for test injection with in-memory SQLite. Schema auto-creates on `initDatabase()`.

### Services

Each service module (`group-service`, `permission-service`, `audit-service`, `inventory-service`) is a set of exported async functions that operate on the database via `getDb()`. No classes, no singletons.

## Testing

Vitest must use `pool: 'forks'` and `fileParallelism: false` for SQLite compatibility. Tests use in-memory SQLite via `setupTestDb()` from `tests/setup.js`. E2E tests bypass OAuth with a `/__test_login/:userId` route injected through the `setupRoutes` hook.

## Gotchas

- **Express 5 qs parsing**: Numeric bracket keys like `perms[1][can_view]` become arrays. All form fields with numeric IDs must use a `g` prefix (e.g. `perms[g1][can_view]`), and the handler strips it with `perms['g' + group.id]`.
- **express-ejs-layouts**: Layout is set once at the app level. Never use `<% layout() %>` in templates.
- **Faction UID vs Character UID**: Inventory API calls need the faction UID (`20:xxx`), not the character UID (`1:xxx`). These are stored separately in settings as `faction_uid` and `leader_uid`.
- **`inventory.entities.list()`**: Requires three params: `uid`, `entityType`, and `assignType` ('owner'/'commander'/'pilot').
- **SWC API rate limit**: 600 requests/hour.
