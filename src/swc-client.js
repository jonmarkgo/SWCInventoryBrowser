import { SWCombine, CharacterScopes, Scopes } from 'swcombine-sdk';
import { config } from './config.js';
import { getDb } from './database.js';

let leaderClient = null;

// All scopes needed for the faction leader (full inventory management)
const LEADER_SCOPES = [
  CharacterScopes.AUTH,
  CharacterScopes.READ,
  Scopes.FactionInventory.OVERVIEW,
  Scopes.FactionInventory.SHIPS.ALL,
  Scopes.FactionInventory.VEHICLES.ALL,
  Scopes.FactionInventory.STATIONS.ALL,
  Scopes.FactionInventory.CITIES.ALL,
  Scopes.FactionInventory.FACILITIES.ALL,
  Scopes.FactionInventory.ITEMS.ALL,
  Scopes.FactionInventory.NPCS.ALL,
  Scopes.FactionInventory.DROIDS.ALL,
  Scopes.FactionInventory.CREATURES.ALL,
  Scopes.FactionInventory.MATERIALS.ALL,
  Scopes.Faction.READ,
  Scopes.Faction.MEMBERS,
];

// Minimal scopes for sub-user identity verification
const SUBUSER_SCOPES = [
  CharacterScopes.AUTH,
  CharacterScopes.READ,
];

// Resolve the OAuth redirect URI (explicit env var > auto-derived from BASE_URL)
const resolvedRedirectUri = config.swc.redirectUri || `${config.baseUrl}/auth/callback`;

function createBaseClient() {
  return new SWCombine({
    clientId: config.swc.clientId,
    clientSecret: config.swc.clientSecret,
    redirectUri: resolvedRedirectUri,
    accessType: 'offline',
  });
}

export function getRedirectPath() {
  try {
    return new URL(resolvedRedirectUri).pathname;
  } catch {
    return '/auth/callback';
  }
}

export function getLeaderAuthUrl(state) {
  const client = createBaseClient();
  return client.auth.getAuthorizationUrl({ scopes: LEADER_SCOPES, state });
}

export function getSubuserAuthUrl(state) {
  const client = createBaseClient();
  return client.auth.getAuthorizationUrl({ scopes: SUBUSER_SCOPES, state });
}

export async function handleOAuthCallback(query) {
  const client = createBaseClient();
  return client.auth.handleCallback(query);
}

// Store and restore leader token from DB
async function storeLeaderToken(tokenData) {
  const db = getDb();
  await db('settings')
    .insert({ key: 'leader_token', value: JSON.stringify(tokenData) })
    .onConflict('key')
    .merge();
}

async function loadLeaderToken() {
  const db = getDb();
  const row = await db('settings').where('key', 'leader_token').first();
  if (!row?.value) return null;
  return JSON.parse(row.value);
}

export async function storeLeaderUid(uid) {
  const db = getDb();
  await db('settings')
    .insert({ key: 'leader_uid', value: uid })
    .onConflict('key')
    .merge();
}

export async function getLeaderUid() {
  const db = getDb();
  const row = await db('settings').where('key', 'leader_uid').first();
  return row?.value || null;
}

export async function storeFactionUid(uid) {
  const db = getDb();
  await db('settings')
    .insert({ key: 'faction_uid', value: uid })
    .onConflict('key')
    .merge();
}

export async function getFactionUid() {
  const db = getDb();
  const row = await db('settings').where('key', 'faction_uid').first();
  return row?.value || null;
}

export async function storeFactionName(name) {
  const db = getDb();
  await db('settings')
    .insert({ key: 'faction_name', value: name })
    .onConflict('key')
    .merge();
}

export async function getFactionName() {
  const db = getDb();
  const row = await db('settings').where('key', 'faction_name').first();
  return row?.value || null;
}

// Detect the leader's primary faction using the API
export async function detectFaction() {
  if (!leaderClient) return null;
  try {
    const faction = await leaderClient.faction.get();
    if (faction?.uid) {
      await storeFactionUid(faction.uid);
      await storeFactionName(faction.name || 'Unknown Faction');
      return faction;
    }
  } catch (err) {
    console.error('Failed to detect faction:', err.message);
  }
  return null;
}

// Initialize/get the leader client with stored token
export function getLeaderClient() {
  return leaderClient;
}

export async function initLeaderClient(tokenData) {
  await storeLeaderToken(tokenData);
  leaderClient = createBaseClient();
  leaderClient.setToken(tokenData);
  return leaderClient;
}

export async function restoreLeaderClient() {
  const tokenData = await loadLeaderToken();
  if (!tokenData) return null;
  leaderClient = createBaseClient();
  leaderClient.setToken(tokenData);
  return leaderClient;
}

// Create a temporary client for sub-user identity check
export function createTempClient(token) {
  const client = createBaseClient();
  client.setToken(token);
  return client;
}
