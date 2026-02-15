import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../database.js';
import {
  getLeaderAuthUrl,
  getSubuserAuthUrl,
  handleOAuthCallback,
  initLeaderClient,
  createTempClient,
  storeLeaderUid,
} from '../swc-client.js';
import { syncOwners } from '../services/owner-service.js';
import { setFlash } from '../middleware/flash.js';

const router = Router();

// GET /auth/login?role=leader|subuser
router.get('/login', (req, res) => {
  const role = req.query.role || 'subuser';
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  req.session.oauthRole = role;

  const url = role === 'leader'
    ? getLeaderAuthUrl(state)
    : getSubuserAuthUrl(state);

  res.redirect(url);
});

// OAuth callback handler (exported for dynamic mounting)
export async function callbackHandler(req, res) {
  try {
    const { state } = req.query;
    if (state !== req.session.oauthState) {
      setFlash(req, 'danger', 'Invalid OAuth state. Please try again.');
      return res.redirect('/');
    }

    const result = await handleOAuthCallback(req.query);
    if (!result.success) {
      setFlash(req, 'danger', 'Authentication failed. Please try again.');
      return res.redirect('/');
    }

    const token = result.token;
    const role = req.session.oauthRole || 'subuser';
    delete req.session.oauthState;
    delete req.session.oauthRole;

    // Use temporary client to get character info
    const tempClient = createTempClient(token);
    const character = await tempClient.character.me();
    const swcUid = String(character.uid);
    const swcName = character.name || character.handle || 'Unknown';

    const db = getDb();

    if (role === 'leader') {
      // Initialize the leader client with full token (including refresh token)
      await initLeaderClient(token);
      await storeLeaderUid(swcUid);

      // Upsert the leader user record
      const existing = await db('users').where('swc_uid', swcUid).first();
      if (existing) {
        await db('users').where('id', existing.id).update({ swc_name: swcName, is_leader: 1 });
        req.session.userId = existing.id;
      } else {
        const [id] = await db('users').insert({ swc_uid: swcUid, swc_name: swcName, is_leader: 1 });
        req.session.userId = id;
      }

      // Sync all factions into inventory_owners (primary auto-enabled)
      let factionMsg = '';
      try {
        const me = await tempClient.character.me();
        if (Array.isArray(me?.factions)) {
          const apiFactions = me.factions
            .map(f => ({
              uid: f.attributes?.uid || f.uid || '',
              name: f.value || f.name || 'Unknown',
              type: 'faction',
              primary: !!f.primary,
            }))
            .filter(f => f.uid);

          if (apiFactions.length > 0) {
            // Enable primary faction by default, keep others as-is
            const primaryUids = apiFactions.filter(f => f.primary).map(f => f.uid);
            await syncOwners(apiFactions, primaryUids);
            const primaryName = apiFactions.find(f => f.primary)?.name;
            factionMsg = primaryName ? ` Faction: ${primaryName}.` : '';
          }
        }
      } catch (err) {
        console.error('Failed to sync factions on login:', err.message);
      }
      setFlash(req, 'success', `Welcome, ${swcName}! Leader access granted.${factionMsg}`);
      return res.redirect('/dashboard');
    } else {
      // Sub-user: just verify identity, no token stored
      const existing = await db('users').where('swc_uid', swcUid).first();
      if (existing) {
        await db('users').where('id', existing.id).update({ swc_name: swcName });
        req.session.userId = existing.id;
      } else {
        const [id] = await db('users').insert({ swc_uid: swcUid, swc_name: swcName, is_leader: 0 });
        req.session.userId = id;
      }

      setFlash(req, 'success', `Welcome, ${swcName}!`);
      return res.redirect('/my/dashboard');
    }
  } catch (err) {
    console.error('OAuth callback error:', err);
    setFlash(req, 'danger', 'Authentication error. Please try again.');
    return res.redirect('/');
  }
}

router.get('/callback', callbackHandler);

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

export default router;
