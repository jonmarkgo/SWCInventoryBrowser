import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { getMultiOwnerSummary } from '../services/inventory-service.js';
import { getAllGroups } from '../services/group-service.js';
import { getEnabledOwners, getAllOwners, syncOwners } from '../services/owner-service.js';
import { getLeaderClient } from '../swc-client.js';
import { getDb } from '../database.js';
import { setFlash } from '../middleware/flash.js';

const router = Router();

router.get('/', requireLeader, async (req, res) => {
  const owners = await getEnabledOwners();
  const ownerUids = owners.map(o => o.uid);
  const summaryRows = ownerUids.length > 0 ? await getMultiOwnerSummary(ownerUids) : [];
  const groups = await getAllGroups();
  const db = getDb();
  const [{ count: totalUsers }] = await db('users').where('is_leader', 0).count('* as count');

  const totalItems = summaryRows.reduce((sum, r) => sum + (r.count || 0), 0);

  // Build per-owner summary: { uid: { name, type, items, lastCached } }
  const ownerMap = {};
  for (const o of owners) {
    ownerMap[o.uid] = { name: o.name, ownerType: o.owner_type, items: 0, lastCached: null };
  }
  for (const row of summaryRows) {
    if (ownerMap[row.owner_uid]) {
      ownerMap[row.owner_uid].items += row.count || 0;
      const rowTime = row.last_cached ? new Date(row.last_cached) : null;
      if (rowTime && (!ownerMap[row.owner_uid].lastCached || rowTime > ownerMap[row.owner_uid].lastCached)) {
        ownerMap[row.owner_uid].lastCached = rowTime;
      }
    }
  }

  // Fetch the leader's faction memberships for the checkbox list
  let factions = [];
  const client = getLeaderClient();
  if (client) {
    try {
      const me = await client.character.me();
      if (Array.isArray(me?.factions)) {
        factions = me.factions.map(f => ({
          uid: f.attributes?.uid || f.uid || '',
          name: f.value || f.name || 'Unknown',
          primary: !!f.primary,
        })).filter(f => f.uid);
      }
    } catch (err) {
      console.error('Failed to fetch character factions:', err.message);
    }
  }

  // Mark which factions are currently enabled
  const enabledSet = new Set(ownerUids);

  res.render('dashboard', {
    title: 'Dashboard',
    summary: {
      totalItems,
      totalGroups: groups.length,
      totalUsers,
    },
    owners,
    ownerMap,
    factions,
    enabledSet,
  });
});

// POST /dashboard/owners - set enabled owners from checkbox list
router.post('/owners', requireLeader, async (req, res) => {
  let selectedUids = req.body.owner_uids || [];
  if (typeof selectedUids === 'string') selectedUids = [selectedUids];

  // Fetch factions from API to get full metadata
  const client = getLeaderClient();
  let factions = [];
  if (client) {
    try {
      const me = await client.character.me();
      if (Array.isArray(me?.factions)) {
        factions = me.factions.map(f => ({
          uid: f.attributes?.uid || f.uid || '',
          name: f.value || f.name || 'Unknown',
          type: 'faction',
          primary: !!f.primary,
        })).filter(f => f.uid);
      }
    } catch (err) {
      console.error('Failed to fetch factions for sync:', err.message);
    }
  }

  if (factions.length === 0) {
    setFlash(req, 'danger', 'Could not load faction list from API.');
    return res.redirect('/dashboard');
  }

  await syncOwners(factions, selectedUids);

  const enabledCount = selectedUids.length;
  setFlash(req, 'success', `${enabledCount} owner(s) enabled.`);
  res.redirect('/dashboard');
});

export default router;
