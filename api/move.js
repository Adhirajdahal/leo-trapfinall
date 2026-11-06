/*
 * POST /api/move  { name, token, id, seq?, move }            — play a move (server-validated)
 *                 { name, token, id, action:'resign' }       — resign (opponent wins the pot)
 *                 { name, token, id, action:'claim' }        — claim win if opponent idle 5+ min
 * -> { ok, game, myChips }
 *
 * Author: SP · Mobile: 9851052369 · Techno & Z Company
 */
const store = require('../lib/store');
const Rules = require('../lib/rules');
const { readJSON, send, bad, requirePlayer, gameView, CLAIM_IDLE_MS } = require('../lib/util');

async function settle(game, winnerSide, reason) {
  const winnerEntry = game[winnerSide];
  const loserSide = winnerSide === 'tiger' ? 'goat' : 'tiger';
  const loserEntry = game[loserSide];

  const wrec = await store.get('player:' + winnerEntry.lower);
  const lrec = await store.get('player:' + loserEntry.lower);
  if (wrec) { wrec.chips += game.pot; wrec.wins = (wrec.wins || 0) + 1; await store.set('player:' + winnerEntry.lower, wrec); }
  if (lrec) { lrec.losses = (lrec.losses || 0) + 1; await store.set('player:' + loserEntry.lower, lrec); }

  game.settled = true;
  game.winnerSide = winnerSide;
  game.winnerName = wrec ? wrec.name : winnerEntry.name;
  game.settleReason = reason;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  const body = await readJSON(req);
  const player = await requirePlayer(body);
  if (!player) return bad(res, 'Not logged in', 401);

  const game = await store.get('game:' + body.id);
  if (!game) return bad(res, 'Game not found', 404);

  const lower = player.name.toLowerCase();
  if (game.tiger.lower !== lower && game.goat.lower !== lower)
    return bad(res, 'You are not a player in this game', 403);

  const yourSide = game.tiger.lower === lower ? 'tiger' : 'goat';
  const oppSide = yourSide === 'tiger' ? 'goat' : 'tiger';

  // Out-of-sync guard: client tells us which seq it last saw.
  if (typeof body.seq === 'number' && body.seq !== game.seq) {
    return send(res, 409, {
      error: 'Board is out of sync — updating…',
      game: gameView(game),
      yourSide,
      myChips: player.chips
    });
  }

  if (!game.settled && !game.st.winner) {
    if (body.action === 'resign') {
      await settle(game, oppSide, player.name + ' resigned');
    } else if (body.action === 'claim') {
      const idle = Date.now() - game.lastMoveAt;
      if (idle <= CLAIM_IDLE_MS)
        return bad(res, 'Opponent was active recently — you can claim after ' + Math.ceil(CLAIM_IDLE_MS / 60000) + ' minutes of idle time');
      await settle(game, yourSide, game[oppSide].name + ' was idle for over 5 minutes');
    } else {
      const result = Rules.applyMove(game.st, yourSide, body.move);
      if (!result.ok) return bad(res, result.error);
      game.log.push(`${player.name} · ${result.log}`);
      if (game.log.length > 200) game.log.shift();
      game.seq++;
      game.lastMoveAt = Date.now();
      if (game.st.winner) await settle(game, game.st.winner, game.st.reason);
    }
    await store.set('game:' + body.id, game);
  }

  return send(res, 200, {
    ok: true,
    yourSide,
    myChips: player.chips,
    canClaim: !game.settled && !game.st.winner && (Date.now() - game.lastMoveAt > CLAIM_IDLE_MS),
    game: gameView(game)
  });
};
