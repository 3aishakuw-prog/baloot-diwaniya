/* The game screen: Sadu rug, seats, animated cards, bidding/doubling/projects panels, summaries. */
(function () {
  'use strict';
  const E = window.BalootEngine;
  const A = window.BalootArt;
  const S = window.BalootSound;
  const U = window.BalootUI;
  const { h, $, L } = U;

  const G = {
    session: null,
    ctx: null,
    view: null,
    prev: null,
    players: [],
    mySeat: 0,
    lastQ: 0,
    sel: null,
    projSel: null,
    cardEls: new Map(),
    geo: null,
    seatEls: [],
    dealFrom: null,
    summaryShown: 0,
    endShown: 0,
    sumModal: null,
    lastTurnMine: false,
    open: false,
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rel = (seat) => (seat - G.mySeat + 4) % 4;
  const seatName = (s) => (G.players[s] && G.players[s].name) || '…';
  const myTeam = () => E.teamOf(G.mySeat);
  const hash = (str) => {
    let x = 0;
    for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) | 0;
    return x;
  };

  /* ---------------- geometry ---------------- */
  function computeGeo() {
    const t = $('#table');
    const W = t.clientWidth;
    const Ht = t.clientHeight;
    const hw = clamp(Math.min(W / 5.25, Ht / 6.4), 50, 104);
    const hh = hw * 1.4;
    const tw = clamp(Math.min(W / 5.4, Ht / 7), 46, 96);
    const th = tw * 1.4;
    const bw = clamp(Math.min(W / 12, Ht / 15), 24, 44);
    const handY = Ht - hh / 2 - 44;
    const cx = W / 2;
    const cy = clamp(Ht * 0.42, th * 0.95 + 70, handY - hh * 0.62 - th * 0.75);
    const sideY = clamp(Ht * 0.36, 120, cy);
    G.geo = { W, H: Ht, hw, hh, tw, th, bw, handY, cx, cy, sideY };
    document.documentElement.style.setProperty('--hand-h', Math.round(hh + 6) + 'px');
    t.style.setProperty('--cy', Math.round(cy) + 'px');
    placeSeats();
  }
  // centre of each relative seat (avatar centre)
  function seatCenter(r) {
    const g = G.geo;
    if (r === 0) return { x: g.cx, y: g.H - 16 };
    if (r === 1) return { x: g.W - 46, y: g.sideY };
    if (r === 2) return { x: g.cx, y: 40 };
    return { x: 46, y: g.sideY };
  }
  function placeSeats() {
    for (let r = 0; r < 4; r++) {
      const el = G.seatEls[r];
      if (!el) continue;
      const c = seatCenter(r);
      if (r === 0) {
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.bottom = '6px';
        el.style.top = 'auto';
      } else {
        el.style.left = c.x - 42 + 'px';
        el.style.top = c.y - 28 + 'px';
      }
    }
  }

  function tf(it) {
    const g = G.geo;
    return `translate(${(it.x - g.hw / 2).toFixed(1)}px, ${(it.y - g.hh / 2).toFixed(1)}px) rotate(${(it.rot || 0).toFixed(1)}deg) scale(${(it.scale || 1).toFixed(3)})`;
  }

  function trickSlot(r, card) {
    const g = G.geo;
    const jit = ((hash(card) % 7) - 3) * 1.6;
    const s = g.tw / g.hw;
    if (r === 0) return { x: g.cx + jit * 0.6, y: g.cy + g.th * 0.36, rot: jit, scale: s };
    if (r === 1) return { x: g.cx + g.tw * 0.68, y: g.cy - g.th * 0.04, rot: 8 + jit, scale: s };
    if (r === 2) return { x: g.cx - jit * 0.6, y: g.cy - g.th * 0.38, rot: 180 + jit, scale: s };
    return { x: g.cx - g.tw * 0.68, y: g.cy - g.th * 0.04, rot: -8 + jit, scale: s };
  }
  function fanSlot(r, i, n) {
    const g = G.geo;
    const s = g.bw / g.hw;
    const k = i - (n - 1) / 2;
    const step = g.bw * 0.4;
    const c = seatCenter(r);
    if (r === 2) return { x: c.x + k * step, y: c.y - 12, rot: 180 + k * 4, scale: s };
    if (r === 1) return { x: c.x + 14, y: c.y + k * step, rot: -90 - k * 4, scale: s };
    return { x: c.x - 14, y: c.y + k * step, rot: 90 + k * 4, scale: s };
  }
  function seatPoint(r, scale) {
    const c = seatCenter(r);
    const g = G.geo;
    if (r === 0) return { x: c.x, y: g.H + 40, rot: 0, scale: scale || 0.5 };
    return { x: c.x, y: c.y, rot: 0, scale: scale || 0.3 };
  }

  /* ---------------- layout of every visible card ---------------- */
  function layout(v) {
    const g = G.geo;
    const items = [];
    const exits = new Map();
    const legal = v.legal && v.legal.kind === 'play' ? new Set(v.legal.cards) : null;
    const myTurnPlay = !!legal;
    // my hand
    const hand = E.sortHand(v.hand, v.contract);
    const n = hand.length;
    const spacing = n > 1 ? Math.min(g.hw * 0.66, (g.W - 16 - g.hw) / (n - 1)) : 0;
    const x0 = g.cx - (spacing * (n - 1)) / 2;
    hand.forEach((c, i) => {
      const k = i - (n - 1) / 2;
      const it = {
        key: c,
        card: c,
        src: A.face(c),
        x: x0 + i * spacing,
        y: g.handY + k * k * 1.1 + (G.sel === c ? -g.hh * 0.2 : 0),
        rot: n > 1 ? k * Math.min(3.2, 22 / n) : 0,
        scale: 1,
        z: 200 + i,
        mine: true,
        dim: myTurnPlay && !legal.has(c),
        sel: G.sel === c,
      };
      if (G.dealFrom) {
        it.from = Object.assign({}, G.dealFrom, { opacity: 0.2 });
        it.delay = i * 45;
      } else if (G.extraFrom && G.extraFrom.has(c)) {
        it.from = { x: g.cx, y: g.cy, rot: 0, scale: g.tw / g.hw, opacity: 0.4 };
        it.delay = 80;
      }
      items.push(it);
    });
    // opponents' backs
    for (let s = 0; s < 4; s++) {
      if (s === G.mySeat) continue;
      const r = rel(s);
      const cnt = v.counts[s];
      for (let i = 0; i < cnt; i++) {
        const slot = fanSlot(r, i, cnt);
        const it = Object.assign({ key: 'b' + s + '_' + i, src: A.back(), z: 10 + i }, slot);
        if (G.dealFrom) {
          it.from = Object.assign({}, G.dealFrom, { opacity: 0.2 });
          it.delay = i * 45 + r * 20;
        } else if (G.extraBacks && G.extraBacks[s] != null && i >= G.extraBacks[s]) {
          it.from = { x: g.cx, y: g.cy, rot: 0, scale: g.tw / g.hw, opacity: 0.3 };
          it.delay = 60;
        }
        items.push(it);
      }
    }
    // exposed card + stock during bidding
    if (v.phase === 'bidding' && v.exposed) {
      for (let i = 0; i < 3; i++) items.push({ key: 'stk' + i, src: A.back(), x: g.cx + 4 + i * 2.5, y: g.cy - 3 - i * 2, rot: -4 + i * 3, scale: (g.tw / g.hw) * 1.12, z: 60 + i, from: G.dealFrom ? Object.assign({}, G.dealFrom) : null });
      items.push({ key: v.exposed, card: v.exposed, src: A.face(v.exposed), x: g.cx - 6, y: g.cy + 4, rot: -3, scale: (g.tw / g.hw) * 1.18, z: 70, from: G.dealFrom ? Object.assign({}, G.dealFrom) : null, delay: G.dealFrom ? 400 : 0 });
    }
    // trick (collected once the round is over)
    if (v.trick && v.trick.cards.length && v.phase !== 'roundEnd' && v.phase !== 'gameEnd') {
      v.trick.cards.forEach((x, i) => {
        const r = rel(x.s);
        const slot = trickSlot(r, x.c);
        const it = Object.assign({ key: x.c, card: x.c, src: A.face(x.c), z: 100 + i, win: v.phase === 'trickEnd' && v.trick.winner === x.s }, slot);
        if (!G.cardEls.has(x.c)) it.from = r === 0 ? { x: g.cx, y: g.handY, rot: 0, scale: 1 } : Object.assign(fanSlot(r, 0, 1), { scale: (g.bw / g.hw) * 1.3 });
        items.push(it);
      });
    }
    // where vanished trick cards fly: to the trick winner
    const p = G.prev;
    if (p && p.trick && p.trick.cards.length && p.trick.winner != null) {
      const target = seatPoint(rel(p.trick.winner), 0.25);
      for (const x of p.trick.cards) exits.set(x.c, Object.assign({}, target, { opacity: 0 }));
    }
    if (p && p.phase === 'bidding' && v.phase !== 'bidding' && v.contract && p.exposed) {
      if (v.contract.taker !== G.mySeat) exits.set(p.exposed, Object.assign(seatPoint(rel(v.contract.taker), 0.3), { opacity: 0 }));
      for (let i = 0; i < 3; i++) exits.set('stk' + i, { x: g.cx, y: g.cy, rot: 0, scale: 0.2, opacity: 0 });
    }
    return { items, exits };
  }

  function renderCards(v) {
    const { items, exits } = layout(v);
    const layer = $('#cards');
    const seen = new Set();
    for (const it of items) {
      seen.add(it.key);
      let el = G.cardEls.get(it.key);
      if (!el) {
        el = h('div', { class: 'card notrans' }, h('img', { alt: '', draggable: 'false' }));
        el.style.width = G.geo.hw + 'px';
        el.style.height = G.geo.hh + 'px';
        layer.appendChild(el);
        G.cardEls.set(it.key, el);
        const f = it.from || it;
        el.style.transform = tf(f);
        el.style.opacity = f.opacity != null ? f.opacity : 1;
        el.style.zIndex = it.z;
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth;
        el.classList.remove('notrans');
      }
      el.style.transitionDelay = (it.delay || 0) + 'ms';
      if (el._src !== it.src) {
        el.firstChild.src = it.src;
        el._src = it.src;
      }
      el.style.transform = tf(it);
      el.style.opacity = 1;
      el.style.zIndex = it.z;
      el.classList.toggle('mine', !!it.mine);
      el.classList.toggle('dim', !!it.dim);
      el.classList.toggle('sel', !!it.sel);
      el.classList.toggle('win', !!it.win);
      el.dataset.card = it.mine ? it.card : '';
    }
    for (const [key, el] of Array.from(G.cardEls.entries())) {
      if (seen.has(key)) continue;
      G.cardEls.delete(key);
      const ex = exits.get(key);
      el.style.transitionDelay = '0ms';
      el.classList.remove('mine', 'sel', 'win');
      if (ex) el.style.transform = tf(ex);
      el.style.opacity = 0;
      setTimeout(() => el.remove(), 460);
    }
    G.dealFrom = null;
    G.extraFrom = null;
    G.extraBacks = null;
  }

  function resizeCards() {
    for (const el of G.cardEls.values()) {
      el.style.width = G.geo.hw + 'px';
      el.style.height = G.geo.hh + 'px';
      el.classList.add('notrans');
    }
    if (G.view) renderCards(G.view);
    requestAnimationFrame(() => {
      for (const el of G.cardEls.values()) el.classList.remove('notrans');
    });
  }

  /* ---------------- seats ---------------- */
  function buildSeats() {
    const t = $('#table');
    G.seatEls.forEach((el) => el && el.remove());
    G.seatEls = [];
    for (let r = 0; r < 4; r++) {
      const el = h('div', { class: 'seat' + (r === 0 ? ' me' : ''), 'data-r': r });
      t.appendChild(el);
      G.seatEls[r] = el;
    }
    placeSeats();
  }
  function renderSeats(v) {
    for (let s = 0; s < 4; s++) {
      const r = rel(s);
      const el = G.seatEls[r];
      const p = G.players[s] || { name: '…', av: '❔' };
      const key = [p.name, p.av, p.lv, p.bot, v && v.away && v.away[s]].join('|');
      if (el._key !== key) {
        el._key = key;
        el.innerHTML = '';
        const ring = h('div', { class: 'ring' });
        const R = r === 0 ? 19 : 28;
        const C = 2 * Math.PI * R;
        ring.innerHTML = `<svg viewBox="0 0 ${R * 2 + 6} ${R * 2 + 6}" width="100%" height="100%"><circle cx="${R + 3}" cy="${R + 3}" r="${R}" stroke-dasharray="${C.toFixed(1)}" style="--c:${C.toFixed(1)}"/></svg>`;
        const av = U.avatar(p, { noLv: r === 0 });
        av.appendChild(h('span', { class: 'crown', text: '👑' }));
        el.appendChild(ring);
        el.appendChild(av);
        const nm = h('div', { class: 'nm', text: p.name });
        el.appendChild(nm);
        el.appendChild(h('div', { class: 'dl', text: 'موزّع' }));
      }
      if (!v) continue;
      const isTurn = v.turn === s && (v.phase === 'bidding' || v.phase === 'doubling' || v.phase === 'playing');
      el.classList.toggle('turn', isTurn);
      el.classList.toggle('dealer', v.dealer === s && (v.phase === 'bidding' || v.phase === 'doubling'));
      el.classList.toggle('buyer', !!(v.contract && v.contract.caller === s && v.phase !== 'bidding'));
      el.classList.toggle('away', !!(v.away && v.away[s] && p && !p.bot));
      const ring = el.querySelector('.ring');
      if (ring) {
        const runKey = isTurn && v.turnTotal ? s + ':' + v.seq : '';
        if (ring._run !== runKey) {
          ring._run = runKey;
          ring.classList.remove('run');
          const circle = ring.querySelector('circle');
          if (runKey) {
            const C = parseFloat(circle.getAttribute('stroke-dasharray'));
            circle.style.setProperty('--c', C);
            ring.style.setProperty('--dur', v.turnTotal / 1000 + 's');
            circle.style.animationDelay = -((v.turnTotal - v.deadline) / 1000) + 's';
            circle.style.strokeDashoffset = '0';
            // eslint-disable-next-line no-unused-expressions
            ring.offsetWidth;
            ring.classList.add('run');
          }
        }
      }
    }
  }

  /* ---------------- bubbles, banners, project reveal ---------------- */
  function bubble(seat, text, cls, ms) {
    const r = rel(seat);
    const t = $('#table');
    const c = seatCenter(r);
    const old = t.querySelector('.bubble[data-s="' + seat + '"]');
    if (old) old.remove();
    const b = h('div', { class: 'bubble ' + (cls || ''), 'data-s': seat });
    if (typeof text === 'string') b.textContent = text;
    else b.appendChild(text);
    t.appendChild(b);
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    let x;
    let y;
    if (r === 0) {
      x = c.x - bw / 2;
      y = G.geo.H - 40 - bh;
    } else if (r === 2) {
      x = c.x + 34;
      y = c.y - bh / 2;
    } else if (r === 1) {
      x = c.x - 40 - bw;
      y = c.y - 40;
    } else {
      x = c.x + 40;
      y = c.y - 40;
    }
    b.style.left = clamp(x, 4, G.geo.W - bw - 4) + 'px';
    b.style.top = clamp(y, 4, G.geo.H - bh - 4) + 'px';
    setTimeout(() => b.classList.add('out'), ms || 1900);
    setTimeout(() => b.remove(), (ms || 1900) + 350);
  }
  function suitBubble(text, s) {
    const span = h('span', null, text + ' ');
    const ic = h('span', { html: A.suitIcon(s, 16) });
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } }, span, ic);
  }
  function banner(title, sub, ms) {
    const t = $('#table');
    t.querySelectorAll('.banner').forEach((b) => b.remove());
    const b = h('div', { class: 'banner' }, h('div', { class: 't' }, title), sub ? h('div', { class: 's', text: sub }) : null);
    t.appendChild(b);
    setTimeout(() => b.remove(), ms || 1500);
  }
  function showProjects(list) {
    const t = $('#table');
    const bySeat = {};
    list.forEach((p) => (bySeat[p.s] = bySeat[p.s] || []).push(p));
    Object.keys(bySeat).forEach((sk) => {
      const s = +sk;
      const r = rel(s);
      const c = seatCenter(r);
      const box = h('div', { class: 'proj-show' });
      bySeat[s].forEach((p) => {
        box.appendChild(h('span', { class: 'lb', text: L.proj[p.k] }));
        (p.cards || []).forEach((cd) => box.appendChild(h('img', { src: A.face(cd), alt: '' })));
      });
      t.appendChild(box);
      const bw = box.offsetWidth;
      let x = c.x - bw / 2;
      let y = r === 0 ? G.geo.handY - G.geo.hh / 2 - 70 : r === 2 ? c.y + 34 : c.y + 36;
      if (r === 1) x = c.x - bw + 30;
      if (r === 3) x = c.x - 30;
      box.style.left = clamp(x, 4, G.geo.W - bw - 4) + 'px';
      box.style.top = clamp(y, 4, G.geo.H - 60) + 'px';
      setTimeout(() => box.remove(), 4200);
    });
  }

  /* ---------------- events ---------------- */
  function bidLabel(ev) {
    if (ev.a === 'pass') return ev.r === 2 ? L.bid.pass2 : L.bid.pass1;
    if (ev.a === 'hokm' || ev.a === 'hokm2' || ev.a === 'confirm') return suitBubble(ev.a === 'hokm2' ? 'حكم ثاني' : 'حكم', ev.suit);
    return L.bid[ev.a] || ev.a;
  }
  function handleEvent(ev, v) {
    switch (ev.t) {
      case 'deal':
        S.play('deal');
        G.dealFrom = Object.assign(seatPoint(rel(ev.dealer), 0.35), { opacity: 0 });
        G.sel = null;
        if (ev.redeal) U.toast('ما أحد شرى — توزيع جديد');
        break;
      case 'round2':
        U.toast('اللفة الثانية', 1500);
        break;
      case 'bid': {
        const strong = ev.a !== 'pass';
        bubble(ev.s, bidLabel(ev), strong ? 'hot big' : '', strong ? 2300 : 1600);
        S.play(strong ? 'big' : 'bid');
        break;
      }
      case 'contract': {
        const name = seatName(ev.caller);
        const title = ev.type === 'sun' ? (ev.ashkal ? 'أشكل' : 'صن') : 'حكم ' + U.suitSym(ev.trump);
        banner(title, name + (ev.ashkal ? ' — الورقة لخويه' : ' اشترى'), 1500);
        // the extra cards fly in from the centre
        G.extraFrom = new Set();
        if (G.prev) {
          const before = new Set(G.prev.hand);
          v.hand.forEach((c) => {
            if (!before.has(c) && c !== (G.prev && G.prev.exposed)) G.extraFrom.add(c);
          });
          G.extraBacks = G.prev.counts.slice();
        }
        break;
      }
      case 'dbl':
        if (ev.a === 'pass') bubble(ev.s, 'بس', '', 1400);
        else {
          bubble(ev.s, L.dbl[ev.a], 'red big', 2600);
          S.play('big');
        }
        break;
      case 'declare':
        bubble(ev.s, ev.list.map((k) => L.proj[k]).join(' + '), 'hot', 2200);
        break;
      case 'play':
        S.play('card');
        break;
      case 'baloot':
        bubble(ev.s, 'بلوت!', 'hot big', 2400);
        S.play('good');
        break;
      case 'trick':
        setTimeout(() => S.play('collect'), 700);
        if (G.session && G.session.kind === 'offline') botChatter(ev, v);
        break;
      case 'projShow':
        if (ev.list) showProjects(ev.list);
        break;
      case 'sawa':
        bubble(ev.s, 'سوا!', 'green big', 2200);
        banner('سوا', seatName(ev.s) + ' أخذ الباقي', 1400);
        S.play('big');
        break;
      case 'roundEnd':
        break;
      default:
        break;
    }
  }
  function botChatter(ev, v) {
    if (Math.random() > 0.22) return;
    const partner = E.partner(G.mySeat);
    if (ev.pts >= 25 && E.teamOf(ev.w) === myTeam() && ev.w === G.mySeat) {
      setTimeout(() => bubble(partner, ['كفو!', 'صح لسانك', 'يا حلو 🔥'][Math.floor(Math.random() * 3)], 'green', 1800), 500);
    } else if (ev.pts >= 25 && E.teamOf(ev.w) !== myTeam()) {
      setTimeout(() => bubble(ev.w, ['خذ عاد 😎', 'مشينا', 'زين'][Math.floor(Math.random() * 3)], '', 1600), 500);
    }
  }

  /* ---------------- action panel ---------------- */
  function renderActions(v) {
    const box = $('#actions');
    const L2 = v.legal;
    const key = JSON.stringify([v.seq, L2 && L2.kind, G.projSel, v.phase]);
    if (box._key === key) return;
    box._key = key;
    box.innerHTML = '';
    if (!L2) return;
    if (L2.kind === 'bid') return box.appendChild(bidPanel(v, L2));
    if (L2.kind === 'dbl') return box.appendChild(dblPanel(v, L2));
    if (L2.kind === 'play') {
      if (L2.projects && L2.projects.length) {
        if (!G.projSel || G.projSel.seq !== v.roundNo) G.projSel = { seq: v.roundNo, on: L2.projects.map(() => G.ctx.settings.autoProj !== false) };
        const row = h('div', { class: 'proj-row' });
        L2.projects.forEach((p, i) => {
          const chip = h(
            'button',
            {
              class: 'proj-chip' + (G.projSel.on[i] ? ' on' : ''),
              onclick: () => {
                G.projSel.on[i] = !G.projSel.on[i];
                box._key = null;
                renderActions(v);
              },
            },
            L.proj[p.k],
            p.cards && p.cards[0] ? h('span', { html: A.suitIcon(p.cards[0][1], 15, G.projSel.on[i] ? '#1d1612' : '#efe4cc') }) : null
          );
          row.appendChild(chip);
        });
        box.appendChild(h('div', { class: 'hint', text: 'مشاريعك — تنعلن مع أول ورقة' }));
        box.appendChild(row);
      } else if (G.ctx.settings.hints !== false) {
        box.appendChild(h('div', { class: 'hint', text: G.ctx.settings.oneTap ? 'دورك — المس الورقة' : 'دورك — المس الورقة مرتين أو اسحبها لفوق' }));
      }
      if (L2.sawa) {
        box.appendChild(
          h(
            'button',
            {
              class: 'btn green',
              onclick: () => {
                G.session.act({ t: 'sawa' });
                box.innerHTML = '';
                box._key = null;
              },
            },
            'سوا — كل الباقي لنا'
          )
        );
      }
    }
  }
  function bidPanel(v, L2) {
    const card = h('div', { class: 'act-card' });
    const b = v.bidding;
    const exp = v.exposed;
    let title;
    if (b.stage === 'confirm') title = 'محد قلبها صن — تكمل حكم ولا تقلبها صن؟';
    else if (b.stage === 'sunCheck') title = seatName(b.hokmBy) + ' قال حكم — تبي صن؟';
    else if (b.round === 2) title = 'اللفة الثانية — اختر حكم ثاني أو صن';
    else title = b.hokmBy != null ? seatName(b.hokmBy) + ' قال حكم' : 'اللفة الأولى';
    card.appendChild(h('div', { class: 'act-title' }, h('b', { text: title })));
    const row = h('div', { class: 'act-row' });
    const send = (a) => {
      S.unlock();
      G.session.act(Object.assign({ t: 'bid' }, a));
      $('#actions').innerHTML = '';
      $('#actions')._key = null;
    };
    const opts = L2.options;
    if (opts.indexOf('hokm2') >= 0) {
      const srow = h('div', { class: 'act-row' });
      L2.suits.forEach((s) => srow.appendChild(h('button', { class: 'suit-btn', 'aria-label': 'حكم ' + L.suit[s], html: A.suitIcon(s, 30), onclick: () => send({ a: 'hokm2', suit: s }) })));
      card.appendChild(srow);
    }
    for (const o of opts) {
      if (o === 'hokm2') continue;
      let btn;
      if (o === 'hokm' || o === 'confirm') {
        const s = o === 'hokm' ? exp[1] : b.hokmSuit;
        btn = h('button', { class: 'btn', onclick: () => send({ a: o }) }, 'حكم', h('span', { html: A.suitIcon(s, 20) }));
      } else if (o === 'sun') btn = h('button', { class: 'btn indigo', onclick: () => send({ a: 'sun' }) }, 'صن');
      else if (o === 'ashkal') btn = h('button', { class: 'btn green', onclick: () => send({ a: 'ashkal' }) }, 'أشكل');
      else btn = h('button', { class: 'btn ghost', onclick: () => send({ a: 'pass' }) }, b.round === 2 && b.stage === 'main' ? 'ولا' : 'بس');
      row.appendChild(btn);
    }
    card.appendChild(row);
    return card;
  }
  function dblPanel(v, L2) {
    const card = h('div', { class: 'act-card' });
    const c = v.contract;
    const st = v.doubling.stage;
    const titles = {
      double: 'تبي تدبل على ' + seatName(c.caller) + '؟',
      triple: seatName(c.doubler) + ' دبّل — ترد بثري؟',
      four: seatName(c.taker) + ' قال ثري — ترد بفور؟',
      gahwa: 'فور! — تختمها بقهوة؟ (اللي يفوز ياخذ الصكة)',
    };
    card.appendChild(h('div', { class: 'act-title' }, h('b', { text: titles[st] || '' })));
    const row = h('div', { class: 'act-row' });
    for (const o of L2.options) {
      row.appendChild(
        h(
          'button',
          {
            class: 'btn ' + (o === 'pass' ? 'ghost' : 'red'),
            onclick: () => {
              G.session.act({ t: 'dbl', a: o });
              $('#actions').innerHTML = '';
              $('#actions')._key = null;
            },
          },
          L.dbl[o]
        )
      );
    }
    card.appendChild(row);
    return card;
  }

  /* ---------------- top bar + chips ---------------- */
  function renderBar(v) {
    const t = myTeam();
    $('#sc-us').textContent = v.scores[t];
    $('#sc-them').textContent = v.scores[1 - t];
    $('#sc-target').textContent = v.target;
    $('#sc-round').textContent = v.roundNo;
    const chip = $('#contract-chip');
    const c = v.contract;
    if (c && v.phase !== 'bidding') {
      chip.classList.add('on');
      const key = JSON.stringify(c);
      if (chip._key !== key) {
        chip._key = key;
        chip.innerHTML = '';
        if (c.type === 'hokm') chip.appendChild(h('span', { html: A.suitIcon(c.trump, 16, '#efe4cc') }));
        chip.appendChild(h('span', { text: (c.type === 'sun' ? (c.ashkal ? 'أشكل' : 'صن') : 'حكم') + ' · ' + seatName(c.caller) }));
        if (c.mult > 1) chip.appendChild(h('span', { class: 'x', text: c.gahwa ? 'قهوة' : L.mult[c.mult] }));
        if (c.locked) chip.appendChild(h('span', { class: 'lock', text: '🔒' }));
      }
    } else chip.classList.remove('on');
    const tc = $('#trick-count');
    if (v.tricksWon && (v.phase === 'playing' || v.phase === 'trickEnd')) {
      tc.classList.add('on');
      tc.innerHTML = '';
      tc.append('الأكلات ', h('b', { text: String(v.tricksWon[t]) }), ' : ', h('b', { text: String(v.tricksWon[1 - t]) }));
    } else tc.classList.remove('on');
  }

  /* ---------------- summaries ---------------- */
  function roundSummary(v) {
    const s = v.summary;
    if (!s) return;
    const t = myTeam();
    const good = s.winTeam === t;
    if (G.sumModal) G.sumModal.close();
    const outcomeText = s.kaboot != null ? (s.kaboot === s.team ? 'كبوت!' : 'كبوت عكسي!') : s.outcome === 'made' ? 'نجح المشتري' : 'خسرانة!';
    G.sumModal = U.modal(
      (sh, m) => {
        const contract = (s.type === 'sun' ? 'صن' : 'حكم ' + U.suitSym(s.trump)) + ' — ' + seatName(s.caller) + (s.mult > 1 ? ' · ' + (s.gahwa ? 'قهوة' : L.mult[s.mult]) : '');
        sh.appendChild(h('div', { class: 'sum-head' }, h('div', { class: 'r ' + (good ? 'good' : 'bad'), text: outcomeText }), h('div', { class: 'c', text: contract })));
        const row = (label, a, b) => h('tr', null, h('td', { text: label }), h('td', { class: 'us', text: a }), h('td', { class: 'them', text: b }));
        const tb = h('table', { class: 'sum-table' }, h('tr', null, h('th', { text: '' }), h('th', { text: 'لنا' }), h('th', { text: 'لهم' })));
        tb.appendChild(row('الأبناط', s.abnat[t], s.abnat[1 - t]));
        tb.appendChild(row('الأكلات', s.tricksWon[t], s.tricksWon[1 - t]));
        const pl = (i) => (s.projList[i] && s.projList[i].length ? s.projList[i].map((k) => L.proj[k]).join(' + ') + ' (' + s.projPts[i] + ')' : '—');
        tb.appendChild(row('المشاريع', pl(t), pl(1 - t)));
        if (s.bal[0] || s.bal[1]) tb.appendChild(row('البلوت', s.bal[t] || '—', s.bal[1 - t] || '—'));
        tb.appendChild(h('tr', { class: 'tot' }, h('td', { text: 'نقاط الجولة' }), h('td', { class: 'us', text: s.pts[t] }), h('td', { class: 'them', text: s.pts[1 - t] })));
        tb.appendChild(row('المجموع', s.scores[t], s.scores[1 - t]));
        sh.appendChild(h('div', { class: 'body' }, tb));
        const foot = h('div', { class: 'foot' });
        const over = v.phase === 'gameEnd';
        const btn = h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              m.close();
              if (over) gameOver(v);
              else G.session.next();
            },
          },
          over ? 'النتيجة النهائية' : 'التالي'
        );
        foot.appendChild(btn);
        sh.appendChild(foot);
        if (G.session.kind === 'online' && !over) {
          const note = h('div', { class: 'note', id: 'sum-note', text: 'الجولة الجاية تبدأ تلقائياً' });
          sh.appendChild(note);
        }
      },
      { sticky: true, center: true, onClose: () => (G.sumModal = null) }
    );
    S.play(good ? 'good' : 'bad');
  }

  function gameOver(v) {
    const t = myTeam();
    const win = v.winner === t;
    if (G.endShown === v.gameNo + ':' + v.roundNo) return;
    G.endShown = v.gameNo + ':' + v.roundNo;
    S.play(win ? 'win' : 'bad');
    const kaboots = (v.rounds || []).filter((r) => r.outcome === 'kaboot' && r.team === t).length;
    const xpP = G.ctx.onGameEnd ? G.ctx.onGameEnd({ win, kaboots, mode: G.session.kind === 'offline' ? 'offline' : 'online', level: G.session.level }) : Promise.resolve(0);
    U.modal(
      (sh, m) => {
        sh.appendChild(h('div', { class: 'end-trophy', text: win ? '🏆' : '☕' }));
        sh.appendChild(h('div', { class: 'end-title', text: win ? 'فزنا بالصكة!' : 'خسرنا هالصكة' }));
        sh.appendChild(h('div', { class: 'end-score' }, h('div', null, 'لنا', h('b', { text: v.scores[t] })), h('div', null, 'لهم', h('b', { text: v.scores[1 - t] }))));
        const xp = h('div', { class: 'xp-gain', text: ' ' });
        sh.appendChild(xp);
        Promise.resolve(xpP).then((g) => {
          if (g) xp.textContent = '+' + g + ' خبرة';
        });
        const foot = h('div', { class: 'foot' });
        foot.appendChild(
          h(
            'button',
            {
              class: 'btn ghost',
              onclick: () => {
                m.close();
                G.ctx.onExit();
              },
            },
            'الرئيسية'
          )
        );
        const canRematch = G.session.kind === 'offline' || (G.session.isHost !== false && G.session.kind !== 'online') || G.session.isHost || (G.session.room && G.session.room.host);
        if (canRematch) {
          foot.appendChild(
            h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  m.close();
                  G.summaryShown = 0;
                  G.session.rematch();
                },
              },
              'صكة جديدة'
            )
          );
        }
        sh.appendChild(foot);
        if (!canRematch) sh.appendChild(h('div', { class: 'note', text: 'صاحب الغرفة يقدر يبدأ صكة جديدة' }));
      },
      { sticky: true, center: true }
    );
  }

  function scoreSheet() {
    const v = G.view;
    if (!v) return;
    const t = myTeam();
    U.modal((sh, m) => {
      sh.appendChild(h('h2', { text: 'الصكة' }));
      const tb = h('table', { class: 'sheet-list' }, h('tr', null, h('th', { text: '#' }), h('th', { text: 'اللعب' }), h('th', { text: 'لنا' }), h('th', { text: 'لهم' })));
      (v.rounds || []).forEach((r) => {
        const kind = (r.type === 'sun' ? 'صن' : 'حكم ' + U.suitSym(r.trump)) + (r.mult > 1 ? ' ×' + r.mult : '') + (r.outcome === 'fail' ? ' ✗' : r.outcome === 'kaboot' ? ' كبوت' : '');
        tb.appendChild(h('tr', null, h('td', { class: 'k', text: r.n }), h('td', { class: 'k', text: kind }), h('td', { text: r.pts[t] }), h('td', { text: r.pts[1 - t] })));
      });
      tb.appendChild(h('tr', null, h('td', null), h('td', { text: 'المجموع' }), h('td', null, h('b', { text: v.scores[t] })), h('td', null, h('b', { text: v.scores[1 - t] }))));
      sh.appendChild(h('div', { class: 'body' }, tb, h('p', { class: 'note', text: 'اللي يوصل ' + v.target + ' أول يفوز بالصكة' })));
      sh.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => m.close() }, 'تمام')));
    });
  }
  function lastTrick() {
    const v = G.view;
    if (!v || !v.lastTrick) return U.toast('ما فيه أكلة سابقة');
    U.modal(
      (sh, m) => {
        sh.appendChild(h('h2', { text: 'آخر أكلة' }));
        const row = h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } });
        v.lastTrick.cards.forEach((x) => {
          row.appendChild(
            h(
              'div',
              { style: { textAlign: 'center', fontSize: '12.5px' } },
              h('img', { src: A.face(x.c), style: { width: '64px', display: 'block', borderRadius: '6px', boxShadow: x.s === v.lastTrick.winner ? '0 0 0 3px #f2c262' : 'none' } }),
              seatName(x.s)
            )
          );
        });
        sh.appendChild(row);
        sh.appendChild(h('p', { class: 'note', text: 'أكلها ' + seatName(v.lastTrick.winner) }));
        sh.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => m.close() }, 'تمام')));
      },
      { center: true }
    );
  }
  function chatPanel() {
    U.modal((sh, m) => {
      sh.appendChild(h('h2', { text: 'سوالف' }));
      const g1 = h('div', { class: 'chat-grid' });
      L.phrases.forEach((p) => g1.appendChild(h('button', { onclick: () => (G.session.chat(p), m.close()) }, p)));
      const g2 = h('div', { class: 'chat-grid emo', style: { marginTop: '10px' } });
      L.emojis.forEach((p) => g2.appendChild(h('button', { onclick: () => (G.session.chat(p), m.close()) }, p)));
      sh.appendChild(h('div', { class: 'body' }, g1, g2));
    });
  }
  function menu() {
    if (G.session.kind === 'offline') G.session.pause(true);
    U.modal(
      (sh, m) => {
        sh.appendChild(h('h2', { text: 'القائمة' }));
        const b = (label, fn, cls) => h('button', { class: 'btn block ' + (cls || 'ghost'), style: { marginBottom: '9px' }, onclick: () => (m.close(), fn()) }, label);
        sh.appendChild(
          h(
            'div',
            { class: 'body' },
            b('كمّل اللعب', () => {}, ''),
            b('الصكة', scoreSheet),
            b('آخر أكلة', lastTrick),
            b('طريقة اللعب', () => G.ctx.showRules()),
            b('الإعدادات', () => G.ctx.showSettings()),
            b('انسحاب من اللعبة', () => U.confirmBox('متأكد تبي تطلع؟', 'اطلع', 'لا، كمّل', () => G.ctx.onExit(), true), 'red')
          )
        );
      },
      { onClose: () => G.session && G.session.kind === 'offline' && G.session.pause(false) }
    );
  }

  /* ---------------- main render ---------------- */
  function onView(v) {
    if (!G.open) return;
    const firstView = !G.view;
    // events
    const evs = (v.events || []).filter((e) => e.q > G.lastQ);
    if (firstView && evs.length > 4) evs.splice(0, evs.length - 4);
    G.prevForEvents = G.view;
    G.prev = G.view;
    G.view = v;
    for (const ev of evs) handleEvent(ev, v);
    if (v.events && v.events.length) G.lastQ = Math.max(G.lastQ, v.events[v.events.length - 1].q);
    if (G.sel && (!v.hand.includes(G.sel) || !(v.legal && v.legal.kind === 'play'))) G.sel = null;
    renderSeats(v);
    renderBar(v);
    renderCards(v);
    renderActions(v);
    const mine = v.turn === G.mySeat && !!v.legal;
    if (mine && !G.lastTurnMine) {
      S.play('turn');
      S.vib(18);
    }
    G.lastTurnMine = mine;
    // round summary (after the last trick has flown away)
    if ((v.phase === 'roundEnd' || v.phase === 'gameEnd') && v.summary) {
      const key = v.gameNo + ':' + v.roundNo;
      if (G.summaryShown !== key) {
        G.summaryShown = key;
        setTimeout(() => G.view === v && roundSummary(v), 750);
      } else if (G.session.kind === 'online' && v.ready && v.ready.indexOf(G.mySeat) >= 0) {
        const n = $('#sum-note');
        if (n) n.textContent = 'بانتظار باقي اللاعبين…';
      }
    } else if (G.sumModal) {
      G.sumModal.close();
    }
  }

  function onCardTap(card, direct) {
    const v = G.view;
    if (!v) return;
    S.unlock();
    const L2 = v.legal;
    if (!L2 || L2.kind !== 'play') {
      G.sel = G.sel === card ? null : card;
      renderCards(v);
      return;
    }
    if (L2.cards.indexOf(card) < 0) {
      S.play('err');
      S.vib(30);
      const led = v.trick && v.trick.cards[0];
      U.toast(led ? 'لازم تلعب ورقة مسموحة (المضيئة)' : 'هذي الورقة ممنوعة الحين', 1500);
      return;
    }
    if (direct || G.ctx.settings.oneTap || G.sel === card) {
      let proj = false;
      if (L2.projects && L2.projects.length && G.projSel) proj = G.projSel.on.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
      G.sel = null;
      G.session.act({ t: 'play', c: card, proj: proj && proj.length ? proj : false });
      $('#actions').innerHTML = '';
      $('#actions')._key = null;
    } else {
      G.sel = card;
      renderCards(v);
    }
  }

  function bindPointer() {
    const layer = $('#cards');
    let start = null;
    layer.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.card.mine');
      if (!el) return;
      start = { x: e.clientX, y: e.clientY, card: el.dataset.card, moved: false };
    });
    window.addEventListener(
      'pointermove',
      (e) => {
        if (!start) return;
        if (start.y - e.clientY > 34 && Math.abs(e.clientX - start.x) < 60) {
          const c = start.card;
          start = null;
          onCardTap(c, true);
        }
      },
      { passive: true }
    );
    window.addEventListener('pointerup', () => {
      if (!start) return;
      const c = start.card;
      start = null;
      if (c) onCardTap(c, false);
    });
  }

  function onPlayers(list) {
    G.players = list;
    if (G.view) renderSeats(G.view);
    else renderSeats(null);
  }

  /* ---------------- open / close ---------------- */
  let bound = false;
  let resizeT = null;
  function openGame(session, ctx) {
    G.session = session;
    G.ctx = ctx;
    G.view = null;
    G.prev = null;
    G.lastQ = 0;
    G.sel = null;
    G.projSel = null;
    G.summaryShown = 0;
    G.endShown = 0;
    G.open = true;
    G.mySeat = session.mySeat || 0;
    G.players = ctx.players || [];
    $('#cards').innerHTML = '';
    G.cardEls.clear();
    $('#actions').innerHTML = '';
    $('#actions')._key = null;
    document.querySelectorAll('#table .bubble, #table .banner, #table .proj-show').forEach((e) => e.remove());
    computeGeo();
    buildSeats();
    renderSeats(null);
    if (!bound) {
      bound = true;
      bindPointer();
      window.addEventListener('resize', () => {
        clearTimeout(resizeT);
        resizeT = setTimeout(() => {
          if (!G.open) return;
          computeGeo();
          resizeCards();
          if (G.view) renderSeats(G.view);
        }, 120);
      });
      $('#btn-menu').addEventListener('click', () => menu());
      $('#score-btn').addEventListener('click', () => scoreSheet());
      $('#btn-chat').addEventListener('click', () => chatPanel());
      $('#trick-count').addEventListener('click', () => lastTrick());
      $('#btn-sound').addEventListener('click', () => {
        S.settings.on = !S.settings.on;
        G.ctx.saveSettings({ sound: S.settings.on });
        $('#btn-sound').textContent = S.settings.on ? '🔊' : '🔈';
      });
    }
    $('#btn-sound').textContent = S.settings.on ? '🔊' : '🔈';
    $('#btn-chat').classList.toggle('hidden', session.kind === 'offline');
    session.on('view', (v) => {
      G.mySeat = v.me;
      onView(v);
    });
    session.on('players', onPlayers);
    session.on('chat', (m) => {
      if (!G.open) return;
      bubble(m.s, m.m, 'green', 2600);
    });
    session.on('error', (e) => {
      if (!G.open) return;
      if (e === 'illegal' || e === 'not_turn') S.play('err');
      else if (typeof e === 'string' && e.length > 12) U.toast(e);
    });
    session.on('net', (ok) => {
      if (!G.open) return;
      U.toast(ok ? 'رجع الاتصال' : 'انقطع الاتصال… نحاول نرجع', 1800);
    });
    session.on('closed', (why) => {
      if (!G.open) return;
      if (why === 'host_left') {
        U.toast('صاحب الغرفة طلع — انتهت اللعبة', 3000);
        G.ctx.onExit();
      }
    });
  }
  function closeGame() {
    G.open = false;
    if (G.sumModal) G.sumModal.close();
    G.session = null;
  }

  window.BalootGame = { open: openGame, close: closeGame, relayout: () => G.open && (computeGeo(), resizeCards()), debug: () => G };
})();
