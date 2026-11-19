/*
 * Baloot bots. A bot only sees what its seat may see (the same view a human gets),
 * so bots never cheat. Levels: 'easy', 'medium', 'hard' (hard = Monte Carlo search
 * over possible hidden hands, using the heuristic policy for playouts).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BalootBot = factory(root.BalootEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const { SUITS, rank, suit, partner, teamOf, beats, winningIndex, cardPoints, strength, isBoss, trumpOf, legalFrom, findProjects, projectPoints, roundHokm, roundSun } = E;

  /* ---------------- hand evaluation for bidding ---------------- */
  function hokmScore(cards, tr) {
    const t = cards.filter((c) => suit(c) === tr);
    const n = t.length;
    const has = (r) => t.some((c) => rank(c) === r);
    let s = 0;
    if (has('J')) s += 4;
    if (has('9')) s += has('J') ? 3 : 2;
    if (has('A')) s += 1.5;
    if (has('T')) s += 1;
    if (has('K')) s += 0.5;
    if (has('Q')) s += 0.5;
    s += t.filter((c) => rank(c) === '7' || rank(c) === '8').length * 0.5;
    s += Math.max(0, n - 2) * 1.2;
    if (n <= 1) s -= 3;
    for (const su of SUITS) {
      if (su === tr) continue;
      const sc = cards.filter((c) => suit(c) === su);
      const hs = (r) => sc.some((c) => rank(c) === r);
      if (hs('A')) s += 1.6;
      if (hs('A') && hs('T')) s += 0.8;
      if (sc.length === 0 && n >= 2) s += 0.6;
    }
    return s;
  }
  function sunScore(cards) {
    let s = 0;
    for (const su of SUITS) {
      const sc = cards.filter((c) => suit(c) === su);
      const has = (r) => sc.some((c) => rank(c) === r);
      if (has('A')) {
        s += 3;
        if (has('T')) s += 2;
        if (has('K')) s += 0.5;
        s += Math.max(0, sc.length - 2) * 0.6;
      } else if (has('T')) {
        s += has('K') ? 1 : 0.2;
      } else if (has('K')) {
        s += 0.3;
      }
    }
    return s;
  }

  const TH = {
    easy: { hokm: 9, sun: 9, jitter: 2.5 },
    medium: { hokm: 7.8, sun: 7.8, jitter: 0.8 },
    hard: { hokm: 7.6, sun: 7.6, jitter: 0.3 },
  };

  function bidDecision(v, level, rnd) {
    const L = v.legal;
    const th = TH[level] || TH.medium;
    const opts = L.options;
    const b = v.bidding;
    const me = v.me;
    const hand = v.hand;
    const exp = v.exposed;
    const withExp = hand.concat([exp]);
    const j = () => (rnd() - 0.5) * th.jitter;
    const partnerHokm = b.hokmBy != null && b.hokmBy === partner(me);
    const sunS = sunScore(withExp) + j();
    const sunOwn = sunScore(hand) + j();

    if (opts.indexOf('confirm') >= 0) {
      return sunScore(hand) >= th.sun + 1.5 && hokmScore(hand, b.hokmSuit) < th.hokm + 1 ? { a: 'sun' } : { a: 'confirm' };
    }
    const sunNeed = partnerHokm ? th.sun + 2.5 : b.hokmBy != null ? th.sun + 0.6 : th.sun;
    if (opts.indexOf('sun') >= 0 && sunS >= sunNeed) {
      if (opts.indexOf('ashkal') >= 0 && sunOwn >= sunNeed - 0.5 && sunScore(withExp) - sunScore(hand) < 1 && 'TA'.indexOf(rank(exp)) < 0) return { a: 'ashkal' };
      return { a: 'sun' };
    }
    if (opts.indexOf('hokm') >= 0) {
      if (hokmScore(withExp, suit(exp)) + j() >= th.hokm) return { a: 'hokm' };
    }
    if (opts.indexOf('hokm2') >= 0) {
      let best = null;
      let bs = -99;
      for (const su of L.suits) {
        const sc = hokmScore(withExp, su);
        if (sc > bs) {
          bs = sc;
          best = su;
        }
      }
      if (bs + j() >= th.hokm + 0.4) return { a: 'hokm2', suit: best };
    }
    return { a: 'pass' };
  }

  function doubleDecision(v, level) {
    const opts = v.legal.options;
    const c = v.contract;
    const hand = v.hand;
    if (c.type === 'sun') {
      return opts.indexOf('double') >= 0 && sunScore(hand) >= 15 ? 'double' : 'pass';
    }
    const t = hand.filter((x) => suit(x) === c.trump);
    const has = (r) => t.some((x) => rank(x) === r);
    const hs = hokmScore(hand, c.trump);
    if (opts.indexOf('double') >= 0) {
      if (level !== 'easy' && has('J') && has('9') && t.length >= 3 && hs >= 12) return 'double';
      return 'pass';
    }
    if (opts.indexOf('triple') >= 0) return has('J') && has('9') && has('A') && t.length >= 5 ? 'triple' : 'pass';
    if (opts.indexOf('four') >= 0) return has('J') && has('9') && t.length >= 5 && hs >= 16 ? 'four' : 'pass';
    if (opts.indexOf('gahwa') >= 0) return has('J') && has('9') && has('A') && has('T') && t.length >= 6 ? 'gahwa' : 'pass';
    return 'pass';
  }

  /* ---------------- knowledge from the public record ---------------- */
  function buildInfo(v) {
    const c = v.contract;
    const trump = trumpOf(c);
    const voids = [new Set(), new Set(), new Set(), new Set()];
    const running = new Set();
    const all = v.tricks.slice();
    if (v.trick && v.trick.cards.length) all.push(v.trick);
    for (const t of all) {
      const cards = t.cards;
      for (let i = 0; i < cards.length; i++) {
        const x = cards[i];
        if (i > 0) {
          const led = suit(cards[0].c);
          if (suit(x.c) !== led) {
            voids[x.s].add(led);
            if (trump && led !== trump && suit(x.c) !== trump) {
              const prev = cards.slice(0, i);
              const wi = winningIndex(prev, c);
              const ws = prev[wi].s;
              const wc = prev[wi].c;
              let obliged;
              if (ws === partner(x.s)) obliged = !(i === 3 || isBoss(prev[0].c, running, c));
              else obliged = suit(wc) !== trump;
              if (obliged) voids[x.s].add(trump);
            }
          }
        }
        running.add(x.c);
      }
    }
    const played = running;
    const known = []; // [card, seat]
    const knownSet = new Set();
    const me = v.me;
    if (c && v.exposed && c.taker !== me && !played.has(v.exposed)) {
      known.push([v.exposed, c.taker]);
      knownSet.add(v.exposed);
    }
    if (v.projects && v.projects.shown) {
      for (const p of v.projects.shown) {
        if (p.s === me) continue;
        for (const card of p.cards) {
          if (!played.has(card) && !knownSet.has(card)) {
            known.push([card, p.s]);
            knownSet.add(card);
          }
        }
      }
    }
    const mine = new Set(v.hand);
    const unknown = E.fullDeck().filter((x) => !played.has(x) && !mine.has(x) && !knownSet.has(x));
    return { played, voids, known, unknown };
  }

  /* ---------------- heuristic card play ---------------- */
  // seen = played cards plus my own hand (cards nobody else can hold)
  function bossAmongUnseen(c, seen, contract) {
    return isBoss(c, seen, contract);
  }

  function trumpsOutside(hand, played, trump) {
    let n = 0;
    for (const r of E.RANKS) {
      const x = r + trump;
      if (!played.has(x) && hand.indexOf(x) < 0) n++;
    }
    return n;
  }

  // ctx: { seat, hand, legal, trick (cards array), contract, played (Set), voids (array of Set, may be null), declTeam }
  function heuristicPlay(ctx) {
    const { seat, hand, legal, trick, contract, played } = ctx;
    if (legal.length === 1) return legal[0];
    const trump = trumpOf(contract);
    const pts = (c) => cardPoints(c, contract);
    const str = (c) => strength(c, contract);
    const seen = new Set(played);
    for (const x of hand) seen.add(x);
    const isTrump = (c) => trump && suit(c) === trump;
    const pos = trick.length;
    const myTeam = teamOf(seat);
    const voids = ctx.voids;

    if (pos === 0) return leadCard(ctx, seen);

    const led = suit(trick[0].c);
    const wi = winningIndex(trick, contract);
    const winSeat = trick[wi].s;
    const winCard = trick[wi].c;
    const partnerWin = winSeat === partner(seat);
    const last = pos === 3;
    let trickPts = 0;
    for (const x of trick) trickPts += pts(x.c);
    const winners = legal.filter((c) => beats(c, winCard, led, trump));

    const holds = (c) => {
      // would c still win after the remaining players?
      if (last) return true;
      const remaining = [];
      for (let k = pos + 1; k < 4; k++) remaining.push((trick[0].s + k) % 4);
      const oppsLeft = remaining.filter((s) => teamOf(s) !== myTeam);
      if (!oppsLeft.length) return true;
      if (isTrump(c)) return bossAmongUnseen(c, seen, contract);
      if (!bossAmongUnseen(c, seen, contract)) return false;
      if (!trump) return true;
      if (trumpsOutside(hand, played, trump) === 0) return true;
      if (voids) {
        for (const s of oppsLeft) if (voids[s].has(suit(c)) && !voids[s].has(trump)) return false;
        return true;
      }
      return ctx.trickNo < 3;
    };

    if (partnerWin) {
      const safe = holds(winCard);
      if (safe) {
        // feed points to partner, keep bosses and trumps where possible
        let best = null;
        let bv = -1e9;
        for (const c of legal) {
          let val = pts(c) * 1.0;
          if (bossAmongUnseen(c, seen, contract) && !isTrump(c)) val -= 9;
          if (isTrump(c)) val -= 6 + str(c);
          val -= str(c) * 0.05;
          if (val > bv) {
            bv = val;
            best = c;
          }
        }
        return best;
      }
      const sureW = winners.filter(holds);
      if (sureW.length && trickPts >= 10) return cheapest(sureW, pts, str, true);
      return discard(legal, ctx, seen);
    }

    if (winners.length) {
      if (last) {
        // win as profitably as possible, saving bosses and high trumps
        let best = null;
        let bv = -1e9;
        for (const c of winners) {
          let val = pts(c);
          if (isTrump(c)) val -= 2 + str(c) * 1.5;
          else if (bossAmongUnseen(c, seen, contract) && pts(c) >= 10) val -= 4;
          if (val > bv) {
            bv = val;
            best = c;
          }
        }
        if (isTrump(best) && suit(winCard) !== trump && trickPts < 4 && legal.some((c) => !isTrump(c)) && ctx.trickNo < 7) {
          // not worth spending a trump on an empty trick if we are not forced
          const nonT = legal.filter((c) => !isTrump(c));
          if (nonT.length) return discard(nonT, ctx, seen);
        }
        return best;
      }
      const sure = winners.filter(holds);
      if (sure.length) {
        // take with a sure winner; prefer one that also scores
        let best = null;
        let bv = -1e9;
        for (const c of sure) {
          let val = pts(c) - (isTrump(c) ? str(c) * 1.5 + 3 : 0);
          if (val > bv) {
            bv = val;
            best = c;
          }
        }
        return best;
      }
      const ruffs = winners.filter(isTrump);
      if (ruffs.length && suit(winCard) !== trump && (trickPts >= 3 || ctx.trickNo >= 5)) return cheapest(ruffs, pts, str, false);
      return discard(legal, ctx, seen);
    }
    return discard(legal, ctx, seen);
  }

  function cheapest(cards, pts, str, preferPoints) {
    let best = null;
    let bv = 1e9;
    for (const c of cards) {
      const val = str(c) * 2 - (preferPoints ? pts(c) * 0.2 : 0);
      if (val < bv) {
        bv = val;
        best = c;
      }
    }
    return best;
  }

  function discard(cards, ctx, seen) {
    const { hand, contract } = ctx;
    const trump = trumpOf(contract);
    let best = null;
    let bv = 1e9;
    for (const c of cards) {
      const s = suit(c);
      const len = hand.filter((x) => suit(x) === s).length;
      let val = cardPoints(c, contract) * 3 + strength(c, contract);
      if (trump && s === trump) val += 25;
      if (isBoss(c, seen, contract)) val += 12;
      // shortening a suit (towards a void) is useful in hokm
      if (trump && s !== trump) val -= Math.max(0, 3 - len) * 1.5;
      // unguarded ten is a liability: get rid of it only when cheap to do so
      if (rank(c) === 'T' && !seen.has('A' + s) && hand.indexOf('A' + s) < 0) val -= 2;
      if (val < bv) {
        bv = val;
        best = c;
      }
    }
    return best;
  }

  function leadCard(ctx, seen) {
    const { seat, hand, legal, contract, played, voids } = ctx;
    const trump = trumpOf(contract);
    const myTeam = teamOf(seat);
    const declarer = contract.team === myTeam;
    const pts = (c) => cardPoints(c, contract);
    const opps = [(seat + 1) % 4, (seat + 3) % 4];
    const part = partner(seat);

    if (trump) {
      const myTrumps = legal.filter((c) => suit(c) === trump);
      const out = trumpsOutside(hand, played, trump);
      if (myTrumps.length && out > 0) {
        const bossT = myTrumps.filter((c) => isBoss(c, seen, contract));
        const oppsMayHave = !voids || opps.some((s) => !voids[s].has(trump));
        if (declarer && bossT.length && oppsMayHave) return bossT.sort((a, b) => strength(b, contract) - strength(a, contract))[0];
        if (declarer && myTrumps.length >= 3 && oppsMayHave && out >= 3) {
          return myTrumps.sort((a, b) => strength(a, contract) - strength(b, contract))[0];
        }
      }
    }
    // cash side-suit bosses that the opponents cannot ruff
    const bosses = legal.filter((c) => (!trump || suit(c) !== trump) && isBoss(c, seen, contract));
    const safeBoss = bosses.filter((c) => {
      if (!trump) return true;
      if (trumpsOutside(hand, played, trump) === 0) return true;
      if (voids) return !opps.some((s) => voids[s].has(suit(c)) && !voids[s].has(trump));
      return true;
    });
    if (safeBoss.length) {
      safeBoss.sort((a, b) => pts(b) - pts(a));
      return safeBoss[0];
    }
    // let partner ruff a suit he is void in
    if (trump && voids && !voids[part].has(trump)) {
      const ruffable = legal.filter((c) => suit(c) !== trump && voids[part].has(suit(c)) && !opps.some((s) => voids[s].has(suit(c)) && !voids[s].has(trump)));
      if (ruffable.length) return ruffable.sort((a, b) => pts(a) - pts(b))[0];
    }
    // otherwise lead low from a long side suit, avoiding exposed tens
    let best = null;
    let bv = 1e9;
    for (const c of legal) {
      const s = suit(c);
      const len = hand.filter((x) => suit(x) === s).length;
      let val = pts(c) * 2 + strength(c, contract) * 0.5 - len * 0.8;
      if (trump && s === trump && !declarer) val += 14;
      if (trump && s === trump && declarer) val += 4;
      const hasT = hand.indexOf('T' + s) >= 0;
      const aceGone = seen.has('A' + s) && hand.indexOf('A' + s) < 0;
      if (hasT && !aceGone && hand.indexOf('A' + s) < 0 && len <= 2) val += 6;
      if (voids && opps.some((o) => voids[o].has(s) && (!trump || !voids[o].has(trump))) && s !== trump) val += 8;
      if (val < bv) {
        bv = val;
        best = c;
      }
    }
    return best;
  }

  /* ---------------- Monte Carlo (hard) ---------------- */
  function sampleHands(v, info, rnd) {
    const me = v.me;
    const base = [[], [], [], []];
    base[me] = v.hand.slice();
    const need0 = v.counts.slice();
    need0[me] = 0;
    for (const [card, s] of info.known) {
      if (need0[s] > 0) {
        base[s].push(card);
        need0[s]--;
      }
    }
    const pool = info.unknown;
    for (let attempt = 0; attempt < 25; attempt++) {
      const hands = base.map((h) => h.slice());
      const need = need0.slice();
      const p = pool.slice();
      for (let i = p.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = p[i];
        p[i] = p[j];
        p[j] = t;
      }
      // most constrained cards first
      const elig = (card) => [0, 1, 2, 3].filter((s) => s !== me && need[s] > 0 && !info.voids[s].has(suit(card)));
      p.sort((a, b) => elig(a).length - elig(b).length);
      let okAll = true;
      for (const card of p) {
        const e = [0, 1, 2, 3].filter((s) => s !== me && need[s] > 0 && (attempt > 20 || !info.voids[s].has(suit(card))));
        if (!e.length) {
          okAll = false;
          break;
        }
        const s = e[Math.floor(rnd() * e.length)];
        hands[s].push(card);
        need[s]--;
      }
      if (okAll) return hands;
    }
    // last resort: ignore constraints
    const hands = base.map((h) => h.slice());
    const need = need0.slice();
    const p = pool.slice();
    for (const card of p) {
      const e = [0, 1, 2, 3].filter((s) => s !== me && need[s] > 0);
      const s = e[Math.floor(rnd() * e.length)];
      hands[s].push(card);
      need[s]--;
    }
    return hands;
  }

  function evalOutcome(abnat, tricksWon, contract, projPts, bal, myTeam) {
    const hokm = contract.type === 'hokm';
    const T = contract.team;
    const O = 1 - T;
    const pts = [0, 0];
    if (tricksWon[O] === 0 || tricksWon[T] === 0) {
      const K = tricksWon[O] === 0 ? T : O;
      pts[K] = (hokm ? 25 : 44) * contract.mult + projPts[K] + bal[K];
    } else {
      const total = hokm ? 16 : 26;
      const oP = hokm ? roundHokm(abnat[O]) : roundSun(abnat[O]);
      const tP = total - oP;
      const tTot = tP + projPts[T] + bal[T];
      const oTot = oP + projPts[O] + bal[O];
      const made = tTot > oTot || (tTot === oTot && abnat[T] >= abnat[O]);
      if (contract.mult === 1) {
        if (made) {
          pts[T] = tTot;
          pts[O] = oTot;
        } else {
          pts[O] = total + projPts[T] + projPts[O] + bal[O];
          pts[T] = bal[T];
        }
      } else {
        const W = made ? T : O;
        pts[W] = total * contract.mult + (projPts[T] + projPts[O]) * 2;
      }
    }
    // small tie-break towards raw card points so the search still prefers better play
    return pts[myTeam] - pts[1 - myTeam] + (abnat[myTeam] - abnat[1 - myTeam]) * 0.02;
  }

  function rollout(v, hands, firstCard, info) {
    const contract = v.contract;
    const me = v.me;
    const played = new Set(info.played);
    const h = hands.map((x) => x.slice());
    let trick = v.trick.cards.map((x) => ({ s: x.s, c: x.c }));
    let leader = v.trick.leader;
    const abnat = [0, 0];
    const tricksWon = [0, 0];
    for (const t of v.tricks) {
      abnat[teamOf(t.winner)] += t.pts;
      tricksWon[teamOf(t.winner)]++;
    }
    let trickNo = v.tricks.length;
    let seat = (leader + trick.length) % 4;
    let first = true;
    while (trickNo < 8) {
      let card;
      if (first) {
        card = firstCard;
        first = false;
      } else {
        const legal = legalFrom(h[seat], trick, contract, played, seat);
        card = heuristicPlay({ seat, hand: h[seat], legal, trick, contract, played, voids: null, trickNo });
      }
      h[seat].splice(h[seat].indexOf(card), 1);
      trick.push({ s: seat, c: card });
      played.add(card);
      if (trick.length === 4) {
        const w = trick[winningIndex(trick, contract)].s;
        let p = 0;
        for (const x of trick) p += cardPoints(x.c, contract);
        if (trickNo === 7) p += 10;
        abnat[teamOf(w)] += p;
        tricksWon[teamOf(w)]++;
        trickNo++;
        trick = [];
        leader = w;
        seat = w;
      } else {
        seat = (seat + 1) % 4;
      }
    }
    // projects: if still in the first trick nobody knows the winner yet; use what is public
    const projPts = [0, 0];
    if (v.projects && v.projects.team != null) {
      for (const p of v.projects.shown) projPts[v.projects.team] += projectPoints(p.k, contract.type);
    }
    const bal = [0, 0];
    if (v.baloot) bal[teamOf(v.baloot.s)] = 2;
    return evalOutcome(abnat, tricksWon, contract, projPts, bal, teamOf(me));
  }

  function mcPlay(v, info, rnd, samples) {
    const legal = v.legal.cards;
    if (legal.length === 1) return legal[0];
    const scores = new Array(legal.length).fill(0);
    for (let k = 0; k < samples; k++) {
      const hands = sampleHands(v, info, rnd);
      for (let i = 0; i < legal.length; i++) scores[i] += rollout(v, hands, legal[i], info);
    }
    let bi = 0;
    for (let i = 1; i < legal.length; i++) if (scores[i] > scores[bi]) bi = i;
    return legal[bi];
  }

  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function playDecision(v, level, rnd) {
    const legal = v.legal.cards;
    if (legal.length === 1) return legal[0];
    const info = buildInfo(v);
    if (level === 'hard') return mcPlay(v, info, rnd, legal.length > 5 ? 28 : 40);
    const ctx = { seat: v.me, hand: v.hand, legal, trick: v.trick.cards, contract: v.contract, played: info.played, voids: level === 'easy' ? null : info.voids, trickNo: v.tricks.length };
    if (level === 'easy' && rnd() < 0.3) return legal[Math.floor(rnd() * legal.length)];
    return heuristicPlay(ctx);
  }

  function decide(v, level, seed) {
    const rnd = makeRng(seed != null ? seed : (Math.random() * 4294967296) >>> 0);
    const L = v.legal;
    if (!L) return null;
    level = level || 'medium';
    if (L.kind === 'bid') return Object.assign({ t: 'bid' }, bidDecision(v, level, rnd));
    if (L.kind === 'dbl') return { t: 'dbl', a: doubleDecision(v, level) };
    if (L.kind === 'play' && L.sawa && level !== 'easy') return { t: 'sawa' };
    if (L.kind === 'play') return { t: 'play', c: playDecision(v, level, rnd), proj: true };
    return null;
  }

  return { decide, hokmScore, sunScore, buildInfo, heuristicPlay, sampleHands, makeRng, findProjects };
});
