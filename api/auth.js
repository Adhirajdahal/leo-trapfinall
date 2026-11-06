/*
 * POST /api/auth  { action: 'register' | 'login', name, pin }
 * -> { ok, name, token, chips, wins, losses }
 *
 * Author: SP · Mobile: 9851052369 · Techno & Z Company
 */
const store = require('../lib/store');
const { readJSON, send, bad, validName, validPin, hashPin, newToken, START_CHIPS } = require('../lib/util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  const body = await readJSON(req);
  const action = body.action;
  const name = (body.name || '').toString().trim();
  const pin = (body.pin || '').toString().trim();

  if (!validName(name)) return bad(res, 'Name must be 2–16 characters (letters, digits, space or _)');
  if (!validPin(pin)) return bad(res, 'PIN must be 4–6 digits');

  const key = 'player:' + name.toLowerCase();

  if (action === 'register') {
    if (await store.get(key)) return bad(res, 'That name is already taken — please log in instead');
    const rec = {
      name,
      token: newToken(),
      pinHash: hashPin(pin),
      chips: START_CHIPS,
      wins: 0,
      losses: 0,
      createdAt: Date.now()
    };
    await store.set(key, rec);
    return send(res, 200, { ok: true, name: rec.name, token: rec.token, chips: rec.chips, wins: rec.wins, losses: rec.losses });
  }

  if (action === 'login') {
    const rec = await store.get(key);
    if (!rec) return bad(res, 'No player named "' + name + '" — create a wallet first', 404);
    if (rec.pinHash !== hashPin(pin)) return bad(res, 'Wrong PIN for "' + name + '"', 401);
    return send(res, 200, { ok: true, name: rec.name, token: rec.token, chips: rec.chips, wins: rec.wins, losses: rec.losses });
  }

  return bad(res, 'Unknown action');
};
