/*
 * Accounts and game sessions.
 *  - Auth: 'server' (own Node server: username/password + guest), 'claude' (Claude artifact identity), 'local' (this device only).
 *  - LocalSession: offline game against bots, entirely in the browser.
 *  - WsSession: online game through the Node server (WebSocket).
 *  - RoomSession: online game through the Claude artifact "room" (host runs the game, hands are encrypted per player).
 */
(function () {
  'use strict';
  const E = window.BalootEngine;
  const { GameHost } = window.BalootHost;

  /* ---------------- small utils ---------------- */
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('baloot.' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('baloot.' + k, JSON.stringify(v));
      } catch (e) {
        /* storage may be unavailable */
      }
    },
    del(k) {
      try {
        localStorage.removeItem('baloot.' + k);
      } catch (e) {
        /* ignore */
      }
    },
  };
  function Emitter() {
    this._h = {};
  }
  Emitter.prototype.on = function (t, fn) {
    (this._h[t] = this._h[t] || []).push(fn);
    return this;
  };
  Emitter.prototype.emit = function (t, d) {
    (this._h[t] || []).forEach((fn) => {
      try {
        fn(d);
      } catch (e) {
        console.error(e);
      }
    });
  };
  const rid = (n) => {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  };
  const deviceId = store.get('device') || 'd' + rid(12);
  store.set('device', deviceId);
  const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

  const AVATARS = ['🦅', '🐪', '🌴', '☕', '🫖', '🐎', '🦁', '🐆', '🌙', '⛵', '🌹', '🔥', '💎', '🦌', '🏜️', '⭐', '🐺', '🦉'];
  const AV_BG = ['#c9342f', '#2f7a57', '#33458a', '#d9a441', '#7a3e8c', '#1f6f7a', '#b4552d', '#4a5a2a', '#8e1c1d', '#2b2b54', '#a3346a', '#3c6e47', '#6d4c2f', '#2d5f8b', '#9a6b1f', '#5b2a86', '#545454', '#7b2e2e'];
  const BOT_NAMES = ['بو ناصر', 'مشعل', 'سعود', 'بدر', 'فهد', 'بو خالد', 'حمد', 'نايف', 'مبارك', 'تركي', 'سلطان', 'بو فيصل', 'نوف', 'ريم', 'ضاري', 'جاسم'];

  function levelOf(xp) {
    const lv = Math.floor(Math.sqrt((xp || 0) / 60)) + 1;
    const cur = (lv - 1) * (lv - 1) * 60;
    const next = lv * lv * 60;
    return { lv, pct: Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100)) };
  }
  function blankStats() {
    return { games: 0, wins: 0, losses: 0, xp: 0, kaboot: 0, online: 0 };
  }
  function xpFor(r) {
    let x = r.win ? 40 : 12;
    if (r.mode === 'offline') x = Math.round(x * ({ easy: 0.5, medium: 1, hard: 1.5 }[r.level] || 1));
    else x = Math.round(x * 1.5);
    return x + (r.kaboots || 0) * 5;
  }
  function applyResult(stats, r) {
    const s = Object.assign(blankStats(), stats || {});
    s.games += 1;
    if (r.win) s.wins += 1;
    else s.losses += 1;
    s.kaboot += r.kaboots || 0;
    if (r.mode !== 'offline') s.online += 1;
    const gained = xpFor(r);
    s.xp += gained;
    return { stats: s, gained };
  }

  /* ---------------- runtime ---------------- */
  const Runtime = {
    kind: 'local',
    detect() {
      if (window.BALOOT_RUNTIME) this.kind = window.BALOOT_RUNTIME;
      else if (window.claude && typeof window.claude.use === 'function') this.kind = 'claude';
      else if (/^https?:$/.test(location.protocol) && !window.BALOOT_NO_SERVER) this.kind = 'server';
      else this.kind = 'local';
      return this.kind;
    },
  };

  /* ---------------- Claude artifact capabilities ---------------- */
  const CL = {
    ready: null,
    user: null,
    db: null,
    room: null,
    uid: null,
    name: '',
    init() {
      if (this.ready) return this.ready;
      this.ready = (async () => {
        for (let i = 0; i < 30 && !(window.claude && window.claude.use); i++) await new Promise((r) => setTimeout(r, 100));
        if (!(window.claude && typeof window.claude.use === 'function')) return this;
        const use = (n) => withTimeout(Promise.resolve(window.claude.use(n)).catch(() => null), 11000, null);
        const [user, db, room] = await Promise.all([use('user'), use('db'), use('room')]);
        this.user = user;
        this.db = db;
        this.room = room;
        if (user) {
          try {
            const me = await user.me();
            this.uid = me.id || null;
            this.name = me.name || '';
          } catch (e) {
            /* ignore */
          }
        }
        return this;
      })();
      return this.ready;
    },
  };

  /* ---------------- Auth ---------------- */
  const Auth = new Emitter();
  Auth.mode = 'local';
  Auth.user = null;
  Auth.serverUp = false;
  Auth.token = store.get('token', null);

  async function api(path, body, method) {
    const res = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: Object.assign({ 'Content-Type': 'application/json' }, Auth.token ? { Authorization: 'Bearer ' + Auth.token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* ignore */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'http_' + res.status);
      err.status = res.status;
      throw err;
    }
    if (data && data.token && Auth.token && path !== '/api/login' && path !== '/api/register' && path !== '/api/guest') {
      Auth.token = data.token;
      store.set('token', data.token);
    }
    return data;
  }

  Auth.init = async function () {
    const kind = Runtime.detect();
    this.mode = kind;
    if (kind === 'server') {
      try {
        const ok = await withTimeout(api('/api/ping').then(() => true, () => false), 4000, false);
        if (!ok) throw new Error('down');
        this.serverUp = true;
      } catch (e) {
        this.serverUp = false;
      }
      if (this.serverUp && this.token) {
        try {
          const r = await api('/api/me');
          this.user = r.user;
          store.set('user', this.user);
          return this.user;
        } catch (e) {
          if (e.status === 401) {
            this.token = null;
            store.del('token');
          }
        }
      }
      if (this.serverUp && !this.token && store.get('user', null)) {
        this.user = store.get('user', null);
        await this.upgradeLocal();
        if (this.token) return this.user;
      }
      if (!this.serverUp) {
        // offline or the server is waking up: play with the last known profile, keep checking
        this.user = store.get('user', null);
        this._watchServer();
        return this.user;
      }
      return null;
    }
    if (kind === 'claude') {
      const local = store.get('user', null);
      this.user = local;
      CL.init().then(async () => {
        if (CL.db && CL.uid) {
          try {
            const snap = await CL.db.doc('data/users/' + CL.uid + '/profile').get();
            if (snap.exists) {
              const d = snap.data();
              const merged = Object.assign({}, this.user || {}, d, { id: CL.uid, claude: true });
              // keep the larger stats (a device may have played offline)
              if (this.user && this.user.stats && d.stats && (this.user.stats.games || 0) > (d.stats.games || 0)) merged.stats = this.user.stats;
              this.user = merged;
              store.set('user', this.user);
              this.emit('user', this.user);
            }
          } catch (e) {
            /* ignore */
          }
        }
        this.emit('claude', CL);
      });
      return this.user;
    }
    this.user = store.get('user', null);
    return this.user;
  };

  Auth._watchServer = function () {
    if (this._watching) return;
    this._watching = true;
    const tick = async () => {
      const ok = await withTimeout(api('/api/ping').then(() => true, () => false), 6000, false);
      if (!ok) return setTimeout(tick, 8000);
      this._watching = false;
      this.serverUp = true;
      if (!this.token && this.user) await this.upgradeLocal();
      if (this.token) {
        try {
          const r = await api('/api/me');
          this.user = r.user;
          store.set('user', this.user);
        } catch (e) {
          /* keep the local copy */
        }
      }
      this.emit('server', true);
      this.emit('user', this.user);
    };
    setTimeout(tick, 4000);
  };
  // a profile made while the server was unreachable becomes a real guest account (progress kept)
  Auth.upgradeLocal = async function () {
    if (this.mode !== 'server' || !this.serverUp || this.token || !this.user) return;
    try {
      const r = await api('/api/guest', { nick: this.user.nick, av: this.user.av, stats: this.user.stats || null });
      this._session(r);
    } catch (e) {
      /* stay local */
    }
  };
  Auth.deleteAccount = async function (password) {
    if (this.mode === 'server') {
      await api('/api/account/delete', { password: password || '' });
    } else if (this.mode === 'claude') {
      await CL.init();
      if (CL.db && CL.uid) {
        try {
          await CL.db.doc('data/users/' + CL.uid + '/profile').delete();
        } catch (e) {
          /* ignore */
        }
        try {
          await CL.db.doc('board/' + CL.uid).delete();
        } catch (e) {
          /* ignore */
        }
      }
    }
    this.token = null;
    store.del('token');
    this.user = null;
    store.del('user');
  };
  Auth.claudeName = function () {
    return CL.name;
  };
  Auth.canOnline = function () {
    if (this.mode === 'server') return this.serverUp && !!this.token;
    if (this.mode === 'claude') return !!CL.room;
    return false;
  };
  Auth.onlineReason = function () {
    if (this.mode === 'server') return this.serverUp ? 'سجّل دخول للعب أونلاين' : 'ما فيه اتصال بالسيرفر الحين';
    if (this.mode === 'claude') return CL.ready ? 'الأونلاين يحتاج تفتح اللعبة من حسابك في Claude' : 'جاري التحميل…';
    return 'الأونلاين يشتغل لما ترفع اللعبة على السيرفر';
  };

  Auth.register = async function (username, password, nick, av) {
    const r = await api('/api/register', { username, password, nick, av });
    this._session(r);
    return r.user;
  };
  Auth.login = async function (username, password) {
    const r = await api('/api/login', { username, password });
    this._session(r);
    return r.user;
  };
  Auth.guest = async function (nick, av) {
    if (this.mode === 'server' && this.serverUp) {
      const r = await api('/api/guest', { nick, av });
      this._session(r);
      return r.user;
    }
    const prev = store.get('user', null);
    const u = { id: (this.mode === 'claude' && CL.uid) || 'local-' + deviceId, nick, av, guest: this.mode !== 'claude', claude: this.mode === 'claude', stats: (prev && prev.stats) || blankStats() };
    this.user = u;
    store.set('user', u);
    this._saveClaude();
    if (this.mode === 'server') this._watchServer();
    return u;
  };
  Auth._session = function (r) {
    this.token = r.token;
    store.set('token', r.token);
    this.user = r.user;
    store.set('user', r.user);
    this.emit('user', r.user);
  };
  Auth.saveProfile = async function (nick, av) {
    if (!this.user) return;
    this.user.nick = nick;
    this.user.av = av;
    store.set('user', this.user);
    if (this.mode === 'server' && this.serverUp && this.token) {
      try {
        const r = await api('/api/profile', { nick, av });
        this.user = r.user;
        store.set('user', this.user);
      } catch (e) {
        /* keep local */
      }
    }
    this._saveClaude();
  };
  Auth.logout = async function () {
    if (this.mode === 'server' && this.token) {
      try {
        await api('/api/logout', {});
      } catch (e) {
        /* ignore */
      }
    }
    this.token = null;
    store.del('token');
    this.user = null;
    store.del('user');
  };
  Auth._saveClaude = async function () {
    if (this.mode !== 'claude') return;
    await CL.init();
    if (!CL.db || !CL.uid || !this.user) return;
    const u = this.user;
    try {
      await CL.db.doc('data/users/' + CL.uid + '/profile').set({ nick: u.nick, av: u.av, stats: u.stats || blankStats() });
    } catch (e) {
      /* viewers may not write */
    }
    try {
      const s = u.stats || blankStats();
      await CL.db.doc('board/' + CL.uid).set({ nick: u.nick, av: u.av, wins: s.wins, games: s.games, xp: s.xp });
    } catch (e) {
      /* ignore */
    }
  };
  // r: { win, mode: 'offline'|'online', level, kaboots }
  Auth.addResult = async function (r) {
    if (!this.user) return 0;
    const { stats, gained } = applyResult(this.user.stats, r);
    this.user.stats = stats;
    store.set('user', this.user);
    if (this.mode === 'server' && this.serverUp && this.token && r.mode === 'offline') {
      try {
        const res = await api('/api/result', r);
        if (res && res.user) {
          this.user = res.user;
          store.set('user', this.user);
        }
      } catch (e) {
        /* offline */
      }
    }
    this._saveClaude();
    this.emit('user', this.user);
    return gained;
  };
  // the server records online results itself; refresh our copy afterwards
  Auth.refresh = async function () {
    if (this.mode === 'server' && this.serverUp && this.token) {
      try {
        const r = await api('/api/me');
        this.user = r.user;
        store.set('user', this.user);
        this.emit('user', this.user);
      } catch (e) {
        /* ignore */
      }
    }
  };
  Auth.leaderboard = async function () {
    if (this.mode === 'server' && this.serverUp) {
      const r = await api('/api/leaderboard');
      return r.list;
    }
    if (this.mode === 'claude') {
      await CL.init();
      if (!CL.db) return null;
      const snap = await withTimeout(CL.db.collection('board').orderBy('wins', 'desc').limit(30).get(), 10000, null);
      if (!snap) return null;
      return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    }
    return null;
  };

  /* ---------------- shared view helpers ---------------- */
  function normalizeView(v) {
    if (v.tricks) {
      v.lastTrick = v.tricks.length ? v.tricks[v.tricks.length - 1] : null;
      v.tricksWon = [0, 0];
      for (const t of v.tricks) v.tricksWon[E.teamOf(t.winner)]++;
    }
    return v;
  }

  /* ---------------- offline ---------------- */
  function LocalSession(opts) {
    Emitter.call(this);
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const avs = AVATARS.slice(1).sort(() => Math.random() - 0.5);
    const me = opts.me;
    this.kind = 'offline';
    this.mySeat = 0;
    this.level = opts.level || 'medium';
    this.players = opts.players || [
      { name: me.nick, av: me.av, lv: levelOf((me.stats || {}).xp).lv, me: true },
      { name: names[0], av: avs[0], bot: true, lv: botLv(this.level) },
      { name: names[1], av: avs[1], bot: true, lv: botLv(this.level) },
      { name: names[2], av: avs[2], bot: true, lv: botLv(this.level) },
    ];
    const speed = opts.speed || 1;
    this.host = new GameHost({
      seats: [{ kind: 'human' }, { kind: 'bot', level: this.level }, { kind: 'bot', level: this.level }, { kind: 'bot', level: this.level }],
      target: opts.target || 152,
      timing: { botBid: 850 * speed, botPlay: 650 * speed, botJitter: 450 * speed, trickPause: 1150 * speed },
      onView: (s, v) => {
        if (s === 0) this.emit('view', normalizeView(v));
      },
    });
  }
  function botLv(level) {
    return { easy: 3, medium: 9, hard: 17 }[level] + Math.floor(Math.random() * 6);
  }
  LocalSession.prototype = Object.create(Emitter.prototype);
  LocalSession.prototype.start = function () {
    this.emit('players', this.players);
    this.host.start();
  };
  LocalSession.prototype.resume = function (st) {
    this.emit('players', this.players);
    this.host.load(st);
  };
  LocalSession.prototype.act = function (a) {
    const r = this.host.act(0, a);
    if (!r.ok) this.emit('error', r.err);
    return r;
  };
  LocalSession.prototype.next = function () {
    this.host.act(0, { t: 'next' });
  };
  LocalSession.prototype.chat = function (m) {
    this.emit('chat', { s: 0, m });
  };
  LocalSession.prototype.rematch = function () {
    this.host.rematch();
  };
  LocalSession.prototype.pause = function (p) {
    this.host.pause(p);
  };
  LocalSession.prototype.leave = function () {
    this.host.destroy();
  };

  /* ---------------- server WebSocket ---------------- */
  const WS = new Emitter();
  WS.sock = null;
  WS.open = false;
  WS.queue = [];
  WS.retry = 0;
  WS.wanted = false;
  WS.connect = function () {
    this.wanted = true;
    if (this.sock && (this.sock.readyState === 0 || this.sock.readyState === 1)) return;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    let s;
    try {
      s = new WebSocket(url);
    } catch (e) {
      this._later();
      return;
    }
    this.sock = s;
    s.onopen = () => {
      this.open = true;
      this.retry = 0;
      s.send(JSON.stringify({ t: 'auth', token: Auth.token }));
    };
    s.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if ((m.t === 'hello' || m.t === 'token') && m.token) {
        Auth.token = m.token;
        store.set('token', m.token);
        if (m.user) {
          Auth.user = m.user;
          store.set('user', m.user);
        }
      }
      if (m.t === 'hello') {
        const q = this.queue;
        this.queue = [];
        q.forEach((x) => s.send(JSON.stringify(x)));
      }
      this.emit(m.t, m);
      this.emit('*', m);
    };
    s.onclose = () => {
      this.open = false;
      this.emit('down');
      if (this.wanted) this._later();
    };
    s.onerror = () => {
      /* onclose follows */
    };
  };
  WS._later = function () {
    this.retry = Math.min(this.retry + 1, 6);
    setTimeout(() => this.wanted && this.connect(), 400 * this.retry * this.retry);
  };
  WS.send = function (m) {
    if (this.open && this.sock && this.sock.readyState === 1) this.sock.send(JSON.stringify(m));
    else {
      this.queue.push(m);
      this.connect();
    }
  };
  WS.close = function () {
    this.wanted = false;
    if (this.sock) this.sock.close();
  };

  function WsSession() {
    Emitter.call(this);
    this.kind = 'online';
    this.mySeat = 0;
    this.room = null;
    this._off = [];
    const on = (t, fn) => {
      WS.on(t, fn);
      this._off.push([t, fn]);
    };
    on('room', (m) => {
      this.room = m.room;
      this.mySeat = m.room.you;
      this.emit('room', m.room);
      this.emit(
        'players',
        m.room.seats.map((p, i) => (p ? { name: p.name, av: p.av, lv: p.lv, bot: !!p.bot, me: i === m.room.you, away: p.away } : { name: '…', av: '❔', empty: true }))
      );
    });
    on('view', (m) => this.emit('view', normalizeView(m.v)));
    on('chat', (m) => this.emit('chat', m));
    on('queue', (m) => this.emit('queue', m));
    on('err', (m) => this.emit('error', m.m));
    on('left', () => this.emit('closed', 'left'));
    on('down', () => this.emit('net', false));
    on('hello', () => {
      this.emit('net', true);
      if (this.room && this.room.code) WS.send({ t: 'rejoin', code: this.room.code });
    });
    WS.connect();
  }
  WsSession.prototype = Object.create(Emitter.prototype);
  WsSession.prototype.quick = function () {
    WS.send({ t: 'quick' });
  };
  WsSession.prototype.cancelQuick = function () {
    WS.send({ t: 'cancel' });
  };
  WsSession.prototype.create = function () {
    WS.send({ t: 'create' });
  };
  WsSession.prototype.join = function (code) {
    WS.send({ t: 'join', code: String(code || '').toUpperCase() });
  };
  WsSession.prototype.seat = function (seat) {
    WS.send({ t: 'seat', seat });
  };
  WsSession.prototype.setBot = function (seat, on) {
    WS.send({ t: 'bot', seat, on });
  };
  WsSession.prototype.begin = function () {
    WS.send({ t: 'start' });
  };
  WsSession.prototype.act = function (a) {
    WS.send({ t: 'act', a });
  };
  WsSession.prototype.next = function () {
    WS.send({ t: 'act', a: { t: 'next' } });
  };
  WsSession.prototype.chat = function (m) {
    WS.send({ t: 'chat', m });
  };
  WsSession.prototype.rematch = function () {
    WS.send({ t: 'rematch' });
  };
  WsSession.prototype.pause = function () {};
  WsSession.prototype.leave = function () {
    WS.send({ t: 'leave' });
    this._off.forEach(([t, fn]) => {
      const a = WS._h[t] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    });
    this._off = [];
  };

  /* ---------------- Claude room: crypto ---------------- */
  const b64 = (buf) => {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  };
  const unb64 = (s) => {
    const b = atob(s);
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  };
  const Crypto = {
    ok: !!(window.crypto && window.crypto.subtle),
    async pair() {
      if (!this.ok) return null;
      const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
      const pub = b64(await crypto.subtle.exportKey('raw', kp.publicKey));
      return { kp, pub };
    },
    async shared(pair, otherPub) {
      if (!this.ok || !pair || !otherPub) return null;
      const pk = await crypto.subtle.importKey('raw', unb64(otherPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      return crypto.subtle.deriveKey({ name: 'ECDH', public: pk }, pair.kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    },
    async enc(key, obj) {
      const txt = JSON.stringify(obj);
      if (!key) return 'p:' + btoa(unescape(encodeURIComponent(txt)));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(txt)));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv);
      out.set(ct, 12);
      return 'e:' + b64(out);
    },
    async dec(key, s) {
      if (!s) return null;
      if (s.slice(0, 2) === 'p:') return JSON.parse(decodeURIComponent(escape(atob(s.slice(2)))));
      if (!key) return null;
      const u = unb64(s.slice(2));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
      return JSON.parse(new TextDecoder().decode(pt));
    },
  };

  // compact public view for presence (4 KiB limit)
  function packView(v) {
    const p = Object.assign({}, v);
    delete p.hand;
    delete p.legal;
    delete p.me;
    delete p.tricks;
    p.lastTrick = v.tricks && v.tricks.length ? v.tricks[v.tricks.length - 1] : null;
    p.tricksWon = [0, 0];
    (v.tricks || []).forEach((t) => p.tricksWon[E.teamOf(t.winner)]++);
    p.events = (v.events || []).slice(-6).map((e) => {
      const o = Object.assign({}, e);
      if (o.list && o.t === 'projShow') o.list = o.list.map((x) => ({ s: x.s, k: x.k }));
      return o;
    });
    p.rounds = (v.rounds || []).slice(-10).map((r) => [r.n, r.type, r.trump || '', r.team, r.mult, r.gahwa ? 1 : 0, r.outcome, r.pts[0], r.pts[1]]);
    if (p.bidding) p.bidding = Object.assign({}, p.bidding, { log: p.bidding.log.slice(-8) });
    if (p.summary) {
      const s = p.summary;
      p.summary = { type: s.type, trump: s.trump, caller: s.caller, taker: s.taker, team: s.team, mult: s.mult, gahwa: s.gahwa, abnat: s.abnat, tricksWon: s.tricksWon, projPts: s.projPts, projList: s.projList, bal: s.bal, cardPts: s.cardPts, pts: s.pts, outcome: s.outcome, kaboot: s.kaboot, winTeam: s.winTeam, scores: s.scores };
    }
    return p;
  }
  function unpackView(p, priv, seat) {
    const v = Object.assign({}, p);
    v.rounds = (p.rounds || []).map((r) => ({ n: r[0], type: r[1], trump: r[2] || null, team: r[3], mult: r[4], gahwa: !!r[5], outcome: r[6], pts: [r[7], r[8]] }));
    v.me = seat;
    v.hand = priv && priv.h ? priv.h.match(/.{2}/g) || [] : [];
    v.legal = (priv && priv.l) || null;
    return v;
  }
  function packLegal(l) {
    if (!l) return null;
    return l;
  }

  /* ---------------- Claude room session ---------------- */
  function RoomSession(me) {
    Emitter.call(this);
    this.kind = 'online';
    this.me = me;
    this.mySeat = 0;
    this.isHost = false;
    this.code = null;
    this.gr = null; // named game room
    this.myPeer = null;
    this.pair = null;
    this.keys = {}; // peer -> AES key (host side) / host key (guest side)
    this.lastAct = {};
    this.lastNx = {};
    this.lastCh = {};
    this.actN = 0;
    this.nxN = 0;
    this.chN = 0;
    this.seats = [null, null, null, null]; // host: {peer, uid, name, av, lv, bot}
    this.host = null;
    this.hostPeer = null;
    this.status = 'idle';
    this.unsubs = [];
    this.pubTimer = null;
  }
  RoomSession.prototype = Object.create(Emitter.prototype);

  RoomSession.lobby = function (onTables) {
    // returns an unsubscribe; lists open tables hosted by others
    let off = () => {};
    CL.init().then(() => {
      if (!CL.room) return onTables(null);
      const me = Auth.user || {};
      CL.room.presence({ nick: String(me.nick || '').slice(0, 24), av: me.av || '🦅', tbl: null }).catch(() => {});
      off = CL.room.onPeers((ch) => {
        const list = ch.peers
          .filter((p) => !p.isMe && p.presence && p.presence.tbl && p.presence.tbl.st === 'wait' && p.presence.tbl.n < 4)
          .map((p) => ({ code: p.presence.tbl.code, n: p.presence.tbl.n, host: String(p.presence.nick || 'لاعب'), av: p.presence.av || '🦅' }));
        onTables(list);
      });
    });
    return () => off();
  };

  RoomSession.prototype._join = async function (code) {
    await CL.init();
    if (!CL.room) throw new Error('no_room');
    this.pair = await Crypto.pair();
    this.code = code;
    this.gr = await CL.room.join('t-' + code.toLowerCase());
    const me = this.me;
    await this.gr.presence({ nick: String(me.nick || '').slice(0, 24), av: me.av || '🦅', lv: levelOf((me.stats || {}).xp).lv, uid: me.id || deviceId, pk: this.pair ? this.pair.pub : null, act: null, nx: 0, ch: null });
    this.unsubs.push(this.gr.onPeers((c) => this._peers(c)));
  };

  RoomSession.prototype.create = async function () {
    try {
      this.isHost = true;
      const code = rid(4);
      await this._join(code);
      this.seats[0] = { peer: null, uid: this.me.id || deviceId, name: this.me.nick, av: this.me.av, lv: levelOf((this.me.stats || {}).xp).lv };
      this.status = 'wait';
      this._roomChanged();
    } catch (e) {
      this.emit('error', 'ما قدرنا نفتح الغرفة');
    }
  };
  RoomSession.prototype.join = async function (code) {
    try {
      this.isHost = false;
      await this._join(String(code).toUpperCase());
      this.status = 'joining';
      setTimeout(() => {
        if (this.status === 'joining' && !this.hostPeer) this.emit('error', 'ما لقينا غرفة بهذا الكود');
      }, 9000);
    } catch (e) {
      this.emit('error', 'ما قدرنا ندخل الغرفة');
    }
  };

  RoomSession.prototype._peers = function (c) {
    const mine = c.peers.find((p) => p.sameTab);
    if (mine) this.myPeer = mine.peer;
    this._q = (this._q || Promise.resolve())
      .then(() => (this.isHost ? this._hostPeers(c) : this._guestPeers(c)))
      .catch((e) => console.warn('room update failed', e));
  };

  /* ---- host side ---- */
  RoomSession.prototype._hostPeers = async function (c) {
    const others = c.peers.filter((p) => !p.sameTab && p.kind === 'viewer');
    let changed = false;
    // seat newcomers / returning players
    for (const p of others) {
      const pr = p.presence || {};
      if (!pr.nick) continue;
      let seat = this.seats.findIndex((s) => s && !s.bot && s.peer === p.peer);
      if (seat < 0) {
        const uid = p.by || pr.uid;
        seat = this.seats.findIndex((s) => s && !s.bot && s.uid === uid && s.gone);
        if (seat >= 0) {
          Object.assign(this.seats[seat], { peer: p.peer, gone: false });
          if (this.host) this.host.setSeat(seat, { away: false, disconnected: false });
          changed = true;
        } else if (this.status === 'wait') {
          const free = [2, 1, 3].find((i) => !this.seats[i]);
          if (free != null) {
            this.seats[free] = { peer: p.peer, uid: p.by || pr.uid, name: String(pr.nick).slice(0, 24), av: String(pr.av || '🦅').slice(0, 8), lv: +pr.lv || 1 };
            seat = free;
            changed = true;
          }
        }
      }
      if (seat >= 0 && pr.pk && !this.keys[p.peer]) {
        try {
          this.keys[p.peer] = (await Crypto.shared(this.pair, pr.pk)) || null;
        } catch (e) {
          this.keys[p.peer] = null;
        }
        changed = true;
      }
      if (seat >= 0 && this.host) {
        const a = pr.act;
        if (a && typeof a.n === 'number' && a.n > (this.lastAct[p.peer] || 0)) {
          this.lastAct[p.peer] = a.n;
          if (a.a && typeof a.a === 'object') this.host.act(seat, a.a);
        }
        if (typeof pr.nx === 'number' && pr.nx > (this.lastNx[p.peer] || 0)) {
          this.lastNx[p.peer] = pr.nx;
          this.host.act(seat, { t: 'next' });
        }
      }
      if (seat >= 0 && pr.ch && typeof pr.ch.n === 'number' && pr.ch.n > (this.lastCh[p.peer] || 0)) {
        this.lastCh[p.peer] = pr.ch.n;
        this.emit('chat', { s: seat, m: String(pr.ch.m || '').slice(0, 40) });
      }
    }
    // players who left
    for (let i = 1; i < 4; i++) {
      const s = this.seats[i];
      if (!s || s.bot || s.gone) continue;
      if (!others.some((p) => p.peer === s.peer)) {
        if (this.status === 'wait') this.seats[i] = null;
        else {
          s.gone = true;
          if (this.host) this.host.setSeat(i, { away: true, disconnected: true });
        }
        changed = true;
      }
    }
    if (changed) this._roomChanged();
  };

  RoomSession.prototype._tableInfo = function () {
    return {
      code: this.code,
      st: this.status,
      seats: this.seats.map((s) => (s ? { p: s.peer || '', n: s.name, a: s.av, l: s.lv || 1, b: s.bot ? 1 : 0, g: s.gone ? 1 : 0 } : null)),
    };
  };

  RoomSession.prototype._roomChanged = function () {
    const info = this._tableInfo();
    this._emitRoom(info, 0);
    if (CL.room) {
      const n = this.seats.filter((s) => s && !s.bot).length;
      CL.room.presence({ tbl: this.status === 'wait' ? { code: this.code, n, st: 'wait' } : { code: this.code, n, st: 'play' } }).catch(() => {});
    }
    this._publish();
  };

  RoomSession.prototype._emitRoom = function (info, mySeat) {
    this.mySeat = mySeat;
    const room = {
      code: info.code,
      status: info.st,
      host: this.isHost,
      you: mySeat,
      seats: info.seats.map((s) => (s ? { name: s.n, av: s.a, lv: s.l, bot: !!s.b, away: !!s.g } : null)),
    };
    this.emit('room', room);
    this.emit(
      'players',
      room.seats.map((p, i) => (p ? { name: p.name, av: p.av, lv: p.lv, bot: p.bot, me: i === mySeat, away: p.away } : { name: '…', av: '❔', empty: true }))
    );
  };

  RoomSession.prototype.setBot = function (seat, on) {
    if (!this.isHost || this.status !== 'wait' || seat === 0) return;
    if (on && !this.seats[seat]) this.seats[seat] = { bot: true, name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], av: AVATARS[3 + seat], lv: botLv('medium') };
    else if (!on && this.seats[seat] && this.seats[seat].bot) this.seats[seat] = null;
    this._roomChanged();
  };

  RoomSession.prototype.begin = function () {
    if (!this.isHost) return;
    for (let i = 1; i < 4; i++) if (!this.seats[i]) this.seats[i] = { bot: true, name: BOT_NAMES[(i * 5) % BOT_NAMES.length], av: AVATARS[3 + i], lv: botLv('medium') };
    this.status = 'play';
    this.host = new GameHost({
      seats: this.seats.map((s, i) => (i === 0 || (s && !s.bot) ? { kind: 'human' } : { kind: 'bot', level: 'medium' })),
      timing: { roundPause: 9000, turnBid: 20000, turnPlay: 25000 },
      onView: (s, v) => {
        if (s === 0) this.emit('view', normalizeView(v));
      },
      onChange: () => this._publishSoon(),
    });
    this._roomChanged();
    this.host.start();
  };

  RoomSession.prototype._publishSoon = function () {
    if (this.pubTimer) return;
    this.pubTimer = setTimeout(() => {
      this.pubTimer = null;
      this._publish();
    }, 40);
  };

  RoomSession.prototype._publish = async function () {
    if (!this.isHost || !this.gr) return;
    const patch = { host: 1, tbl: this._tableInfo() };
    if (this.host && this.host.st) {
      const pub = packView(this.host.view(-1));
      const hs = [];
      for (let i = 0; i < 4; i++) {
        const s = this.seats[i];
        if (i === 0 || !s || s.bot || !s.peer) {
          hs.push(null);
          continue;
        }
        const v = this.host.view(i);
        hs.push(await Crypto.enc(this.keys[s.peer] || null, { h: v.hand.join(''), l: packLegal(v.legal) }));
      }
      patch.g = pub;
      patch.hs = hs;
    }
    try {
      await this.gr.presence(patch);
    } catch (e) {
      // too large: drop history and retry once
      if (patch.g) {
        patch.g.rounds = patch.g.rounds.slice(-3);
        patch.g.events = patch.g.events.slice(-3);
        try {
          await this.gr.presence(patch);
        } catch (e2) {
          console.warn('presence publish failed', e2);
        }
      }
    }
  };

  /* ---- guest side ---- */
  RoomSession.prototype._guestPeers = async function (c) {
    const hostP = c.peers.find((p) => p.presence && p.presence.host === 1 && !p.sameTab);
    if (!hostP) {
      if (this.hostPeer) {
        this.hostPeer = null;
        this.emit('closed', 'host_left');
      }
      return;
    }
    this.hostPeer = hostP.peer;
    const pr = hostP.presence;
    const tbl = pr.tbl;
    if (!tbl) return;
    const mySeat = tbl.seats.findIndex((s) => s && s.p === this.myPeer);
    if (mySeat < 0) {
      if (tbl.st !== 'wait') this.emit('error', 'اللعبة بدأت بدون مكان لك');
      else if (tbl.seats.every((s) => s)) this.emit('error', 'الغرفة مليانة');
      return;
    }
    this.status = tbl.st;
    if (this._lastTbl !== JSON.stringify(tbl)) {
      this._lastTbl = JSON.stringify(tbl);
      this._emitRoom(tbl, mySeat);
    }
    // chat from others (including the host)
    for (const p of c.peers) {
      if (p.sameTab || !p.presence || !p.presence.ch) continue;
      const ch = p.presence.ch;
      if (typeof ch.n === 'number' && ch.n > (this.lastCh[p.peer] || 0)) {
        this.lastCh[p.peer] = ch.n;
        const s = tbl.seats.findIndex((x) => x && x.p === (p.presence.host ? '' : p.peer));
        const seat = p.presence.host ? 0 : s;
        if (seat >= 0) this.emit('chat', { s: seat, m: String(ch.m || '').slice(0, 40) });
      }
    }
    if (!pr.g) return;
    if (pr.g === this._lastG && pr.hs === this._lastHs) return;
    this._lastG = pr.g;
    this._lastHs = pr.hs;
    if (!this.keys.host && pr.pk && this.pair) {
      try {
        this.keys.host = await Crypto.shared(this.pair, pr.pk);
      } catch (e) {
        this.keys.host = null;
      }
    }
    let priv = null;
    try {
      priv = await Crypto.dec(this.keys.host, pr.hs && pr.hs[mySeat]);
    } catch (e) {
      priv = null;
    }
    this.emit('view', unpackView(pr.g, priv, mySeat));
  };

  RoomSession.prototype.act = function (a) {
    if (this.isHost) {
      const r = this.host && this.host.act(0, a);
      if (r && !r.ok) this.emit('error', r.err);
      return;
    }
    this.actN += 1;
    this.gr && this.gr.presence({ act: { n: this.actN, a } }).catch(() => {});
  };
  RoomSession.prototype.next = function () {
    if (this.isHost) return this.host && this.host.act(0, { t: 'next' });
    this.nxN += 1;
    this.gr && this.gr.presence({ nx: this.nxN }).catch(() => {});
  };
  RoomSession.prototype.chat = function (m) {
    this.chN += 1;
    this.emit('chat', { s: this.mySeat, m });
    this.gr && this.gr.presence({ ch: { n: this.chN, m } }).catch(() => {});
  };
  RoomSession.prototype.rematch = function () {
    if (this.isHost && this.host) this.host.rematch();
  };
  RoomSession.prototype.pause = function () {};
  RoomSession.prototype.leave = function () {
    this.unsubs.forEach((f) => {
      try {
        f();
      } catch (e) {
        /* ignore */
      }
    });
    this.unsubs = [];
    if (this.host) this.host.destroy();
    if (this.gr) this.gr.leave().catch(() => {});
    if (CL.room) CL.room.presence({ tbl: null }).catch(() => {});
  };

  window.BalootNet = { store, Auth, Runtime, CL, LocalSession, WsSession, RoomSession, WS, AVATARS, AV_BG, BOT_NAMES, levelOf, blankStats, rid, packView, unpackView, Crypto, withTimeout };
})();
