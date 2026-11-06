/*
 * GET /api/game?id&name&token
 * -> { ok, game: {...}, yourSide, myChips, canClaim }
 *
 * Author: SP · Mobile: 9851052369 · Techno & Z Company
 */
const store = require('../lib/store');
const { send, bad, requirePlayer, gameView, CLAIM_IDLE_MS } = require('../lib/util');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return bad(res, 'Use GET', 405);
  const url = new URL(req.url, 'http://x');
  const player = await requirePlayer({ name: url.searchParams.get('name'), token: url.searchParams.get('token') });
  if (!player) return bad(res, 'Not logged in', 401);

  const game = await store.get('game:' + url.searchParams.get('id'));
  if (!game) return bad(res, 'Game not found', 404);

  const lower = player.name.toLowerCase();
  if (game.tiger.lower !== lower && game.goat.lower !== lower)
    return bad(res, 'You are not a player in this game', 403);

  const yourSide = game.tiger.lower === lower ? 'tiger' : 'goat';
  const canClaim = !game.settled && !game.st.winner && (Date.now() - game.lastMoveAt > CLAIM_IDLE_MS);

  return send(res, 200, {
    ok: true,
    yourSide,
    myChips: player.chips,
    canClaim,
    claimIdleMs: CLAIM_IDLE_MS,
    game: gameView(game)
  });
};
