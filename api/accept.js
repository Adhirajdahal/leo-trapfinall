/*
 * POST /api/accept  { name, token, id }
 * Accept a betting challenge: escrow both stakes, create the game, link the challenge.
 * -> { ok, gameId }
 *
 * Author: SP · Mobile: 9851052369 · Techno & Z Company
 */
const store = require('../lib/store');
const Rules = require('../lib/rules');
const { readJSON, send, bad, requirePlayer } = require('../lib/util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  const body = await readJSON(req);
  const acceptor = await requirePlayer(body);
  if (!acceptor) return bad(res, 'Not logged in', 401);
  const acceptorLower = acceptor.name.toLowerCase();

  const ch = await store.get('challenge:' + body.id);
  if (!ch) return bad(res, 'Challenge not found', 404);
  if (ch.status !== 'open') return bad(res, 'Challenge is no longer available');
  if (ch.fromLower === acceptorLower) return bad(res, "You can't accept your own challenge");
  if (acceptor.chips < ch.stake) return bad(res, 'Not enough chips — you need ' + ch.stake + ' but have ' + acceptor.chips);

  // Lock so two players can't accept the same challenge at the same moment.
  const locked = await store.putNX('lock:challenge:' + ch.id, acceptorLower, 60);
  if (!locked) return bad(res, 'Someone just accepted this challenge');

  const creator = await store.get('player:' + ch.fromLower);
  if (!creator) {
    await store.del('lock:challenge:' + ch.id);
    await store.del('challenge:' + ch.id);
    return bad(res, 'The challenger no longer exists', 404);
  }
  if (creator.chips < ch.stake) {
    await store.del('lock:challenge:' + ch.id);
    return bad(res, 'The challenger no longer has enough chips for this bet');
  }

  // Escrow both stakes.
  creator.chips -= ch.stake;
  acceptor.chips -= ch.stake;

  // Resolve sides.
  let creatorSide = ch.side;
  if (ch.side === 'random') creatorSide = Math.random() < 0.5 ? 'tiger' : 'goat';

  const creatorEntry = { name: creator.name, lower: ch.fromLower };
  const acceptorEntry = { name: acceptor.name, lower: acceptorLower };

  const gid = (require('../lib/util').newId)();
  const game = {
    id: gid,
    stake: ch.stake,
    pot: ch.stake * 2,
    tiger: creatorSide === 'tiger' ? creatorEntry : acceptorEntry,
    goat: creatorSide === 'tiger' ? acceptorEntry : creatorEntry,
    st: Rules.initial(),
    log: [],
    seq: 0,
    settled: false,
    winnerName: null,
    winnerSide: null,
    settleReason: null,
    lastMoveAt: Date.now(),
    createdAt: Date.now(),
    challengeId: ch.id
  };

  await store.set('game:' + gid, game);
  await store.set('player:' + ch.fromLower, creator);
  await store.set('player:' + acceptorLower, acceptor);

  ch.status = 'accepted';
  ch.gameId = gid;
  await store.set('challenge:' + ch.id, ch);

  // Per-player active-game index (for "resume" in the lobby).
  for (const lower of [ch.fromLower, acceptorLower]) {
    const list = (await store.get('games:' + lower)) || [];
    list.unshift(gid);
    await store.set('games:' + lower, list.slice(0, 10));
  }

  await store.del('lock:challenge:' + ch.id);
  return send(res, 200, { ok: true, gameId: gid });
};
