import { Router } from 'express';
import { requireLeader } from '../middleware/auth.js';
import { getInventorySummary } from '../services/inventory-service.js';
import { getAllGroups } from '../services/group-service.js';
import { getLeaderUid } from '../swc-client.js';
import { getDb } from '../database.js';

const router = Router();

router.get('/', requireLeader, async (req, res) => {
  const leaderUid = await getLeaderUid();
  const inventorySummary = leaderUid ? await getInventorySummary(leaderUid) : [];
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
  });
});

export default router;
