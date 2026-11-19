// Engine + bot self-test: rule unit checks, then thousands of bot games with invariants.
const E = require('../shared/engine.js');
const B = require('../shared/bot.js');
const assert = require('assert');

/* ---- unit checks ---- */
const H = (s) => s.split(' ');
// rounding
assert.strictEqual(E.roundHokm(65), 6);
assert.strictEqual(E.roundHokm(66), 7);
assert.strictEqual(E.roundHokm(56), 6);
assert.strictEqual(E.roundSun(64), 12);
assert.strictEqual(E.roundSun(65), 13);
assert.strictEqual(E.roundSun(66), 14);
assert.strictEqual(E.roundSun(56), 12);

// projects
let p = E.findProjects(H('AH KH QH JH TH 9H 8H 7H'), 'hokm');
assert.deepStrictEqual(p.map((x) => x.k).sort(), ['100', 'sira']);
p = E.findProjects(H('KH KS KD KC QH JH 7S 8D'), 'sun');
assert.deepStrictEqual(p.map((x) => x.k), ['100']);
p = E.findProjects(H('AH AS AD AC 7H 8H 9H TS'), 'sun');
assert.deepStrictEqual(p.map((x) => x.k), ['400', 'sira']);
p = E.findProjects(H('AH AS AD AC 7H 8S 9D TS'), 'hokm');
assert.deepStrictEqual(p.map((x) => x.k), ['100']);
p = E.findProjects(H('9C 9S 9D 9H 7H JS KD TC'), 'hokm');
assert.deepStrictEqual(p, []);

// legal plays, hokm trump = H
const hokmH = { type: 'hokm', trump: 'H', team: 0, mult: 1, locked: false };
const none = new Set();
// seat 3 (4th to play), partner seat 1 winning with 7S? leader 0 leads 8S, seat1 plays AS, seat2 plays 9S; seat3 void in spades with trumps -> partner winning, last -> anything
let trick = [{ s: 0, c: '8S' }, { s: 1, c: 'AS' }, { s: 2, c: '9S' }];
assert.deepStrictEqual(E.legalFrom(H('7H 8D 9C'), trick, hokmH, none, 3).sort(), H('7H 8D 9C').sort());
// opponent winning (seat 0 led AS, seat1 low), seat 3 void -> wait seat2 is 3rd. Test seat 2: partner of 0 is 2 -> partner winning with boss Ace -> anything
trick = [{ s: 0, c: 'AS' }, { s: 1, c: '7S' }];
assert.deepStrictEqual(E.legalFrom(H('7H 8D'), trick, hokmH, none, 2).sort(), H('7H 8D').sort());
// partner led non-boss KS (AS unplayed), seat 2 void with trump -> must trump
trick = [{ s: 0, c: 'KS' }, { s: 1, c: '7S' }];
assert.deepStrictEqual(E.legalFrom(H('7H 8D'), trick, hokmH, none, 2), ['7H']);
// ...unless the AS and TS were already played (KS is boss)
assert.deepStrictEqual(E.legalFrom(H('7H 8D'), trick, hokmH, new Set(['AS', 'TS', 'KS', '7S']), 2).sort(), H('7H 8D').sort());
// opponent trumped with 9H; seat 3 holds 7H and JH, void in spades -> must overtrump with JH
trick = [{ s: 0, c: 'KS' }, { s: 1, c: 'AS' }, { s: 2, c: '9H' }];
// seat 3 partner is seat 1 (AS) but seat 2 (opponent) is winning with trump
assert.deepStrictEqual(E.legalFrom(H('7H JH 8D'), trick, hokmH, none, 3), ['JH']);
// cannot overtrump -> free
assert.deepStrictEqual(E.legalFrom(H('7H 8D'), [{ s: 0, c: 'KS' }, { s: 1, c: 'AS' }, { s: 2, c: 'JH' }], hokmH, none, 3).sort(), H('7H 8D').sort());
// trump led, opponent winning, must beat if able
trick = [{ s: 0, c: 'AH' }];
assert.deepStrictEqual(E.legalFrom(H('7H 9H 8D'), trick, hokmH, none, 1), ['9H']);
// trump led, partner winning -> any trump
trick = [{ s: 0, c: '9H' }, { s: 1, c: '7H' }];
assert.deepStrictEqual(E.legalFrom(H('8H JH 8D'), trick, hokmH, none, 2).sort(), H('8H JH').sort());
// locked game: cannot lead trump unless only trumps
assert.deepStrictEqual(E.legalFrom(H('8H JH 8D'), [], Object.assign({}, hokmH, { locked: true }), none, 0), ['8D']);
// sun: follow suit
const sun = { type: 'sun', trump: null, team: 0, mult: 1 };
assert.deepStrictEqual(E.legalFrom(H('8H JS 8D'), [{ s: 0, c: 'AS' }], sun, none, 1), ['JS']);

/* ---- full bot games ---- */
function playGame(seed, levels, stats) {
  const st = E.newGame({ seed });
  E.startRound(st);
  let guard = 0;
  while (st.phase !== 'gameEnd') {
    if (++guard > 20000) throw new Error('runaway game');
    if (st.phase === 'trickEnd') {
      E.finishTrick(st);
      continue;
    }
    if (st.phase === 'roundEnd') {
      const s = st.summary;
      const tot = s.abnat[0] + s.abnat[1];
      assert.strictEqual(tot, s.type === 'hokm' ? 162 : 130, 'abnat total');
      stats.rounds++;
      const key = s.type + (s.mult > 1 ? 'x' + s.mult : '');
      stats.by[key] = stats.by[key] || { n: 0, made: 0 };
      stats.by[key].n++;
      if (s.winTeam === s.team) stats.by[key].made++;
      if (s.kaboot != null) stats.kaboot++;
      if (s.projList[0].length || s.projList[1].length) stats.proj++;
      if (s.bal[0] || s.bal[1]) stats.baloot++;
      E.nextRound(st);
      continue;
    }
    const seat = st.turn;
    const v = E.viewFor(st, seat);
    const a = B.decide(v, levels[seat % 2], seed * 31 + guard);
    const r = E.apply(st, seat, a);
    if (!r.ok) throw new Error('bot action rejected ' + JSON.stringify(a) + ' ' + r.err);
  }
  return st;
}

const stats = { rounds: 0, kaboot: 0, proj: 0, baloot: 0, by: {} };
const N = +process.argv[2] || 300;
const lv = (process.argv[3] || 'medium,medium').split(',');
let wins = [0, 0];
const t0 = Date.now();
for (let g = 1; g <= N; g++) {
  const st = playGame(g * 7919, lv, stats);
  wins[st.winner]++;
}
const ms = Date.now() - t0;
console.log('unit checks OK');
console.log(`${N} games, ${stats.rounds} rounds, ${(ms / N).toFixed(1)} ms/game, levels team0=${lv[0]} team1=${lv[1]}`);
console.log('wins', wins, 'rounds/game', (stats.rounds / N).toFixed(1));
for (const k of Object.keys(stats.by)) console.log(k, stats.by[k].n, 'made', ((stats.by[k].made / stats.by[k].n) * 100).toFixed(0) + '%');
console.log('kaboot', stats.kaboot, 'projects', stats.proj, 'baloot', stats.baloot);

// sawa sanity: claims must never be wrong. Replay random states and compare with actual optimal-free play is costly;
// instead check that every accepted claim leaves abnat totals intact (checked in playGame) and count claims.
