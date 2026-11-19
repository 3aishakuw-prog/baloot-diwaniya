// Users, sessions and stats.
// Accounts are kept in a JSON file (set DATA_DIR to a persistent disk when you have one), and every
// session token also carries an encrypted copy of its account. On hosts that wipe their files
// (Render's free plan after it sleeps) a returning player's account is rebuilt from that copy.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_TTL = 365 * 24 * 3600 * 1000;

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.db = { users: {}, byName: {}, deleted: {} };
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.db = Object.assign(this.db, d);
      delete this.db.tokens;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('db load failed, starting empty:', e.message);
    }
    this.key = crypto.createHash('sha256').update(this._secret() + ':baloot-token').digest();
    this._t = null;
  }
  _secret() {
    if (process.env.TOKEN_SECRET && process.env.TOKEN_SECRET.length >= 16) return process.env.TOKEN_SECRET;
    const f = path.join(this.dir, 'secret.key');
    try {
      return fs.readFileSync(f, 'utf8').trim();
    } catch (e) {
      const s = crypto.randomBytes(32).toString('hex');
      try {
        fs.writeFileSync(f, s);
      } catch (e2) {
        /* ignore */
      }
      console.warn('TOKEN_SECRET is not set: generated one in', f, '(sessions reset if this file is lost)');
      return s;
    }
  }
  save() {
    if (this._t) return;
    this._t = setTimeout(() => {
      this._t = null;
      this.flush();
    }, 400);
  }
  flush() {
    const tmp = this.file + '.tmp';
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('db save failed:', e.message);
    }
  }
  static hash(password, salt) {
    return crypto.scryptSync(String(password), salt, 32).toString('hex');
  }
  blankStats() {
    return { games: 0, wins: 0, losses: 0, xp: 0, kaboot: 0, online: 0 };
  }
  createUser({ username, password, nick, av, guest }) {
    const id = 'u' + crypto.randomBytes(8).toString('hex');
    const u = { id, username: username || null, nick, av, guest: !!guest, created: Date.now(), rev: 1, stats: this.blankStats() };
    if (!guest) {
      u.salt = crypto.randomBytes(12).toString('hex');
      u.hash = Store.hash(password, u.salt);
      this.db.byName[username.toLowerCase()] = id;
    }
    this.db.users[id] = u;
    this.save();
    return u;
  }
  byUsername(username) {
    const id = this.db.byName[String(username || '').toLowerCase()];
    return id ? this.db.users[id] : null;
  }
  checkPassword(u, password) {
    if (!u || !u.hash) return false;
    const a = Buffer.from(Store.hash(password, u.salt), 'hex');
    const b = Buffer.from(u.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // token = AES-256-GCM(account copy). Unforgeable without the server secret, unreadable by others.
  newToken(u) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(JSON.stringify({ u, t: Date.now() }), 'utf8'), c.final()]);
    return 'b1.' + Buffer.concat([iv, body, c.getAuthTag()]).toString('base64url');
  }
  _open(token) {
    if (typeof token !== 'string' || token.slice(0, 3) !== 'b1.' || token.length > 6000) return null;
    try {
      const raw = Buffer.from(token.slice(3), 'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(raw.length - 16));
      const txt = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8');
      const p = JSON.parse(txt);
      if (!p || !p.u || !p.u.id || Date.now() - p.t > TOKEN_TTL) return null;
      return p.u;
    } catch (e) {
      return null;
    }
  }
  userByToken(token) {
    const copy = this._open(token);
    if (!copy) return null;
    if (this.db.deleted[copy.id]) return null;
    const cur = this.db.users[copy.id];
    if (cur && (cur.rev || 0) >= (copy.rev || 0)) return cur;
    // rebuild the account from the copy the player carries
    const u = Object.assign({}, copy, { stats: Object.assign(this.blankStats(), copy.stats) });
    if (u.username) {
      const owner = this.db.byName[u.username.toLowerCase()];
      if (!owner || owner === u.id) this.db.byName[u.username.toLowerCase()] = u.id;
    }
    this.db.users[u.id] = u;
    this.save();
    return u;
  }
  get(id) {
    return this.db.users[id] || null;
  }
  update(u) {
    u.rev = (u.rev || 0) + 1;
    this.db.users[u.id] = u;
    this.save();
  }
  deleteUser(u) {
    delete this.db.users[u.id];
    if (u.username && this.db.byName[u.username.toLowerCase()] === u.id) delete this.db.byName[u.username.toLowerCase()];
    this.db.deleted[u.id] = Date.now();
    this.save();
  }
  publicUser(u) {
    return { id: u.id, username: u.username, nick: u.nick, av: u.av, guest: u.guest, stats: Object.assign(this.blankStats(), u.stats) };
  }
  leaderboard(n) {
    return Object.values(this.db.users)
      .filter((u) => u.stats && u.stats.games > 0)
      .sort((a, b) => b.stats.wins - a.stats.wins || b.stats.xp - a.stats.xp)
      .slice(0, n || 50)
      .map((u) => ({ nick: u.nick, av: u.av, wins: u.stats.wins, games: u.stats.games, xp: u.stats.xp }));
  }
}
module.exports = Store;
