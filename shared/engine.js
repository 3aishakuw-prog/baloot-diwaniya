/*
 * Baloot rules engine (Saudi / Gulf rules). Shared by the browser and the Node server.
 * Pure state machine: state is plain JSON, every change goes through apply().
 *
 * Seats 0..3 are in turn order (anticlockwise at the table). Teams: seats 0&2 = team 0, 1&3 = team 1.
 * Cards are strings: rank + suit, ranks 7 8 9 T J Q K A, suits S H D C.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BalootEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const PLAIN_ORDER = { '7': 0, '8': 1, '9': 2, J: 3, Q: 4, K: 5, T: 6, A: 7 };
  const TRUMP_ORDER = { '7': 0, '8': 1, Q: 2, K: 3, T: 4, A: 5, '9': 6, J: 7 };
  const PLAIN_PTS = { '7': 0, '8': 0, '9': 0, J: 2, Q: 3, K: 4, T: 10, A: 11 };
  const TRUMP_PTS = { '7': 0, '8': 0, Q: 3, K: 4, T: 10, A: 11, '9': 14, J: 20 };
  const SEQ_ORDER = { '7': 0, '8': 1, '9': 2, T: 3, J: 4, Q: 5, K: 6, A: 7 };
  const SEQ_RANKS = ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const PROJ_RANK = { sira: 1, '50': 2, '100': 3, '400': 4 };
  const PROJ_PTS = {
    hokm: { sira: 2, '50': 5, '100': 10, '400': 10 },
    sun: { sira: 4, '50': 10, '100': 20, '400': 40 },
  };

  const rank = (c) => c[0];
  const suit = (c) => c[1];
  const partner = (s) => (s + 2) % 4;
  const teamOf = (s) => s % 2;
  const nextSeat = (s) => (s + 1) % 4;
  const bidOrder = (dealer) => [1, 2, 3, 4].map((i) => (dealer + i) % 4);

  function fullDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(r + s);
    return d;
  }

  /* ---------- seeded RNG (mulberry32), state kept in st.rs so it serialises ---------- */
  function rngNext(st) {
    let t = (st.rs = (st.rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(arr, st) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rngNext(st) * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /* ---------- card helpers ---------- */
  function cardPoints(c, contract) {
    if (contract && contract.type === 'hokm' && suit(c) === contract.trump) return TRUMP_PTS[rank(c)];
    return PLAIN_PTS[rank(c)];
  }
  function trickPoints(cards, contract) {
    let p = 0;
    for (const x of cards) p += cardPoints(x.c, contract);
    return p;
  }
  // does card a beat the currently winning card b (led suit `led`, trump suit or null)?
  function beats(a, b, led, trump) {
    const sa = suit(a);
    const sb = suit(b);
    if (trump) {
      if (sa === trump && sb !== trump) return true;
      if (sa !== trump && sb === trump) return false;
      if (sa === trump && sb === trump) return TRUMP_ORDER[rank(a)] > TRUMP_ORDER[rank(b)];
    }
    if (sa === sb) return PLAIN_ORDER[rank(a)] > PLAIN_ORDER[rank(b)];
    return false;
  }
  function trumpOf(contract) {
    return contract && contract.type === 'hokm' ? contract.trump : null;
  }
  function winningIndex(cards, contract) {
    const led = suit(cards[0].c);
    const trump = trumpOf(contract);
    let bi = 0;
    for (let i = 1; i < cards.length; i++) if (beats(cards[i].c, cards[bi].c, led, trump)) bi = i;
    return bi;
  }
  function trickWinner(cards, contract) {
    return cards[winningIndex(cards, contract)].s;
  }
  // order value of a card inside its own suit for the given contract (higher = stronger)
  function strength(c, contract) {
    return suit(c) === trumpOf(contract) ? TRUMP_ORDER[rank(c)] : PLAIN_ORDER[rank(c)];
  }

  // Is card c (non-trump) the highest card of its suit that has not been played yet?
  // `played` is a Set of cards already played this round (including the current trick).
  function isBoss(c, played, contract) {
    const s = suit(c);
    const order = s === trumpOf(contract) ? TRUMP_ORDER : PLAIN_ORDER;
    const v = order[rank(c)];
    for (const r of RANKS) {
      if (order[r] > v && !played.has(r + s)) return false;
    }
    return true;
  }

  /*
   * Legal cards for a player. Implements the Saudi rules:
   *  - follow suit when able;
   *  - Sun: otherwise anything;
   *  - Hokm, trump led: must beat the winning trump if an opponent is winning and you can;
   *  - Hokm, side suit led and you are void: must trump (overtrump if an opponent already trumped);
   *    exempt when your partner is winning and you are last to play, or your partner led the boss card (Ekka);
   *    if you cannot beat an opponent's trump you may play anything;
   *  - Locked (مقفول) game: no trump lead unless the hand is all trumps.
   */
  function legalFrom(hand, trickCards, contract, played, seat) {
    const trump = trumpOf(contract);
    if (trickCards.length === 0) {
      if (trump && contract.locked) {
        const nonT = hand.filter((x) => suit(x) !== trump);
        if (nonT.length) return nonT;
      }
      return hand.slice();
    }
    const led = suit(trickCards[0].c);
    const follow = hand.filter((x) => suit(x) === led);
    if (!trump) return follow.length ? follow : hand.slice();
    const wi = winningIndex(trickCards, contract);
    const winCard = trickCards[wi].c;
    const partnerWinning = trickCards[wi].s === partner(seat);
    if (led === trump) {
      if (!follow.length) return hand.slice();
      if (!partnerWinning) {
        const over = follow.filter((x) => TRUMP_ORDER[rank(x)] > TRUMP_ORDER[rank(winCard)]);
        if (over.length) return over;
      }
      return follow;
    }
    if (follow.length) return follow;
    const trumps = hand.filter((x) => suit(x) === trump);
    if (!trumps.length) return hand.slice();
    if (partnerWinning) {
      if (trickCards.length === 3) return hand.slice();
      if (isBoss(trickCards[0].c, played, contract)) return hand.slice();
      return trumps;
    }
    if (suit(winCard) === trump) {
      const over = trumps.filter((x) => TRUMP_ORDER[rank(x)] > TRUMP_ORDER[rank(winCard)]);
      return over.length ? over : hand.slice();
    }
    return trumps;
  }

  function playedSet(st) {
    const set = new Set();
    for (const t of st.tricks) for (const x of t.cards) set.add(x.c);
    if (st.trick) for (const x of st.trick.cards) set.add(x.c);
    return set;
  }
  function legalPlays(st, seat) {
    if (st.phase !== 'playing' || st.turn !== seat) return [];
    return legalFrom(st.hands[seat], st.trick.cards, st.contract, playedSet(st), seat);
  }

  /* ---------- projects (مشاريع) ---------- */
  function findProjects(hand, type) {
    const cands = [];
    const bySuit = { S: [], H: [], D: [], C: [] };
    for (const c of hand) bySuit[suit(c)].push(SEQ_ORDER[rank(c)]);
    for (const s of SUITS) {
      const idx = bySuit[s].sort((a, b) => a - b);
      let i = 0;
      while (i < idx.length) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
        const L = j - i + 1;
        if (L >= 3) {
          for (let len = 3; len <= Math.min(5, L); len++) {
            for (let a = i; a + len - 1 <= j; a++) {
              const cards = [];
              for (let k = a + len - 1; k >= a; k--) cards.push(SEQ_RANKS[idx[k]] + s);
              cands.push({ k: len === 3 ? 'sira' : len === 4 ? '50' : '100', top: idx[a + len - 1], suit: s, four: false, cards });
            }
          }
        }
        i = j + 1;
      }
    }
    for (const r of ['A', 'K', 'Q', 'J', 'T']) {
      if (SUITS.every((s) => hand.indexOf(r + s) >= 0)) {
        cands.push({ k: r === 'A' && type === 'sun' ? '400' : '100', top: SEQ_ORDER[r], suit: null, four: true, rank: r, cards: SUITS.map((s) => r + s) });
      }
    }
    const val = (p) => ({ sira: 20, '50': 50, '100': 100, '400': 400 })[p.k] + (p.four ? 1 : 0) + p.top / 100;
    let best = [];
    let bestScore = 0;
    for (let a = 0; a < cands.length; a++) {
      const va = val(cands[a]);
      if (va > bestScore) {
        bestScore = va;
        best = [cands[a]];
      }
      for (let b = a + 1; b < cands.length; b++) {
        if (cands[a].cards.some((c) => cands[b].cards.indexOf(c) >= 0)) continue;
        const v = va + val(cands[b]);
        if (v > bestScore) {
          bestScore = v;
          best = [cands[a], cands[b]];
        }
      }
    }
    best.sort((x, y) => val(y) - val(x));
    return best;
  }
  // > 0 when project a beats project b. pos = position in bidding order (earlier wins ties)
  function cmpProject(a, b, order) {
    if (PROJ_RANK[a.k] !== PROJ_RANK[b.k]) return PROJ_RANK[a.k] - PROJ_RANK[b.k];
    if (a.four !== b.four) return a.four ? 1 : -1;
    if (a.top !== b.top) return a.top - b.top;
    return order.indexOf(b.s) - order.indexOf(a.s);
  }
  function projectPoints(k, type) {
    return PROJ_PTS[type][k] || 0;
  }

  /* ---------- rounding to game points ---------- */
  function roundHokm(x) {
    const r = x % 10;
    return (x - r) / 10 + (r > 5 ? 1 : 0);
  }
  function roundSun(x) {
    const r = x % 10;
    if (r === 5) return x / 5;
    return ((x - r) / 10 + (r > 5 ? 1 : 0)) * 2;
  }

  /* ---------- game lifecycle ---------- */
  function newGame(opts) {
    opts = opts || {};
    const st = {
      v: 1,
      target: opts.target || 152,
      rs: opts.seed != null ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0,
      dealer: 0,
      scores: [0, 0],
      roundNo: 0,
      rounds: [],
      phase: 'idle',
      hands: [[], [], [], []],
      stock: [],
      exposed: null,
      bidding: null,
      contract: null,
      doubling: null,
      trick: null,
      tricks: [],
      turn: null,
      projects: null,
      baloot: null,
      summary: null,
      winner: null,
      seq: 0,
      events: [],
    };
    st.dealer = opts.dealer != null ? opts.dealer : Math.floor(rngNext(st) * 4);
    return st;
  }

  function emit(st, ev) {
    st.seq += 1;
    ev.q = st.seq;
    st.events.push(ev);
    if (st.events.length > 80) st.events.splice(0, st.events.length - 80);
  }

  function startRound(st, redeal) {
    if (!redeal) st.roundNo += 1;
    const deck = shuffle(fullDeck(), st);
    st.hands = [[], [], [], []];
    const order = bidOrder(st.dealer);
    for (const s of order) st.hands[s] = deck.splice(0, 5);
    st.exposed = deck.shift();
    st.stock = deck;
    st.contract = null;
    st.doubling = null;
    st.trick = null;
    st.tricks = [];
    st.projects = null;
    st.baloot = null;
    st.summary = null;
    st.bidding = { round: 1, order, idx: 0, stage: 'main', hokmBy: null, hokmSuit: null, checkList: [], ci: 0, log: [] };
    st.phase = 'bidding';
    st.turn = order[0];
    emit(st, { t: 'deal', dealer: st.dealer, exposed: st.exposed, redeal: !!redeal });
  }

  function bidOptions(st, seat) {
    if (st.phase !== 'bidding' || st.turn !== seat) return null;
    const b = st.bidding;
    const pos = b.order.indexOf(seat);
    const ashkalOK = pos >= 2 && rank(st.exposed) !== 'A';
    if (b.stage === 'confirm') return ['confirm', 'sun'];
    if (b.stage === 'sunCheck') return ashkalOK ? ['sun', 'ashkal', 'pass'] : ['sun', 'pass'];
    if (b.round === 1) {
      const o = b.hokmBy == null ? ['hokm', 'sun'] : ['sun'];
      if (ashkalOK) o.push('ashkal');
      o.push('pass');
      return o;
    }
    return b.hokmBy == null ? ['hokm2', 'sun', 'pass'] : ['sun', 'pass'];
  }

  function applyBid(st, seat, a) {
    const opts = bidOptions(st, seat);
    if (!opts || opts.indexOf(a.a) < 0) return { ok: false, err: 'bad_bid' };
    const b = st.bidding;
    if (a.a === 'hokm2' && (SUITS.indexOf(a.suit) < 0 || a.suit === suit(st.exposed))) return { ok: false, err: 'bad_suit' };
    const entry = { s: seat, a: a.a, r: b.round };
    if (a.a === 'hokm') entry.suit = suit(st.exposed);
    if (a.a === 'hokm2') entry.suit = a.suit;
    if (a.a === 'confirm') entry.suit = b.hokmSuit;
    b.log.push(entry);
    emit(st, Object.assign({ t: 'bid' }, entry));
    switch (a.a) {
      case 'sun':
        setContract(st, 'sun', null, seat, seat, false);
        return { ok: true };
      case 'ashkal':
        setContract(st, 'sun', null, seat, partner(seat), true);
        return { ok: true };
      case 'confirm':
        setContract(st, 'hokm', b.hokmSuit, seat, seat, false);
        return { ok: true };
      case 'hokm':
        b.hokmBy = seat;
        b.hokmSuit = suit(st.exposed);
        break;
      case 'hokm2':
        b.hokmBy = seat;
        b.hokmSuit = a.suit;
        break;
      default:
        break;
    }
    advanceBidding(st);
    return { ok: true };
  }

  function advanceBidding(st) {
    const b = st.bidding;
    if (b.stage === 'sunCheck') {
      b.ci += 1;
      if (b.ci < b.checkList.length) {
        st.turn = b.checkList[b.ci];
        return;
      }
      b.stage = 'confirm';
      st.turn = b.hokmBy;
      return;
    }
    b.idx += 1;
    if (b.idx < 4) {
      st.turn = b.order[b.idx];
      return;
    }
    if (b.round === 1) {
      if (b.hokmBy != null) {
        b.checkList = b.order.slice(0, b.order.indexOf(b.hokmBy));
        if (b.checkList.length) {
          b.stage = 'sunCheck';
          b.ci = 0;
          st.turn = b.checkList[0];
          return;
        }
        b.stage = 'confirm';
        st.turn = b.hokmBy;
        return;
      }
      b.round = 2;
      b.idx = 0;
      st.turn = b.order[0];
      emit(st, { t: 'round2' });
      return;
    }
    if (b.hokmBy != null) {
      setContract(st, 'hokm', b.hokmSuit, b.hokmBy, b.hokmBy, false);
      return;
    }
    emit(st, { t: 'redeal' });
    st.dealer = nextSeat(st.dealer);
    startRound(st, true);
  }

  function setContract(st, type, trump, caller, taker, ashkal) {
    const c = { type, trump, caller, taker, team: teamOf(taker), ashkal: !!ashkal, mult: 1, locked: false, gahwa: false, doubler: null };
    st.contract = c;
    st.hands[taker].push(st.exposed);
    for (const s of st.bidding.order) {
      const n = s === taker ? 2 : 3;
      st.hands[s].push.apply(st.hands[s], st.stock.splice(0, n));
    }
    st.projects = { decl: [], team: null, best: null, shown: false };
    st.baloot = null;
    if (type === 'hokm') {
      for (let s = 0; s < 4; s++) {
        if (st.hands[s].indexOf('K' + trump) >= 0 && st.hands[s].indexOf('Q' + trump) >= 0) st.baloot = { s, n: 0, done: false };
      }
    }
    st.bidding.stage = 'done';
    emit(st, { t: 'contract', type, trump, caller, taker, ashkal: !!ashkal });
    startDoubling(st);
  }

  function startDoubling(st) {
    const c = st.contract;
    const T = c.team;
    const O = 1 - T;
    const allowed = c.type === 'hokm' || (st.scores[T] > 100 && st.scores[O] < 100);
    if (!allowed) return startPlay(st);
    const opp = [nextSeat(c.taker), (c.taker + 3) % 4];
    st.doubling = { stage: 'double', asked: opp, i: 0, log: [] };
    st.phase = 'doubling';
    st.turn = opp[0];
  }

  function doubleOptions(st, seat) {
    if (st.phase !== 'doubling' || st.turn !== seat) return null;
    const hokm = st.contract.type === 'hokm';
    switch (st.doubling.stage) {
      case 'double':
        return hokm ? ['double', 'doubleLocked', 'pass'] : ['double', 'pass'];
      case 'triple':
        return ['triple', 'pass'];
      case 'four':
        return ['four', 'fourLocked', 'pass'];
      case 'gahwa':
        return ['gahwa', 'pass'];
      default:
        return null;
    }
  }

  function applyDouble(st, seat, a) {
    const opts = doubleOptions(st, seat);
    if (!opts || opts.indexOf(a.a) < 0) return { ok: false, err: 'bad_double' };
    const c = st.contract;
    const d = st.doubling;
    d.log.push({ s: seat, a: a.a });
    emit(st, { t: 'dbl', s: seat, a: a.a });
    switch (a.a) {
      case 'double':
      case 'doubleLocked':
        c.mult = 2;
        c.locked = a.a === 'doubleLocked';
        c.doubler = seat;
        if (c.type !== 'hokm') return startPlay(st), { ok: true };
        d.stage = 'triple';
        st.turn = c.taker;
        return { ok: true };
      case 'triple':
        c.mult = 3;
        c.locked = false;
        d.stage = 'four';
        st.turn = c.doubler;
        return { ok: true };
      case 'four':
      case 'fourLocked':
        c.mult = 4;
        c.locked = a.a === 'fourLocked';
        d.stage = 'gahwa';
        st.turn = c.taker;
        return { ok: true };
      case 'gahwa':
        c.gahwa = true;
        c.locked = false;
        startPlay(st);
        return { ok: true };
      default:
        if (d.stage === 'double') {
          d.i += 1;
          if (d.i < d.asked.length) {
            st.turn = d.asked[d.i];
            return { ok: true };
          }
        }
        startPlay(st);
        return { ok: true };
    }
  }

  function startPlay(st) {
    if (st.doubling) st.doubling.stage = 'done';
    st.phase = 'playing';
    const leader = st.bidding.order[0];
    st.trick = { leader, cards: [], winner: null };
    st.turn = leader;
    emit(st, { t: 'start', leader });
  }

  function applyPlay(st, seat, a) {
    if (st.phase !== 'playing' || st.turn !== seat) return { ok: false, err: 'not_turn' };
    const legal = legalPlays(st, seat);
    if (legal.indexOf(a.c) < 0) return { ok: false, err: 'illegal' };
    const c = st.contract;
    if (st.tricks.length === 0 && a.proj) {
      const found = findProjects(st.hands[seat], c.type);
      const chosen = a.proj === true ? found : found.filter((p, i) => Array.isArray(a.proj) && a.proj.indexOf(i) >= 0);
      if (chosen.length) {
        for (const p of chosen) st.projects.decl.push({ s: seat, k: p.k, top: p.top, four: p.four, suit: p.suit, cards: p.cards });
        emit(st, { t: 'declare', s: seat, list: chosen.map((p) => p.k) });
      }
    }
    const h = st.hands[seat];
    h.splice(h.indexOf(a.c), 1);
    st.trick.cards.push({ s: seat, c: a.c });
    emit(st, { t: 'play', s: seat, c: a.c });
    if (st.baloot && st.baloot.s === seat && c.type === 'hokm' && (a.c === 'K' + c.trump || a.c === 'Q' + c.trump)) {
      st.baloot.n += 1;
      if (st.baloot.n === 2 && !balootBlocked(st)) {
        st.baloot.done = true;
        emit(st, { t: 'baloot', s: seat });
      }
    }
    if (st.trick.cards.length < 4) {
      st.turn = nextSeat(seat);
      return { ok: true };
    }
    const w = trickWinner(st.trick.cards, c);
    st.trick.winner = w;
    st.phase = 'trickEnd';
    st.turn = null;
    const last = st.tricks.length === 7;
    emit(st, { t: 'trick', w, pts: trickPoints(st.trick.cards, c) + (last ? 10 : 0) });
    return { ok: true };
  }

  function balootBlocked(st) {
    const b = st.baloot;
    const t = st.contract.trump;
    return st.projects.decl.some((p) => p.s === b.s && (p.k === '100' || p.k === '400') && (p.cards.indexOf('K' + t) >= 0 || p.cards.indexOf('Q' + t) >= 0));
  }

  // called by the host after the trick has been shown for a moment
  function finishTrick(st) {
    if (st.phase !== 'trickEnd') return false;
    const t = st.trick;
    t.pts = trickPoints(t.cards, st.contract);
    st.tricks.push(t);
    if (st.tricks.length === 1) resolveProjects(st);
    if (st.tricks.length === 8) {
      endRound(st);
      return true;
    }
    st.trick = { leader: t.winner, cards: [], winner: null };
    st.phase = 'playing';
    st.turn = t.winner;
    return true;
  }

  function resolveProjects(st) {
    const d = st.projects.decl;
    if (!d.length) return;
    const order = st.bidding.order;
    let best = null;
    for (const p of d) if (!best || cmpProject(p, best, order) > 0) best = p;
    st.projects.best = best;
    st.projects.team = teamOf(best.s);
    st.projects.shown = true;
    emit(st, { t: 'projShow', team: st.projects.team, list: d.filter((p) => teamOf(p.s) === st.projects.team).map((p) => ({ s: p.s, k: p.k, cards: p.cards })) });
  }

  function endRound(st) {
    const c = st.contract;
    const T = c.team;
    const O = 1 - T;
    const hokm = c.type === 'hokm';
    const abnat = [0, 0];
    const tricksWon = [0, 0];
    st.tricks.forEach((t, i) => {
      const tm = teamOf(t.winner);
      abnat[tm] += t.pts + (i === 7 ? 10 : 0);
      tricksWon[tm] += 1;
    });
    const projPts = [0, 0];
    const projList = [[], []];
    if (st.projects.team != null) {
      for (const p of st.projects.decl) {
        if (teamOf(p.s) !== st.projects.team) continue;
        projPts[st.projects.team] += projectPoints(p.k, c.type);
        projList[st.projects.team].push(p.k);
      }
    }
    const bal = [0, 0];
    if (st.baloot && st.baloot.done) bal[teamOf(st.baloot.s)] = 2;
    const total = hokm ? 16 : 26;
    const res = {
      type: c.type, trump: c.trump, caller: c.caller, taker: c.taker, team: T, mult: c.mult, gahwa: c.gahwa,
      abnat, tricksWon, projPts, projList, bal, cardPts: [0, 0], pts: [0, 0], outcome: 'made', kaboot: null, winTeam: T,
    };
    if (tricksWon[O] === 0 || tricksWon[T] === 0) {
      const K = tricksWon[O] === 0 ? T : O;
      const base = hokm ? 25 : 44;
      res.kaboot = K;
      res.winTeam = K;
      res.outcome = K === T ? 'kaboot' : 'kabootFail';
      res.cardPts[K] = base * c.mult;
      res.pts[K] = base * c.mult + projPts[K] * (c.mult > 1 ? 2 : 1) + bal[K];
    } else {
      const oPts = hokm ? roundHokm(abnat[O]) : roundSun(abnat[O]);
      const tPts = total - oPts;
      res.cardPts[T] = tPts;
      res.cardPts[O] = oPts;
      const per = hokm ? 10 : 5;
      const tTot = tPts + projPts[T] + bal[T];
      const oTot = oPts + projPts[O] + bal[O];
      let made = tTot > oTot;
      if (tTot === oTot) made = abnat[T] + (projPts[T] + bal[T]) * per >= abnat[O] + (projPts[O] + bal[O]) * per;
      res.winTeam = made ? T : O;
      res.outcome = made ? 'made' : 'fail';
      if (c.mult === 1) {
        if (made) {
          res.pts[T] = tTot;
          res.pts[O] = oTot;
        } else {
          res.pts[O] = total + projPts[T] + projPts[O] + bal[O];
          res.pts[T] = bal[T];
        }
      } else {
        const W = res.winTeam;
        const L = 1 - W;
        res.pts[W] = total * c.mult + (projPts[T] + projPts[O]) * 2 + bal[W];
        res.pts[L] = bal[L];
      }
    }
    st.scores[0] += res.pts[0];
    st.scores[1] += res.pts[1];
    res.scores = st.scores.slice();
    st.summary = res;
    st.rounds.push({ n: st.roundNo, type: c.type, trump: c.trump, caller: c.caller, team: T, mult: c.mult, gahwa: c.gahwa, outcome: res.outcome, pts: res.pts.slice() });
    st.phase = 'roundEnd';
    st.turn = null;
    if (c.gahwa) {
      st.winner = res.winTeam;
      st.phase = 'gameEnd';
    } else if ((st.scores[0] >= st.target || st.scores[1] >= st.target) && st.scores[0] !== st.scores[1]) {
      st.winner = st.scores[0] > st.scores[1] ? 0 : 1;
      st.phase = 'gameEnd';
    }
    emit(st, { t: 'roundEnd', outcome: res.outcome, pts: res.pts.slice(), winner: st.winner });
  }

  function nextRound(st) {
    if (st.phase !== 'roundEnd') return false;
    st.dealer = nextSeat(st.dealer);
    startRound(st, false);
    return true;
  }

  /*
   * سوا: the player on lead claims every remaining trick for his team.
   * Only offered when it is guaranteed: the claimer's team can win every trick whatever the opponents play
   * (full-information search, so a claim can never be wrong).
   */
  function canSweep(st, seat) {
    const c = st.contract;
    const team = teamOf(seat);
    const hands = st.hands.map((x) => x.slice());
    const played = playedSet(st);
    let nodes = 0;
    const ABORT = {};
    function step(trick, cur) {
      if (++nodes > 40000) throw ABORT;
      if (trick.length === 4) {
        const w = trickWinner(trick, c);
        if (teamOf(w) !== team) return false;
        return hands[w].length === 0 ? true : step([], w);
      }
      const legal = legalFrom(hands[cur], trick, c, played, cur);
      const mine = teamOf(cur) === team;
      for (const card of legal) {
        const h = hands[cur];
        h.splice(h.indexOf(card), 1);
        played.add(card);
        trick.push({ s: cur, c: card });
        let r;
        try {
          r = step(trick, nextSeat(cur));
        } finally {
          trick.pop();
          played.delete(card);
          h.push(card);
        }
        if (mine && r) return true;
        if (!mine && !r) return false;
      }
      return !mine;
    }
    try {
      return step([], seat);
    } catch (e) {
      if (e === ABORT) return false;
      throw e;
    }
  }
  function sawaOK(st, seat) {
    if (st.phase !== 'playing' || st.turn !== seat || !st.trick || st.trick.cards.length) return false;
    const n = st.hands[seat].length;
    if (st.tricks.length < 1 || n < 2 || n > 6) return false;
    if (st._sawa && st._sawa.q === st.seq && st._sawa.s === seat) return st._sawa.v;
    const v = canSweep(st, seat);
    Object.defineProperty(st, '_sawa', { value: { q: st.seq, s: seat, v }, enumerable: false, configurable: true, writable: true });
    return v;
  }
  function applySawa(st, seat) {
    if (!sawaOK(st, seat)) return { ok: false, err: 'bad_sawa' };
    emit(st, { t: 'sawa', s: seat });
    if (st.baloot && !st.baloot.done && !balootBlocked(st)) {
      st.baloot.done = true;
      emit(st, { t: 'baloot', s: st.baloot.s });
    }
    while (st.hands[seat].length) {
      const cards = [];
      for (let k = 0; k < 4; k++) {
        const s2 = (seat + k) % 4;
        cards.push({ s: s2, c: st.hands[s2].shift() });
      }
      st.tricks.push({ leader: seat, cards, winner: seat, pts: trickPoints(cards, st.contract), sawa: true });
    }
    st.trick = { leader: seat, cards: [], winner: null };
    st.turn = null;
    endRound(st);
    return { ok: true };
  }

  function apply(st, seat, a) {
    if (!a || typeof a !== 'object') return { ok: false, err: 'bad_action' };
    switch (a.t) {
      case 'bid':
        return applyBid(st, seat, a);
      case 'dbl':
        return applyDouble(st, seat, a);
      case 'play':
        return applyPlay(st, seat, a);
      case 'sawa':
        return applySawa(st, seat);
      default:
        return { ok: false, err: 'unknown_action' };
    }
  }

  function legalFor(st, seat) {
    if (st.turn !== seat) return null;
    if (st.phase === 'bidding') {
      const o = bidOptions(st, seat);
      return o && { kind: 'bid', options: o, suits: SUITS.filter((s) => s !== suit(st.exposed)) };
    }
    if (st.phase === 'doubling') {
      const o = doubleOptions(st, seat);
      return o && { kind: 'dbl', options: o };
    }
    if (st.phase === 'playing') {
      const l = { kind: 'play', cards: legalPlays(st, seat) };
      if (st.tricks.length === 0) l.projects = findProjects(st.hands[seat], st.contract.type).map((p) => ({ k: p.k, cards: p.cards }));
      if (sawaOK(st, seat)) l.sawa = true;
      return l;
    }
    return null;
  }

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  // What one seat is allowed to know. seat = -1 for a spectator.
  function viewFor(st, seat) {
    const pr = st.projects;
    let projects = null;
    if (pr) {
      projects = {
        decl: pr.decl.map((p) => ({ s: p.s, k: p.k })),
        team: pr.team,
        shown: pr.shown ? pr.decl.filter((p) => teamOf(p.s) === pr.team).map((p) => ({ s: p.s, k: p.k, cards: p.cards.slice() })) : [],
      };
    }
    return {
      me: seat,
      phase: st.phase,
      dealer: st.dealer,
      target: st.target,
      scores: st.scores.slice(),
      roundNo: st.roundNo,
      hand: seat >= 0 ? st.hands[seat].slice() : [],
      counts: st.hands.map((h) => h.length),
      exposed: st.exposed,
      bidding: st.bidding && { round: st.bidding.round, stage: st.bidding.stage, order: st.bidding.order.slice(), hokmBy: st.bidding.hokmBy, hokmSuit: st.bidding.hokmSuit, log: clone(st.bidding.log) },
      contract: clone(st.contract),
      doubling: st.doubling && { stage: st.doubling.stage, asked: st.doubling.asked.slice(), log: clone(st.doubling.log) },
      trick: clone(st.trick),
      tricks: clone(st.tricks),
      turn: st.turn,
      projects,
      baloot: st.baloot && st.baloot.done ? { s: st.baloot.s } : null,
      summary: clone(st.summary),
      rounds: clone(st.rounds),
      winner: st.winner,
      legal: seat >= 0 ? legalFor(st, seat) : null,
      seq: st.seq,
      events: clone(st.events.slice(-24)),
    };
  }

  /* ---------- display helpers ---------- */
  const SUIT_ORDER_DISPLAY = ['S', 'H', 'C', 'D'];
  function sortHand(hand, contract) {
    const trump = trumpOf(contract);
    const suitsPresent = SUIT_ORDER_DISPLAY.filter((s) => hand.some((c) => suit(c) === s));
    // keep colours alternating where possible, trump first
    let order = suitsPresent;
    if (trump && suitsPresent.indexOf(trump) >= 0) order = [trump].concat(suitsPresent.filter((s) => s !== trump));
    const red = (s) => s === 'H' || s === 'D';
    const arranged = [];
    const pool = order.slice();
    while (pool.length) {
      let pick = 0;
      if (arranged.length) {
        const lastRed = red(arranged[arranged.length - 1]);
        const alt = pool.findIndex((s) => red(s) !== lastRed);
        if (alt >= 0 && !(arranged.length === 0)) pick = alt;
      }
      arranged.push(pool.splice(pick, 1)[0]);
    }
    return hand.slice().sort((a, b) => {
      const sa = arranged.indexOf(suit(a));
      const sb = arranged.indexOf(suit(b));
      if (sa !== sb) return sa - sb;
      return strength(b, contract) - strength(a, contract);
    });
  }

  const SUIT_AR = { S: 'سبيت', H: 'هاص', D: 'ديمن', C: 'شريا' };
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RANK_LABEL = { '7': '7', '8': '8', '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
  const PROJ_AR = { sira: 'سرا', '50': 'خمسين', '100': 'مية', '400': 'أربعمية' };

  return {
    SUITS, RANKS, PLAIN_ORDER, TRUMP_ORDER, PLAIN_PTS, TRUMP_PTS, SEQ_ORDER, PROJ_PTS, PROJ_RANK,
    SUIT_AR, SUIT_SYM, RANK_LABEL, PROJ_AR,
    rank, suit, partner, teamOf, nextSeat, bidOrder, fullDeck, rngNext, shuffle,
    cardPoints, trickPoints, beats, trickWinner, winningIndex, strength, isBoss, trumpOf,
    legalFrom, legalPlays, playedSet, findProjects, cmpProject, projectPoints, roundHokm, roundSun,
    newGame, startRound, nextRound, finishTrick, apply, bidOptions, doubleOptions, legalFor, viewFor, sortHand, canSweep, sawaOK,
  };
});
