/*
 * GameHost: owns one game, runs the bots, pauses between tricks and rounds,
 * enforces turn timers (online) and sends each seat its personal view.
 * Used by the offline game in the browser, by the room host in the browser,
 * and by the Node server.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./bot.js'));
  else root.BalootHost = factory(root.BalootEngine, root.BalootBot);
})(typeof self !== 'undefined' ? self : this, function (E, B) {
  'use strict';

  const DEFAULT_TIMING = {
    botBid: 850,
    botPlay: 650,
    botJitter: 450,
    trickPause: 1150,
    roundPause: 0, // 0 = wait for every human to press "next" (offline); >0 auto-continue (online)
    turnBid: 0, // 0 = no limit; online uses ~15000
    turnPlay: 0, // online uses ~20000
    awayPlay: 450,
  };

  function GameHost(opts) {
    this.seats = opts.seats.map((s) => ({ kind: s.kind || 'bot', level: s.level || 'medium', away: false, misses: 0 }));
    this.timing = Object.assign({}, DEFAULT_TIMING, opts.timing || {});
    this.onView = opts.onView || function () {};
    this.onChange = opts.onChange || function () {};
    this.onGameEnd = opts.onGameEnd || function () {};
    this.target = opts.target || 152;
    this.seed = opts.seed;
    this.st = null;
    this.timer = null;
    this.deadline = 0;
    this.ready = new Set();
    this.paused = false;
    this.dead = false;
    this.gameNo = 0;
  }

  GameHost.prototype.start = function (dealer) {
    this.gameNo += 1;
    this.st = E.newGame({ target: this.target, seed: this.seed != null ? this.seed + this.gameNo : undefined, dealer });
    E.startRound(this.st);
    this.ready.clear();
    this._changed();
  };

  // continue a saved game (engine state as plain JSON)
  GameHost.prototype.load = function (st) {
    this.gameNo += 1;
    this.st = st;
    if (st.phase === 'trickEnd' || st.phase === 'roundEnd') {
      /* the scheduler finishes the pause */
    }
    this.ready.clear();
    this._changed();
  };

  GameHost.prototype.rematch = function () {
    const dealer = this.st ? E.nextSeat(this.st.dealer) : undefined;
    this.start(dealer);
  };

  GameHost.prototype.isHumanActive = function (seat) {
    const s = this.seats[seat];
    return s.kind === 'human' && !s.away;
  };

  GameHost.prototype.setSeat = function (seat, patch) {
    Object.assign(this.seats[seat], patch);
    if (patch.away === false) this.seats[seat].misses = 0;
    if (this.st) this._schedule();
  };

  GameHost.prototype.view = function (seat) {
    const v = E.viewFor(this.st, seat);
    v.deadline = this.deadline && this.st.turn != null ? Math.max(0, this.deadline - Date.now()) : 0;
    v.turnTotal = this._turnLimit();
    v.ready = Array.from(this.ready);
    v.away = this.seats.map((s) => s.away || s.kind !== 'human');
    v.gameNo = this.gameNo;
    return v;
  };

  GameHost.prototype.act = function (seat, action, fromTimer) {
    if (this.dead || !this.st) return { ok: false, err: 'no_game' };
    if (action && action.t === 'next') return this.markReady(seat);
    const r = E.apply(this.st, seat, action);
    if (!r.ok) return r;
    if (!fromTimer && this.seats[seat].kind === 'human') {
      this.seats[seat].misses = 0;
      if (this.seats[seat].away && !this.seats[seat].disconnected) this.seats[seat].away = false;
    }
    this._changed();
    return r;
  };

  GameHost.prototype.markReady = function (seat) {
    if (!this.st || this.st.phase !== 'roundEnd') return { ok: false, err: 'not_round_end' };
    this.ready.add(seat);
    const humans = this.seats.map((s, i) => i).filter((i) => this.isHumanActive(i));
    if (humans.every((i) => this.ready.has(i))) {
      this._nextRound();
    } else {
      this._broadcast();
    }
    return { ok: true };
  };

  GameHost.prototype._nextRound = function () {
    this.ready.clear();
    E.nextRound(this.st);
    this._changed();
  };

  GameHost.prototype._turnLimit = function () {
    if (!this.st || this.st.turn == null) return 0;
    if (this.st.phase === 'bidding' || this.st.phase === 'doubling') return this.timing.turnBid;
    if (this.st.phase === 'playing') return this.timing.turnPlay;
    return 0;
  };

  GameHost.prototype._changed = function () {
    this._schedule();
    this._broadcast();
    this.onChange(this);
    if (this.st.phase === 'gameEnd') this.onGameEnd(this.st);
  };

  GameHost.prototype._broadcast = function () {
    for (let s = 0; s < 4; s++) {
      if (this.seats[s].kind === 'human') this.onView(s, this.view(s));
    }
  };

  GameHost.prototype._clear = function () {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
  };

  GameHost.prototype._schedule = function () {
    this._clear();
    if (this.dead || this.paused || !this.st) return;
    const st = this.st;
    const T = this.timing;
    if (st.phase === 'trickEnd') {
      this.timer = setTimeout(() => {
        this.timer = null;
        E.finishTrick(st);
        this._changed();
      }, T.trickPause);
      return;
    }
    if (st.phase === 'roundEnd') {
      const humans = this.seats.filter((s, i) => this.isHumanActive(i));
      if (!humans.length) {
        this.timer = setTimeout(() => this._nextRound(), Math.max(1500, T.roundPause || 2500));
      } else if (T.roundPause > 0) {
        this.deadline = Date.now() + T.roundPause;
        this.timer = setTimeout(() => this._nextRound(), T.roundPause);
      }
      return;
    }
    if (st.phase === 'gameEnd' || st.turn == null) return;
    const seat = st.turn;
    const s = this.seats[seat];
    const bidding = st.phase === 'bidding' || st.phase === 'doubling';
    if (s.kind !== 'human' || s.away) {
      const base = s.kind !== 'human' ? (bidding ? T.botBid : T.botPlay) : T.awayPlay;
      const delay = base + (s.kind !== 'human' ? Math.random() * T.botJitter : 0);
      this.timer = setTimeout(() => this._botMove(seat, s.kind === 'human' ? 'medium' : s.level), delay);
      return;
    }
    const limit = this._turnLimit();
    if (limit > 0) {
      this.deadline = Date.now() + limit;
      this.timer = setTimeout(() => {
        s.misses += 1;
        if (s.misses >= 2) s.away = true;
        this._botMove(seat, 'medium', true);
      }, limit);
    }
  };

  GameHost.prototype._botMove = function (seat, level, fromTimer) {
    this.timer = null;
    if (this.dead || !this.st || this.st.turn !== seat) return;
    const v = E.viewFor(this.st, seat);
    let a = B.decide(v, level);
    let r = E.apply(this.st, seat, a);
    if (!r.ok) {
      // should never happen; fall back to the first legal option
      const L = v.legal;
      if (L.kind === 'play') a = { t: 'play', c: L.cards[0] };
      else if (L.kind === 'bid') a = { t: 'bid', a: L.options[L.options.length - 1] };
      else a = { t: 'dbl', a: 'pass' };
      r = E.apply(this.st, seat, a);
    }
    if (fromTimer && this.seats[seat].kind === 'human') {
      // keep the human's away flag as set by the timer
    }
    this._changed();
  };

  GameHost.prototype.pause = function (p) {
    this.paused = !!p;
    if (this.paused) this._clear();
    else this._schedule();
  };

  GameHost.prototype.destroy = function () {
    this.dead = true;
    this._clear();
  };

  // seat-independent snapshot of who is where, for lobbies/spectators
  GameHost.prototype.publicState = function () {
    return this.st ? E.viewFor(this.st, -1) : null;
  };

  return { GameHost, DEFAULT_TIMING };
});
