/*
 * GET  /api/lobby?name&token   -> { me, challenges, myGames, storage }
 * POST /api/lobby              -> create / cancel a betting challenge
 *   { action:'create', name, token, stake, side }   side: 'tiger' | 'goat' | 'random'
 *   { action:'cancel', name, token, id }
 *
 * Author: SP · Mobile: 9851052369 · Techno & Z Company
 */
const store = require('../lib/store');
const { readJSON, send, bad, requirePlayer, newId, MAX_STAKE } = require('../lib/util');

async function listChallenges() {
  const keys = await store.keys('challenge:');
  const list = [];
  for (const k of keys) {
    const ch = await store.get(k);
    if (ch && ch.status === 'open') {
      list.push({ id: ch.id, from: ch.from, fromLower: ch.fromLower, stake: ch.stake, side: ch.side, createdAt: ch.createdAt });
    }
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list.slice(0, 50);
}

async function listMyGames(lower) {
  const ids = (await store.get('games:' + lower)) || [];
  const out = [];
  for (const gid of ids.slice(0, 10)) {
    const g = await store.get('game:' + gid);
    if (!g || g.settled || (g.st && g.st.winner)) continue;
    const yourSide = g.tiger.lower === lower ? 'tiger' : 'goat';
    out.push({
      id: g.id,
      stake: g.stake,
      pot: g.pot,
      yourSide,
      opponent: yourSide === 'tiger' ? g.goat.name : g.tiger.name,
      lastMoveAt: g.lastMoveAt
    });
  }
  out.sort((a, b) => b.lastMoveAt - a.lastMoveAt);
  return out;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const me = await requirePlayer({ name: url.searchParams.get('name'), token: url.searchParams.get('token') });
    const payload = {
      ok: true,
      me: me ? { name: me.name, chips: me.chips, wins: me.wins, losses: me.losses } : null,
      challenges: await listChallenges(),
      myGames: me ? await listMyGames(me.name.toLowerCase()) : [],
      storage: store.mode
    };
    return send(res, 200, payload);
  }

  if (req.method !== 'POST') return bad(res, 'Use GET or POST', 405);
  const body = await readJSON(req);
  const player = await requirePlayer(body);
  if (!player) return bad(res, 'Not logged in', 401);
  const lower = player.name.toLowerCase();

  if (body.action === 'create') {
    const stake = Math.floor(Number(body.stake));
    const side = body.side;
    if (!Number.isFinite(stake) || stake < 1) return bad(res, 'Stake must be at least 1 chip');
    if (stake > MAX_STAKE) return bad(res, 'Stake too high (max ' + MAX_STAKE + ')');
    if (side !== 'tiger' && side !== 'goat' && side !== 'random') return bad(res, 'Pick a side: tiger, goat or random');
    if (player.chips < stake) return bad(res, 'Not enough chips — you have ' + player.chips);

    const id = newId();
    await store.set('challenge:' + id, {
      id,
      from: player.name,
      fromLower: lower,
      stake,
      side,
      status: 'open',
      createdAt: Date.now()
    });
    return send(res, 200, { ok: true, id });
  }

  if (body.action === 'cancel') {
    const ch = await store.get('challenge:' + body.id);
    if (!ch || ch.fromLower !== lower) return bad(res, 'Challenge not found', 404);
    if (ch.status !== 'open') return bad(res, 'Challenge is no longer open');
    await store.del('challenge:' + body.id);
    return send(res, 200, { ok: true });
  }

  return bad(res, 'Unknown action');
};
