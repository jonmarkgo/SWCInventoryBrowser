import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { getInventorySummary } from '../services/inventory-service.js';
import { getAllGroups } from '../services/group-service.js';
import { getFactionUid, getFactionName, storeFactionUid, storeFactionName, getLeaderClient } from '../swc-client.js';
import { getDb } from '../database.js';
import { setFlash } from '../middleware/flash.js';

const router = Router();

router.get('/', requireLeader, async (req, res) => {
  const factionUid = await getFactionUid();
  const factionName = await getFactionName();
  const inventorySummary = factionUid ? await getInventorySummary(factionUid) : [];
  const groups = await getAllGroups();
  const db = getDb();
  const [{ count: totalUsers }] = await db('users').where('is_leader', 0).count('* as count');

  const totalItems = inventorySummary.reduce((sum, r) => sum + (r.count || 0), 0);

  // Fetch the leader's faction memberships for the dropdown
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

  res.render('dashboard', {
    title: 'Dashboard',
    summary: {
      totalItems,
      totalGroups: groups.length,
      totalUsers,
    },
    inventorySummary,
    factionUid,
    factionName,
    factions,
  });
});

// POST /dashboard/faction - set active faction from dropdown
router.post('/faction', requireLeader, async (req, res) => {
  const { faction_selection } = req.body;
  if (!faction_selection?.trim()) {
    setFlash(req, 'danger', 'Please select a faction.');
    return res.redirect('/dashboard');
  }

  // faction_selection format: "uid|name"
  const pipeIdx = faction_selection.indexOf('|');
  const uid = pipeIdx >= 0 ? faction_selection.slice(0, pipeIdx) : faction_selection;
  const name = pipeIdx >= 0 ? faction_selection.slice(pipeIdx + 1) : 'Unknown';

  await storeFactionUid(uid.trim());
  await storeFactionName(name.trim());
  setFlash(req, 'success', `Active faction set to ${name.trim()}.`);
  res.redirect('/dashboard');
});

export default router;
