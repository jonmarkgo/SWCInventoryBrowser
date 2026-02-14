import { Router } from 'express';
import { requireAuth, requireLeader } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { getLeaderClient } from '../swc-client.js';
import { addItemToGroup } from '../services/group-service.js';
import { logAction } from '../services/audit-service.js';

const router = Router();

// POST /api/group-item - add item to group (used from entity detail page)
router.post('/group-item', requireLeader, async (req, res) => {
  const { group_id, entity_type, entity_uid, entity_name, entity_image, redirect } = req.body;
  if (!group_id || !entity_type || !entity_uid) {
    setFlash(req, 'warning', 'Missing required fields.');
    return res.redirect(redirect || '/inventory');
  }

  const added = await addItemToGroup(parseInt(group_id), entity_type, entity_uid, entity_name || '', entity_image || '');
  if (added) {
    await logAction(req.session.userId, 'add_to_group', entity_type, entity_uid, `Added to group ${group_id}`);
    setFlash(req, 'success', 'Item added to group.');
  } else {
    setFlash(req, 'info', 'Item already in this group.');
  }

  res.redirect(redirect || '/inventory');
});

// POST /api/inventory/:type/:uid/tag - add tag via API
router.post('/inventory/:type/:uid/tag', requireAuth, async (req, res) => {
  const client = getLeaderClient();
  if (!client) return res.status(503).json({ error: 'Leader API unavailable' });

  const { type: entityType, uid } = req.params;
  const { tag } = req.body;
  if (!tag?.trim()) return res.status(400).json({ error: 'Tag is required' });

  try {
    await client.inventory.entities.addTag({ entityType, uid, tag: tag.trim() });
    await logAction(req.session.userId, 'add_tag', entityType, uid, `Added tag "${tag.trim()}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/inventory/:type/:uid/tag - remove tag via API
router.delete('/inventory/:type/:uid/tag', requireAuth, async (req, res) => {
  const client = getLeaderClient();
  if (!client) return res.status(503).json({ error: 'Leader API unavailable' });

  const { type: entityType, uid } = req.params;
  const { tag } = req.body;
  if (!tag?.trim()) return res.status(400).json({ error: 'Tag is required' });

  try {
    await client.inventory.entities.removeTag({ entityType, uid, tag: tag.trim() });
    await logAction(req.session.userId, 'remove_tag', entityType, uid, `Removed tag "${tag.trim()}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
