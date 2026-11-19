// Baloot online server: static app + accounts API + WebSocket rooms/matchmaking.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Store = require('./store');
const E = require('../shared/engine.js');
const { GameHost } = require('../shared/host.js');

const PORT = +process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const QUICK_WAIT = +process.env.QUICK_WAIT_MS || 15000;
const SCALE = +process.env.TIMING_SCALE || 1; // tests only
const store = new Store(DATA_DIR);

const AVATARS = ['🦅', '🐪', '🌴', '☕', '🫖', '🐎', '🦁', '🐆', '🌙', '⛵', '🌹', '🔥', '💎', '🦌', '🏜️', '⭐', '🐺', '🦉'];
const BOT_NAMES = ['بو ناصر', 'مشعل', 'سعود', 'بدر', 'فهد', 'بو خالد', 'حمد', 'نايف', 'مبارك', 'تركي', 'سلطان', 'بو فيصل', 'ضاري', 'جاسم'];
const CHAT = new Set(['السلام عليكم', 'كفو!', 'يا حلو', 'شد حيلك', 'صح لسانك', 'تكفى ركز', 'الله يعين', 'يا ساتر', 'مشينا', 'هههه', 'زين', 'العب بسرعة', '👍', '😂', '😮', '🔥', '👏', '☕', '😅', '🤝', '😎']);

const cleanNick = (s) =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .trim()
    .slice(0, 16);
const cleanAv = (a) => (AVATARS.indexOf(a) >= 0 ? a : AVATARS[0]);
const levelOf = (xp) => Math.floor(Math.sqrt((xp || 0) / 60)) + 1;

/* ---------------- rate limiting ---------------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now - h.t > windowMs) {
    h = { t: now, n: 0 };
    hits.set(key, h);
  }
  h.n += 1;
  return h.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (now - h.t > 120000) hits.delete(k);
}, 60000).unref();

/* ---------------- HTTP ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16384) {
        reject(new Error('too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('bad_json'));
      }
    });
    req.on('error', reject);
  });
}
function bearer(req) {
  const m = /^Bearer\s+(\S{20,6000})$/.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}
function authUser(req) {
  const t = bearer(req);
  return t ? store.userByToken(t) : null;
}
const session = (u) => ({ token: store.newToken(u), user: store.publicUser(u) });
const ip = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

function xpFor(r) {
  let x = r.win ? 40 : 12;
  if (r.mode === 'offline') x = Math.round(x * ({ easy: 0.5, medium: 1, hard: 1.5 }[r.level] || 1));
  else x = Math.round(x * 1.5);
  return x + Math.min(8, r.kaboots || 0) * 5;
}
function recordResult(u, r) {
  const s = Object.assign(store.blankStats(), u.stats);
  s.games += 1;
  if (r.win) s.wins += 1;
  else s.losses += 1;
  s.kaboot += Math.min(8, r.kaboots || 0);
  if (r.mode === 'online') s.online += 1;
  s.xp += xpFor(r);
  u.stats = s;
  store.update(u);
}

async function api(req, res, p) {
  try {
    if (p === '/api/ping') return send(res, 200, { ok: true });
    if (p === '/api/leaderboard') return send(res, 200, { list: store.leaderboard(50) });
    if (req.method === 'GET' && p === '/api/me') {
      const u = authUser(req);
      return u ? send(res, 200, session(u)) : send(res, 401, { error: 'auth' });
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'not_found' });
    const body = await readBody(req);
    if (p === '/api/register') {
      if (limited('reg:' + ip(req), 10, 60000)) return send(res, 429, { error: 'slow_down' });
      const username = String(body.username || '').trim();
      if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) return send(res, 400, { error: 'bad_username' });
      if (String(body.password || '').length < 6 || String(body.password).length > 100) return send(res, 400, { error: 'bad_password' });
      if (store.byUsername(username)) return send(res, 409, { error: 'taken' });
      const u = store.createUser({ username, password: body.password, nick: cleanNick(body.nick) || username, av: cleanAv(body.av) });
      return send(res, 200, session(u));
    }
    if (p === '/api/login') {
      if (limited('login:' + ip(req), 20, 60000)) return send(res, 429, { error: 'slow_down' });
      const u = store.byUsername(body.username);
      if (!u || !store.checkPassword(u, body.password)) return send(res, 401, { error: 'bad_login' });
      return send(res, 200, session(u));
    }
    if (p === '/api/guest') {
      if (limited('guest:' + ip(req), 15, 60000)) return send(res, 429, { error: 'slow_down' });
      const nick = cleanNick(body.nick);
      if (nick.length < 2) return send(res, 400, { error: 'bad_nick' });
      const u = store.createUser({ nick, av: cleanAv(body.av), guest: true });
      // carry over progress made offline before the first connection
      if (body.stats && typeof body.stats === 'object') {
        const n = (v, max) => Math.max(0, Math.min(max, Math.floor(+v || 0)));
        const st = body.stats;
        u.stats = { games: n(st.games, 5000), wins: n(st.wins, 5000), losses: n(st.losses, 5000), xp: n(st.xp, 200000), kaboot: n(st.kaboot, 20000), online: 0 };
        if (u.stats.wins + u.stats.losses > u.stats.games) u.stats.games = u.stats.wins + u.stats.losses;
        store.update(u);
      }
      return send(res, 200, session(u));
    }
    if (p === '/api/account/delete-web') {
      // web page for account deletion (Google Play requirement): username + password
      if (limited('del:' + ip(req), 10, 600000)) return send(res, 429, { error: 'slow_down' });
      const u = store.byUsername(body.username);
      if (!u || !store.checkPassword(u, body.password)) return send(res, 401, { error: 'bad_login' });
      removeUser(u);
      return send(res, 200, { ok: true });
    }
    const u = authUser(req);
    if (!u) return send(res, 401, { error: 'auth' });
    if (p === '/api/account/delete') {
      if (u.hash && !store.checkPassword(u, body.password)) return send(res, 401, { error: 'bad_password' });
      removeUser(u);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/profile') {
      const nick = cleanNick(body.nick);
      if (nick.length >= 2) u.nick = nick;
      u.av = cleanAv(body.av);
      store.update(u);
      return send(res, 200, session(u));
    }
    if (p === '/api/result') {
      if (limited('res:' + u.id, 30, 3600000)) return send(res, 429, { error: 'slow_down' });
      recordResult(u, { win: !!body.win, kaboots: +body.kaboots || 0, mode: 'offline', level: ['easy', 'medium', 'hard'].indexOf(body.level) >= 0 ? body.level : 'medium' });
      return send(res, 200, session(u));
    }
    if (p === '/api/logout') return send(res, 200, { ok: true });
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    return send(res, 400, { error: e.message || 'error' });
  }
}

function serveStatic(req, res, p) {
  let file;
  if (p.startsWith('/shared/')) file = path.join(SHARED, path.normalize(p.slice(8)).replace(/^(\.\.[/\\])+/, ''));
  else if (p === '/.well-known/assetlinks.json' && process.env.ASSETLINKS_JSON) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(process.env.ASSETLINKS_JSON);
  } else file = path.join(PUBLIC, path.normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) && !file.startsWith(SHARED)) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // single page app: unknown paths get the app
      if (!path.extname(p)) file = path.join(PUBLIC, 'index.html');
      else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
    }
    const ext = path.extname(file);
    const noCache = ext === '.html' || p === '/sw.js' || ext === '.webmanifest';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.startsWith('/api/')) return api(req, res, p);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, p);
});

/* ---------------- rooms ---------------- */
const rooms = new Map(); // code -> room
const conns = new Map(); // uid -> ws
const userRoom = new Map(); // uid -> code
let queue = []; // [{uid, at}]

function newCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += a[Math.floor(Math.random() * a.length)];
    if (!rooms.has(c)) return c;
  }
}
function userInfo(uid) {
  const u = store.get(uid);
  return { uid, name: u ? u.nick : 'لاعب', av: u ? u.av : AVATARS[0], lv: levelOf(u && u.stats && u.stats.xp) };
}
function botInfo(i) {
  return { bot: true, name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], av: AVATARS[(3 + i * 4) % AVATARS.length], lv: 6 + Math.floor(Math.random() * 10) };
}
function wsSend(ws, m) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}
function roomFor(room, uid) {
  const you = room.seats.findIndex((s) => s && s.uid === uid);
  return {
    code: room.code,
    status: room.status,
    quick: room.quick,
    host: room.hostUid === uid,
    you,
    seats: room.seats.map((s) => (s ? { name: s.name, av: s.av, lv: s.lv, bot: !!s.bot, away: !!s.away } : null)),
  };
}
function broadcastRoom(room) {
  for (const s of room.seats) if (s && !s.bot && !s.left) wsSend(conns.get(s.uid), { t: 'room', room: roomFor(room, s.uid) });
}
function createRoom(hostUid, quick) {
  const room = { code: newCode(), hostUid, quick: !!quick, status: 'wait', seats: [null, null, null, null], host: null, created: Date.now(), touched: Date.now(), recorded: 0 };
  rooms.set(room.code, room);
  return room;
}
function seatUser(room, uid, prefer) {
  const order = prefer != null ? [prefer] : [0, 2, 1, 3];
  for (const i of order) {
    if (!room.seats[i]) {
      room.seats[i] = Object.assign(userInfo(uid), { away: false });
      userRoom.set(uid, room.code);
      return i;
    }
  }
  return -1;
}
function leaveRoom(uid, explicit) {
  const code = userRoom.get(uid);
  if (!code) return;
  const room = rooms.get(code);
  userRoom.delete(uid);
  if (!room) return;
  const i = room.seats.findIndex((s) => s && s.uid === uid);
  if (i < 0) return;
  if (room.status === 'wait') {
    room.seats[i] = null;
    if (room.hostUid === uid) {
      const next = room.seats.find((s) => s && !s.bot);
      if (next) room.hostUid = next.uid;
      else return closeRoom(room);
    }
  } else {
    room.seats[i].away = true;
    if (explicit) room.seats[i].left = true;
    if (room.host) room.host.setSeat(i, { away: true, disconnected: true });
    if (room.seats.every((s) => !s || s.bot || s.left)) return closeRoom(room);
  }
  broadcastRoom(room);
}
function removeUser(u) {
  queue = queue.filter((q) => q.uid !== u.id);
  leaveRoom(u.id, true);
  const ws = conns.get(u.id);
  if (ws) {
    ws.uid = null;
    conns.delete(u.id);
    try {
      ws.close();
    } catch (e) {
      /* ignore */
    }
  }
  store.deleteUser(u);
}
function closeRoom(room) {
  if (room.host) room.host.destroy();
  for (const s of room.seats) if (s && !s.bot && userRoom.get(s.uid) === room.code) userRoom.delete(s.uid);
  rooms.delete(room.code);
}
function startRoom(room) {
  for (let i = 0; i < 4; i++) if (!room.seats[i]) room.seats[i] = botInfo(i);
  room.status = 'play';
  room.touched = Date.now();
  room.host = new GameHost({
    seats: room.seats.map((s) => (s.bot ? { kind: 'bot', level: 'medium' } : { kind: 'human' })),
    timing: { roundPause: 9000 * SCALE, turnBid: 15000, turnPlay: 20000, botBid: 850 * SCALE, botPlay: 650 * SCALE, botJitter: 450 * SCALE, trickPause: 1150 * SCALE },
    onView: (seat, v) => {
      const s = room.seats[seat];
      if (s && !s.bot && !s.left) wsSend(conns.get(s.uid), { t: 'view', v });
    },
    onChange: () => {
      room.touched = Date.now();
    },
    onGameEnd: (st) => recordGame(room, st),
  });
  room.seats.forEach((s, i) => {
    if (s && !s.bot && (s.away || !conns.get(s.uid))) room.host.setSeat(i, { away: true, disconnected: true });
  });
  broadcastRoom(room);
  room.host.start();
}
function recordGame(room, st) {
  const key = room.host.gameNo;
  if (room.recorded === key) return;
  room.recorded = key;
  room.seats.forEach((s, i) => {
    if (!s || s.bot) return;
    const u = store.get(s.uid);
    if (!u) return;
    const team = i % 2;
    const kaboots = st.rounds.filter((r) => r.outcome === 'kaboot' && r.team === team).length;
    recordResult(u, { win: st.winner === team, kaboots, mode: 'online' });
    wsSend(conns.get(s.uid), Object.assign({ t: 'token' }, session(u)));
  });
}

/* quick match: group waiting players; fill with bots after QUICK_WAIT */
function matchmake() {
  queue = queue.filter((q) => conns.get(q.uid) && !userRoom.get(q.uid));
  while (queue.length >= 4 || (queue.length && Date.now() - queue[0].at > QUICK_WAIT)) {
    const group = queue.splice(0, 4);
    const room = createRoom(group[0].uid, true);
    // random seats so friends queuing together are not always partners
    const seats = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    group.forEach((q, i) => seatUser(room, q.uid, seats[i]));
    startRoom(room);
  }
  for (const q of queue) wsSend(conns.get(q.uid), { t: 'queue', n: queue.length, wait: Math.max(0, Math.ceil((QUICK_WAIT - (Date.now() - queue[0].at)) / 1000)) });
}
setInterval(matchmake, 1000).unref();
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const humansOn = room.seats.some((s) => s && !s.bot && !s.left && conns.get(s.uid));
    if (!humansOn && now - room.touched > 120000) closeRoom(room);
    else if (room.status === 'wait' && now - room.created > 3 * 3600000) closeRoom(room);
  }
}, 30000).unref();

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.uid = null;
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', (data) => {
    if (limited('ws:' + (ws.uid || 'anon') + ':' + (ws._id || (ws._id = Math.random())), 40, 5000)) return;
    let m;
    try {
      m = JSON.parse(String(data));
    } catch (e) {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    try {
      onMessage(ws, m);
    } catch (e) {
      console.error('ws message error', e);
    }
  });
  ws.on('close', () => {
    if (!ws.uid) return;
    if (conns.get(ws.uid) === ws) {
      conns.delete(ws.uid);
      queue = queue.filter((q) => q.uid !== ws.uid);
      const code = userRoom.get(ws.uid);
      const room = code && rooms.get(code);
      if (room) {
        const i = room.seats.findIndex((s) => s && s.uid === ws.uid);
        if (room.status === 'wait') leaveRoom(ws.uid, false);
        else if (i >= 0) {
          room.seats[i].away = true;
          if (room.host) room.host.setSeat(i, { away: true, disconnected: true });
          broadcastRoom(room);
        }
      }
    }
  });
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    try {
      ws.ping();
    } catch (e) {
      /* ignore */
    }
  }
}, 25000).unref();

function onMessage(ws, m) {
  if (m.t === 'auth') {
    const u = store.userByToken(m.token);
    if (!u) return wsSend(ws, { t: 'err', m: 'سجل دخول من جديد' });
    const old = conns.get(u.id);
    if (old && old !== ws) {
      old.uid = null;
      old.close();
    }
    ws.uid = u.id;
    conns.set(u.id, ws);
    wsSend(ws, Object.assign({ t: 'hello' }, session(u)));
    resume(ws);
    return;
  }
  if (!ws.uid) return;
  const uid = ws.uid;
  const code = userRoom.get(uid);
  const room = code && rooms.get(code);
  const seat = room ? room.seats.findIndex((s) => s && s.uid === uid) : -1;
  switch (m.t) {
    case 'quick':
      if (room) return resume(ws);
      if (!queue.some((q) => q.uid === uid)) queue.push({ uid, at: Date.now() });
      matchmake();
      return;
    case 'cancel':
      queue = queue.filter((q) => q.uid !== uid);
      return;
    case 'create': {
      if (room) leaveRoom(uid, true);
      const r = createRoom(uid, false);
      seatUser(r, uid, 0);
      broadcastRoom(r);
      return;
    }
    case 'join': {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return wsSend(ws, { t: 'err', m: 'ما لقينا غرفة بهذا الكود' });
      if (room && room !== r) leaveRoom(uid, true);
      if (r.seats.some((s) => s && s.uid === uid)) return resume(ws);
      if (r.status !== 'wait') return wsSend(ws, { t: 'err', m: 'اللعبة بدأت في هالغرفة' });
      if (seatUser(r, uid) < 0) return wsSend(ws, { t: 'err', m: 'الغرفة مليانة' });
      broadcastRoom(r);
      return;
    }
    case 'rejoin':
      return resume(ws);
    case 'seat':
      if (!room || room.status !== 'wait' || seat < 0) return;
      if (m.seat >= 0 && m.seat < 4 && !room.seats[m.seat]) {
        room.seats[m.seat] = room.seats[seat];
        room.seats[seat] = null;
        broadcastRoom(room);
      }
      return;
    case 'bot':
      if (!room || room.status !== 'wait' || room.hostUid !== uid) return;
      if (!(m.seat >= 0 && m.seat < 4)) return;
      if (m.on && !room.seats[m.seat]) room.seats[m.seat] = botInfo(m.seat);
      else if (!m.on && room.seats[m.seat] && room.seats[m.seat].bot) room.seats[m.seat] = null;
      broadcastRoom(room);
      return;
    case 'start':
      if (!room || room.status !== 'wait' || room.hostUid !== uid) return;
      startRoom(room);
      return;
    case 'act':
      if (!room || !room.host || seat < 0) return;
      if (room.seats[seat].away && !room.seats[seat].left) {
        room.seats[seat].away = false;
        room.host.setSeat(seat, { away: false, disconnected: false });
        broadcastRoom(room);
      }
      {
        const r = room.host.act(seat, m.a);
        if (!r.ok && r.err !== 'not_round_end') wsSend(ws, { t: 'err', m: r.err });
      }
      return;
    case 'chat':
      if (!room || seat < 0 || !CHAT.has(m.m)) return;
      if (limited('chat:' + uid, 6, 10000)) return;
      for (const s of room.seats) if (s && !s.bot) wsSend(conns.get(s.uid), { t: 'chat', s: seat, m: m.m });
      return;
    case 'rematch':
      if (!room || !room.host || room.host.st.phase !== 'gameEnd') return;
      if (room.hostUid !== uid && !room.quick) return;
      room.host.rematch();
      return;
    case 'leave':
      queue = queue.filter((q) => q.uid !== uid);
      leaveRoom(uid, true);
      wsSend(ws, { t: 'left' });
      return;
    default:
      return;
  }
}

function resume(ws) {
  const code = userRoom.get(ws.uid);
  const room = code && rooms.get(code);
  if (!room) return;
  const i = room.seats.findIndex((s) => s && s.uid === ws.uid);
  if (i < 0) return;
  if (room.seats[i].away && !room.seats[i].left) {
    room.seats[i].away = false;
    if (room.host) room.host.setSeat(i, { away: false, disconnected: false });
  }
  broadcastRoom(room);
  if (room.host && room.host.st) wsSend(ws, { t: 'view', v: room.host.view(i) });
}

server.listen(PORT, () => console.log('Baloot server on http://localhost:' + PORT + '  data: ' + DATA_DIR));
process.on('SIGTERM', () => {
  store.flush();
  process.exit(0);
});
process.on('SIGINT', () => {
  store.flush();
  process.exit(0);
});
module.exports = server;
