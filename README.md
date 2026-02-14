# SWC Inventory Control Panel

A web-based inventory management system for [Star Wars Combine](https://www.swcombine.com/) faction leaders. Organize faction assets into virtual groups, delegate access to sub-users with granular permissions, and execute inventory operations through a single authenticated leader token.

## Features

- **Faction Inventory Browser** -- Browse all 10 entity types (ships, vehicles, stations, cities, facilities, items, NPCs, droids, creatures, materials) with search and pagination. Inventory is cached locally with a 6-hour TTL and can be manually refreshed.

- **Virtual Groups** -- Create groups to organize inventory items regardless of type. A single group can contain ships, vehicles, items, and anything else. Add or remove items freely.

- **Sub-user Permissions** -- Sub-users authenticate via SWC OAuth to verify their in-game identity. Leaders assign per-group permissions with five granular access levels: view, assign, rename, makeover, and tag.

- **Delegated Actions** -- All inventory operations (assigning, renaming, makeover, tagging) execute through the faction leader's stored OAuth token. Sub-users never need direct API access.

- **Audit Trail** -- Every action is logged with the user, action type, entity, and timestamp. Leaders can filter and review the full audit history.

- **Dark Space Theme** -- Bootstrap 5 dark theme with a star-field background and cyan accents.

## Prerequisites

- Node.js 18+ (tested with Node 22)
- A [Star Wars Combine](https://www.swcombine.com/) account
- An SWC OAuth application (register at https://www.swcombine.com/ws/oauth2/applications/)

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd swc-inventory-test
npm install
```

### 2. Configure environment

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `SWC_CLIENT_ID` | Yes | Your SWC OAuth application client ID |
| `SWC_CLIENT_SECRET` | Yes | Your SWC OAuth application client secret |
| `SWC_REDIRECT_URI` | No | OAuth callback URL. Defaults to `{BASE_URL}/auth/callback` |
| `BASE_URL` | Yes | Public URL of your app (e.g. `https://yourdomain.com`) |
| `SESSION_SECRET` | Yes | Random string for session encryption |
| `PORT` | No | Server port (default: `3000`) |
| `DB_PATH` | No | SQLite database path (default: `./data/inventory.db`) |
| `INVENTORY_FETCH_LIMIT` | No | Max items to fetch per entity type. `0` = no limit. Useful for testing with large inventories |

### 3. Register OAuth callback

In your SWC OAuth application settings, set the callback URL to match your `SWC_REDIRECT_URI` (or `{BASE_URL}/auth/callback` if not set).

### 4. Run

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

The app will create the SQLite database and all tables automatically on first run.

## Usage

### Leader Setup

1. Open the app and click **Faction Leader Login**
2. Authorize with your SWC account -- the app requests faction inventory and faction read scopes
3. Your primary faction is auto-detected. If you need a different faction, use the **Change** button on the dashboard to enter the faction UID (format: `20:xxx`)
4. Click **Refresh All** to populate the inventory cache

### Managing Groups

1. Go to **Manage Groups** and create groups (e.g. "Combat Fleet", "Mining Operations")
2. Browse inventory under **Browse Inventory** and add items to groups
3. Each item can belong to multiple groups

### Managing Sub-users

1. Have sub-users log in via **Sub-user Login** -- they only authorize character identity scopes
2. Go to **Manage Users** to see all registered sub-users
3. Click a user to open the permission editor
4. Check the permissions you want to grant for each group

### Sub-user Experience

Sub-users see their own dashboard with only the groups they have access to. Within each group, they can perform actions based on their permissions (view items, assign, rename, makeover, tag). All actions execute via the leader's stored token and are logged in the audit trail.

## Project Structure

```
server.js                   # Entry point
src/
  app.js                    # Express app factory
  config.js                 # Environment config
  database.js               # Knex + SQLite schema
  swc-client.js             # SWC SDK OAuth and client management
  middleware/
    auth.js                 # requireLeader, requireSubuser, requireAuth
    flash.js                # Flash messages
  routes/
    auth.js                 # OAuth login/callback/logout
    dashboard.js            # Leader dashboard + faction config
    inventory.js            # Inventory browser + cache refresh
    groups.js               # Group CRUD + item management
    users.js                # Sub-user listing + permission editor
    my.js                   # Sub-user dashboard + actions
    audit.js                # Audit log viewer
    api.js                  # JSON API endpoints
  services/
    inventory-service.js    # API fetching, caching, pagination
    group-service.js        # Group and group-item operations
    permission-service.js   # Permission CRUD
    audit-service.js        # Audit logging and queries
views/                      # EJS templates
public/                     # Static assets (CSS, JS)
data/                       # SQLite database (auto-created)
tests/
  setup.js                  # Shared test helpers + in-memory DB
  unit/                     # Service-level unit tests
  e2e/                      # Full route integration tests
```

## Testing

The test suite uses [Vitest](https://vitest.dev/) with [supertest](https://github.com/ladjs/supertest) for HTTP assertions. Tests run against an in-memory SQLite database, so no setup is needed.

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch
```

**94 tests** across 5 test files:

- **Unit tests (52 tests)** -- group-service, permission-service, audit-service, inventory-service (SWC API mocked)
- **End-to-end tests (42 tests)** -- full route testing with session simulation, covering auth, dashboard, inventory, groups, users, permissions, sub-user access control, and audit trail

The app factory accepts a `setupRoutes` callback for injecting test-only routes (e.g. a test login endpoint that bypasses OAuth).

## Database

SQLite with 7 tables:

| Table | Purpose |
|---|---|
| `settings` | App config (leader token, faction UID/name) |
| `users` | User accounts with SWC identity |
| `groups` | Virtual item groups |
| `group_items` | Items assigned to groups |
| `user_permissions` | Per-user, per-group permission flags |
| `audit_log` | Action history |
| `inventory_cache` | Cached inventory with TTL |

The database file and tables are created automatically. To reset, delete `data/inventory.db` and restart.

## SWC API Notes

- The app uses the [swcombine-sdk](https://www.npmjs.com/package/swcombine-sdk) npm package
- Faction inventory uses the faction UID (e.g. `20:502`), not the character UID
- `inventory.entities.list()` requires `uid`, `entityType`, and `assignType` parameters
- Materials don't have individual UIDs -- they're identified by type + location
- SWC API rate limit: 600 requests/hour
- OAuth scopes requested: faction inventory (all types), faction read, faction members, character auth, character read
