import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { getInventorySummary } from '../services/inventory-service.js';
import { getAllGroups } from '../services/group-service.js';
import { getFactionUid, getFactionName, storeFactionUid, storeFactionName } from '../swc-client.js';
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
  });
});

// POST /dashboard/faction - set faction UID manually
router.post('/faction', requireLeader, async (req, res) => {
  const { faction_uid, faction_name } = req.body;
  if (!faction_uid || !faction_uid.trim()) {
    setFlash(req, 'danger', 'Faction UID is required.');
    return res.redirect('/dashboard');
  }
  await storeFactionUid(faction_uid.trim());
  await storeFactionName((faction_name || 'Custom Faction').trim());
  setFlash(req, 'success', `Faction set to ${faction_uid.trim()}.`);
  res.redirect('/dashboard');
});

export default router;
