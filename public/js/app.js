/* App shell: splash, login, home, offline setup, online lobby/rooms, settings, rules, leaderboard. */
(function () {
  'use strict';
  const A = window.BalootArt;
  const S = window.BalootSound;
  const U = window.BalootUI;
  const N = window.BalootNet;
  const { h, $ } = U;
  const { Auth, store } = N;

  const DEFAULTS = { sound: true, vib: true, oneTap: false, autoProj: true, hints: true, speed: 1, level: 'medium', target: 152 };
  const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  S.settings.on = settings.sound;
  S.settings.vib = settings.vib;
  function saveSettings(patch) {
    Object.assign(settings, patch);
    store.set('settings', settings);
    S.settings.on = settings.sound;
    S.settings.vib = settings.vib;
  }

  let current = 'splash';
  function show(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
    current = name;
  }

  /* ---------------- decor ---------------- */
  function decor() {
    const root = document.documentElement.style;
    root.setProperty('--sadu-band', 'url("' + A.saduBand(28) + '")');
    root.setProperty('--sadu-side', 'url("' + A.saduSide(11) + '")');
    root.setProperty('--field', 'url("' + A.fieldPattern() + '")');
    const wood = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence baseFrequency=".012 .4" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .2  0 0 0 0 .11  0 0 0 0 .06  0 0 0 .55 0"/></filter><rect width="160" height="160" filter="url(#n)"/></svg>');
    root.setProperty('--wood', 'url("' + wood + '")');
    $('#splash-emblem').innerHTML = A.emblem(96);
    $('#login-emblem').innerHTML = A.emblem(76);
  }

  /* ---------------- login ---------------- */
  let pickAv = N.AVATARS[0];
  function avatarPicker(cur) {
    pickAv = cur || pickAv;
    const grid = h('div', { class: 'avatars', role: 'radiogroup', 'aria-label': 'اختر صورتك' });
    N.AVATARS.forEach((a) => {
      const b = h('button', { class: 'av-pick' + (a === pickAv ? ' on' : ''), style: { background: U.avBg(a) }, role: 'radio', 'aria-checked': a === pickAv ? 'true' : 'false', onclick: () => {
        pickAv = a;
        grid.querySelectorAll('.av-pick').forEach((x) => x.classList.toggle('on', x === b));
      } }, a);
      grid.appendChild(b);
    });
    return grid;
  }
  let fieldN = 0;
  function field(label, attrs) {
    const id = (attrs && attrs.id) || 'fld-' + (attrs && attrs.name ? attrs.name : 'f' + ++fieldN);
    const input = h('input', Object.assign({ autocomplete: 'off', spellcheck: 'false', id }, attrs));
    return { wrap: h('div', { class: 'field' }, h('label', { text: label, for: id }), input), input };
  }

  function privacyNote() {
    if (Auth.mode !== 'server') return null;
    return h('p', { class: 'note' }, 'بدخولك توافق على ', h('a', { href: '/privacy.html', style: { color: 'var(--saffron-hi)' } }, 'سياسة الخصوصية'));
  }
  function renderLogin(tab) {
    show('login');
    const panel = $('#login-panel');
    panel.innerHTML = '';
    const err = h('div', { class: 'err', role: 'alert' });
    const serverMode = Auth.mode === 'server' && Auth.serverUp;
    if (serverMode) {
      tab = tab || 'login';
      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      [['login', 'دخول'], ['register', 'حساب جديد'], ['guest', 'ضيف']].forEach(([k, l]) => tabs.appendChild(h('button', { class: k === tab ? 'on' : '', role: 'tab', onclick: () => renderLogin(k) }, l)));
      panel.appendChild(tabs);
      if (tab === 'login') {
        const u = field('اسم المستخدم', { name: 'username', autocomplete: 'username', dir: 'auto' });
        const p = field('كلمة المرور', { type: 'password', name: 'password', autocomplete: 'current-password' });
        const go = async () => {
          err.textContent = '';
          if (!u.input.value.trim() || !p.input.value) return (err.textContent = 'اكتب اسم المستخدم وكلمة المرور');
          btn.disabled = true;
          try {
            await Auth.login(u.input.value.trim(), p.input.value);
            goHome();
          } catch (e) {
            err.textContent = e.message === 'bad_login' ? 'اسم المستخدم أو كلمة المرور غلط' : 'صار خطأ، جرب مرة ثانية';
          }
          btn.disabled = false;
        };
        const btn = h('button', { class: 'btn block', onclick: go }, 'دخول');
        p.input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
        panel.append(u.wrap, p.wrap, err, btn, privacyNote());
      } else if (tab === 'register') {
        const u = field('اسم المستخدم (إنجليزي أو أرقام)', { name: 'new-username', autocomplete: 'username', dir: 'ltr', maxlength: 20 });
        const p = field('كلمة المرور (6 أحرف على الأقل)', { type: 'password', name: 'new-password', autocomplete: 'new-password' });
        const n = field('اسمك في اللعبة', { maxlength: 16, name: 'nick' });
        const go = async () => {
          err.textContent = '';
          const un = u.input.value.trim();
          if (!/^[a-zA-Z0-9_.]{3,20}$/.test(un)) return (err.textContent = 'اسم المستخدم من 3 إلى 20 حرف إنجليزي أو رقم');
          if (p.input.value.length < 6) return (err.textContent = 'كلمة المرور قصيرة');
          btn.disabled = true;
          try {
            await Auth.register(un, p.input.value, n.input.value.trim() || un, pickAv);
            goHome();
          } catch (e) {
            err.textContent = e.message === 'taken' ? 'اسم المستخدم مأخوذ، اختر غيره' : 'صار خطأ، جرب مرة ثانية';
          }
          btn.disabled = false;
        };
        const btn = h('button', { class: 'btn block', onclick: go }, 'إنشاء الحساب');
        panel.append(u.wrap, p.wrap, n.wrap, h('p', { class: 'note', style: { textAlign: 'start', margin: '-6px 2px 8px' }, text: 'لا تكتب اسمك الكامل ولا أي معلومة شخصية — اختر لقب.' }), h('div', { class: 'sec-title', text: 'صورتك' }), avatarPicker(), err, btn, privacyNote());
      } else {
        const n = field('اسمك في اللعبة', { maxlength: 16, value: '', name: 'nick' });
        const go = async () => {
          const nick = n.input.value.trim();
          if (nick.length < 2) return (err.textContent = 'اكتب اسم من حرفين على الأقل');
          btn.disabled = true;
          try {
            await Auth.guest(nick, pickAv);
            goHome();
          } catch (e) {
            err.textContent = 'صار خطأ، جرب مرة ثانية';
          }
          btn.disabled = false;
        };
        const btn = h('button', { class: 'btn block', onclick: go }, 'ادخل كضيف');
        panel.append(n.wrap, h('div', { class: 'sec-title', text: 'صورتك' }), avatarPicker(), err, btn, h('p', { class: 'note', text: 'حساب الضيف يحفظ تقدمك على هالجهاز. سوّ حساب عشان تدخل من أي جوال.' }), privacyNote());
      }
      return;
    }
    // claude / local / offline server
    const title = Auth.mode === 'claude' ? 'حسابك في Claude يحفظ تقدمك' : Auth.mode === 'server' ? 'نتصل بالسيرفر… تقدر تبدأ أوفلاين الحين' : 'سوّ ملفك وابدأ';
    panel.appendChild(h('div', { class: 'act-title', style: { textAlign: 'center', marginBottom: '12px' } }, h('b', { text: title })));
    const n = field('اسمك في اللعبة', { maxlength: 16, name: 'nick', value: (Auth.user && Auth.user.nick) || Auth.claudeName() || '' });
    const go = async () => {
      const nick = n.input.value.trim();
      if (nick.length < 2) return (err.textContent = 'اكتب اسم من حرفين على الأقل');
      await Auth.guest(nick, pickAv);
      goHome();
    };
    const btn = h('button', { class: 'btn block', onclick: go }, 'ادخل');
    n.input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    panel.append(n.wrap, h('div', { class: 'sec-title', text: 'صورتك' }), avatarPicker((Auth.user && Auth.user.av) || N.AVATARS[0]), err, btn);
    if (Auth.mode === 'claude') {
      Auth.on('claude', () => {
        if (current === 'login' && !n.input.value && Auth.claudeName()) n.input.value = Auth.claudeName().split(' ')[0].slice(0, 16);
      });
    }
  }

  /* ---------------- home ---------------- */
  function goHome() {
    show('home');
    renderHome();
    if (pendingRoom) {
      const code = pendingRoom;
      pendingRoom = null;
      openOnline('join', code);
    }
  }
  function renderHome() {
    const u = Auth.user;
    if (!u) return renderLogin();
    const st = Object.assign(N.blankStats(), u.stats || {});
    const lv = N.levelOf(st.xp);
    const top = $('#home-top');
    top.innerHTML = '';
    top.append(
      U.avatar({ av: u.av, lv: lv.lv }, { lg: true }),
      h(
        'div',
        { class: 'who' },
        h('div', { class: 'name' }, u.nick, u.guest && Auth.mode === 'server' ? h('span', { class: 'badge-off', text: 'ضيف' }) : null),
        h('div', { class: 'xp' }, h('i', { style: { width: lv.pct + '%' } })),
        h('div', { class: 'meta', text: 'المستوى ' + lv.lv + ' · ' + st.xp + ' خبرة' })
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'تعديل الملف', onclick: profileSheet }, '✎')
    );
    const rate = st.games ? Math.round((st.wins / st.games) * 100) : 0;
    $('#home-stats').innerHTML = '';
    $('#home-stats').append(h('span', null, 'صكات ', h('b', { text: st.games })), h('span', null, 'فوز ', h('b', { text: st.wins })), h('span', null, 'نسبة الفوز ', h('b', { text: rate + '%' })), h('span', null, 'كبوت ', h('b', { text: st.kaboot })));
    const modes = $('#home-modes');
    modes.innerHTML = '';
    const online = Auth.canOnline();
    modes.append(
      h('button', { class: 'mode primary', onclick: offlineSetup }, h('div', { class: 'ic', html: A.suitIcon('S', 30) }), h('div', null, h('div', { class: 't', text: 'العب ضد الكمبيوتر' }), h('div', { class: 'd', text: 'بدون نت — ثلاث مستويات صعوبة' }))),
      h(
        'button',
        { class: 'mode', onclick: () => (online ? openOnline('quick') : U.toast(Auth.onlineReason(), 2600)) },
        h('div', { class: 'ic', html: A.suitIcon('H', 30) }),
        h('div', null, h('div', { class: 't' }, 'العب أونلاين', online ? null : h('span', { class: 'badge-off', text: 'غير متاح' })), h('div', { class: 'd', text: Auth.mode === 'claude' ? 'طاولات مفتوحة الحين' : 'ندور لك لاعبين، واللي ناقص يكمله كمبيوتر' }))
      ),
      h(
        'button',
        { class: 'mode', onclick: () => (online ? openOnline('friends') : U.toast(Auth.onlineReason(), 2600)) },
        h('div', { class: 'ic', html: A.suitIcon('C', 30) }),
        h('div', null, h('div', { class: 't', text: 'غرفة مع الربع' }), h('div', { class: 'd', text: 'افتح غرفة بكود وارسله لأصحابك' }))
      )
    );
    const row = $('#home-row');
    row.innerHTML = '';
    row.append(h('button', { class: 'btn ghost', onclick: leaderboard }, '🏆 الترتيب'), h('button', { class: 'btn ghost', onclick: settingsSheet }, '⚙ الإعدادات'), h('button', { class: 'btn ghost', onclick: rulesSheet }, '📖 القوانين'));
  }

  function profileSheet() {
    const u = Auth.user;
    U.modal((sh, m) => {
      sh.appendChild(h('h2', { text: 'ملفك' }));
      const n = field('اسمك في اللعبة', { maxlength: 16, value: u.nick, name: 'profile-nick' });
      const body = h('div', { class: 'body' }, n.wrap, h('div', { class: 'sec-title', text: 'صورتك' }), avatarPicker(u.av));
      sh.appendChild(body);
      sh.appendChild(
        h(
          'div',
          { class: 'foot' },
          h('button', { class: 'btn ghost', onclick: () => m.close() }, 'إلغاء'),
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                const nick = n.input.value.trim();
                if (nick.length < 2) return U.toast('الاسم قصير');
                await Auth.saveProfile(nick, pickAv);
                m.close();
                renderHome();
              },
            },
            'حفظ'
          )
        )
      );
    });
  }

  /* ---------------- offline ---------------- */
  function offlineSetup() {
    S.unlock();
    let level = settings.level;
    let target = settings.target;
    U.modal((sh, m) => {
      sh.appendChild(h('h2', { text: 'ضد الكمبيوتر' }));
      const body = h('div', { class: 'body' });
      body.appendChild(h('div', { class: 'sec-title', text: 'مستوى اللاعبين' }));
      const lv = h('div', { class: 'opts' });
      [['easy', 'سهل', 'للتعلم'], ['medium', 'متوسط', 'لعب طبيعي'], ['hard', 'صعب', 'يحسب الورق']].forEach(([k, t, d]) => {
        const b = h('button', { class: 'opt' + (k === level ? ' on' : ''), onclick: () => {
          level = k;
          lv.querySelectorAll('.opt').forEach((x) => x.classList.toggle('on', x === b));
        } }, t, h('small', { text: d }));
        lv.appendChild(b);
      });
      body.appendChild(lv);
      body.appendChild(h('div', { class: 'sec-title', text: 'الصكة إلى' }));
      const tg = h('div', { class: 'opts' });
      [[152, '152', 'صكة كاملة'], [102, '102', 'أقصر'], [52, '52', 'سريعة']].forEach(([k, t, d]) => {
        const b = h('button', { class: 'opt' + (k === target ? ' on' : ''), onclick: () => {
          target = k;
          tg.querySelectorAll('.opt').forEach((x) => x.classList.toggle('on', x === b));
        } }, t, h('small', { text: d }));
        tg.appendChild(b);
      });
      body.appendChild(tg);
      sh.appendChild(body);
      sh.appendChild(
        h(
          'div',
          { class: 'foot' },
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                saveSettings({ level, target });
                m.close();
                startOffline(level, target);
              },
            },
            'ابدأ الصكة'
          )
        )
      );
    });
  }

  let session = null;
  function startOffline(level, target, saved) {
    const s = new N.LocalSession({ me: Auth.user, level, target, speed: settings.speed, players: saved && saved.players });
    enterGame(s, s.players);
    if (saved && saved.st) s.resume(saved.st);
    else s.start();
  }
  // keep an offline game across a republish of the page (Claude viewer only)
  function hotState() {
    if (session && session.kind === 'offline' && session.host && session.host.st && session.host.st.phase !== 'gameEnd') {
      return { offline: { st: session.host.st, players: session.players, level: session.level, target: session.host.target } };
    }
    return {};
  }

  function gameCtx(players) {
    return {
      players,
      settings,
      saveSettings,
      showRules: rulesSheet,
      showSettings: settingsSheet,
      onExit: exitGame,
      onGameEnd: async (r) => {
        if (Auth.mode === 'server' && r.mode === 'online') {
          setTimeout(() => Auth.refresh(), 800);
          const before = (Auth.user && Auth.user.stats && Auth.user.stats.xp) || 0;
          await new Promise((res) => setTimeout(res, 900));
          await Auth.refresh();
          const after = (Auth.user && Auth.user.stats && Auth.user.stats.xp) || before;
          return Math.max(0, after - before);
        }
        return Auth.addResult(r);
      },
    };
  }
  function enterGame(s, players) {
    session = s;
    show('game');
    window.BalootGame.open(s, gameCtx(players));
    if (Auth.mode === 'server' && location.hash !== '#play') {
      try {
        history.pushState({ g: 1 }, '', '#play');
      } catch (e) {
        /* ignore */
      }
    }
  }
  function exitGame() {
    U.closeAllModals();
    if (session) session.leave();
    session = null;
    window.BalootGame.close();
    if (Auth.mode === 'server' && location.hash === '#play') {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (e) {
        /* ignore */
      }
    }
    goHome();
  }
  window.addEventListener('popstate', () => {
    if (current === 'game' && Auth.mode === 'server') {
      try {
        history.pushState({ g: 1 }, '', '#play');
      } catch (e) {
        /* ignore */
      }
      $('#btn-menu').click();
    }
  });

  /* ---------------- online ---------------- */
  let lobbyOff = null;
  let pendingRoom = null;
  function openOnline(mode, code) {
    S.unlock();
    show('lobby');
    const body = $('#lobby-body');
    const foot = $('#lobby-foot');
    body.innerHTML = '';
    foot.innerHTML = '';
    $('#lobby-back').onclick = () => {
      if (session) session.leave();
      session = null;
      if (lobbyOff) lobbyOff();
      lobbyOff = null;
      goHome();
    };
    if (Auth.mode === 'server') {
      const s = new N.WsSession();
      session = s;
      wireRoom(s);
      if (mode === 'quick') {
        $('#lobby-title').textContent = 'العب أونلاين';
        quickSearch(s);
      } else if (mode === 'join') {
        $('#lobby-title').textContent = 'غرفة';
        s.join(code);
      } else {
        friendsMenu(s);
      }
      return;
    }
    // Claude rooms
    $('#lobby-title').textContent = mode === 'quick' ? 'طاولات مفتوحة' : 'غرفة مع الربع';
    const list = h('div', { class: 'tables-list' });
    body.append(h('p', { class: 'note', style: { margin: '0 18px 10px' }, text: 'ادخل طاولة مفتوحة، أو افتح طاولتك وخل ربعك يدخلون بالكود.' }), list);
    list.append(h('div', { class: 'note', text: 'جاري البحث عن طاولات…' }));
    if (lobbyOff) lobbyOff();
    lobbyOff = N.RoomSession.lobby((tables) => {
      if (current !== 'lobby' || (session && session.status && session.status !== 'idle')) return;
      list.innerHTML = '';
      if (tables === null) return list.append(h('div', { class: 'note', text: Auth.onlineReason() }));
      if (!tables.length) return list.append(h('div', { class: 'note', text: 'ما فيه طاولات مفتوحة الحين — افتح وحدة!' }));
      tables.forEach((t) =>
        list.append(
          h('button', { class: 'table-item', onclick: () => joinClaude(t.code) }, U.avatar({ av: t.av }, { noLv: true }), h('div', { class: 'grow' }, h('b', { text: 'طاولة ' + t.host }), h('div', { class: 'note', style: { textAlign: 'start' }, text: t.n + ' من 4 لاعبين' })), h('span', { class: 'btn small', text: 'ادخل' }))
        )
      );
    });
    foot.append(h('button', { class: 'btn ghost', onclick: () => askCode((c) => joinClaude(c)) }, 'ادخل بكود'), h('button', { class: 'btn', onclick: createClaude }, 'افتح طاولة'));
    if (mode === 'join' && code) joinClaude(code);
  }
  function createClaude() {
    if (lobbyOff) lobbyOff();
    lobbyOff = null;
    const s = new N.RoomSession(Auth.user);
    session = s;
    wireRoom(s);
    s.create();
  }
  function joinClaude(code) {
    if (lobbyOff) lobbyOff();
    lobbyOff = null;
    const s = new N.RoomSession(Auth.user);
    session = s;
    wireRoom(s);
    $('#lobby-body').innerHTML = '';
    $('#lobby-body').append(h('div', { class: 'search-box' }, h('div', { class: 'loader' }), h('div', { text: 'ندخلك الغرفة ' + code + '…' })));
    $('#lobby-foot').innerHTML = '';
    s.join(code);
  }
  function askCode(cb) {
    U.modal((sh, m) => {
      sh.appendChild(h('h2', { text: 'ادخل كود الغرفة' }));
      const f = field('الكود', { maxlength: 4, dir: 'ltr', name: 'room-code', style: { textAlign: 'center', letterSpacing: '8px', fontSize: '26px', textTransform: 'uppercase' } });
      sh.appendChild(h('div', { class: 'body' }, f.wrap));
      const go = () => {
        const c = f.input.value.trim().toUpperCase();
        if (c.length !== 4) return U.toast('الكود 4 حروف');
        m.close();
        cb(c);
      };
      f.input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      sh.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: go }, 'دخول')));
      setTimeout(() => f.input.focus(), 150);
    });
  }
  function friendsMenu(s) {
    $('#lobby-title').textContent = 'غرفة مع الربع';
    const body = $('#lobby-body');
    body.innerHTML = '';
    body.append(h('div', { class: 'modes' }, h('button', { class: 'mode primary', onclick: () => s.create() }, h('div', { class: 'ic', html: A.suitIcon('D', 30) }), h('div', null, h('div', { class: 't', text: 'افتح غرفة جديدة' }), h('div', { class: 'd', text: 'ياخذ كود ترسله لربعك' }))), h('button', { class: 'mode', onclick: () => askCode((c) => s.join(c)) }, h('div', { class: 'ic', html: A.suitIcon('C', 30) }), h('div', null, h('div', { class: 't', text: 'ادخل بكود' }), h('div', { class: 'd', text: 'إذا عندك كود غرفة من صاحبك' })))));
  }
  let searchModal = null;
  function quickSearch(s) {
    const t0 = Date.now();
    let tick = null;
    searchModal = U.modal(
      (sh, m) => {
        sh.appendChild(h('h2', { text: 'ندور لك لاعبين' }));
        const tm = h('div', { class: 'timer-big', text: '00:00' });
        const info = h('div', { class: 'note', text: 'إذا ما اكتملت الطاولة، يكملها لاعب كمبيوتر' });
        sh.appendChild(h('div', { class: 'search-box' }, h('div', { class: 'search-vs' }, U.avatar(Auth.user, { lg: true, noLv: true }), h('div', { class: 'vs', text: 'VS' }), h('div', { class: 'av lg', style: { background: '#47291b' }, text: '❔' })), tm, info));
        sh.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn red', onclick: () => m.close() }, 'إلغاء')));
        tick = setInterval(() => {
          const sec = Math.floor((Date.now() - t0) / 1000);
          tm.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
        }, 500);
        s.on('queue', (q) => {
          info.textContent = q.n > 1 ? 'لقينا ' + q.n + ' لاعبين…' : 'إذا ما اكتملت الطاولة، يكملها لاعب كمبيوتر';
        });
      },
      {
        sticky: true,
        center: true,
        onClose: () => {
          clearInterval(tick);
          searchModal = null;
          if (session === s && (!s.room || s.room.status !== 'play')) {
            s.cancelQuick();
            s.leave();
            session = null;
            goHome();
          }
        },
      }
    );
    s.quick();
  }

  function wireRoom(s) {
    s.on('room', (room) => {
      if (room.status === 'play') {
        if (searchModal) {
          const m = searchModal;
          searchModal = null;
          m.close();
        }
        if (current !== 'game') enterGame(s, playersOf(room));
        return;
      }
      renderRoom(s, room);
    });
    s.on('error', (e) => {
      if (current !== 'game') U.toast(typeof e === 'string' && e.length > 12 ? e : 'صار خطأ: ' + e, 2600);
    });
    s.on('closed', (why) => {
      if (current === 'lobby') {
        U.toast(why === 'host_left' ? 'صاحب الغرفة طلع' : 'طلعت من الغرفة');
        goHome();
      }
    });
  }
  function playersOf(room) {
    return room.seats.map((p, i) => (p ? { name: p.name, av: p.av, lv: p.lv, bot: !!p.bot, me: i === room.you, away: p.away } : { name: '…', av: '❔', empty: true }));
  }
  function renderRoom(s, room) {
    if (current !== 'lobby') show('lobby');
    $('#lobby-title').textContent = 'الغرفة';
    const body = $('#lobby-body');
    body.innerHTML = '';
    const codeBox = h('div', { class: 'room-code' }, h('div', { class: 'c', text: room.code }), h('div', { class: 'h', text: 'أرسل الكود لربعك عشان يدخلون' }));
    if (navigator.clipboard) {
      codeBox.appendChild(
        h(
          'button',
          {
            class: 'btn small ghost',
            style: { marginTop: '8px' },
            onclick: () => {
              const link = Auth.mode === 'server' ? location.origin + '/#r-' + room.code : room.code;
              navigator.clipboard.writeText(Auth.mode === 'server' ? 'تعال العب بلوت معي 🃏 ' + link : room.code).then(() => U.toast('تم النسخ'), () => U.toast(room.code));
            },
          },
          Auth.mode === 'server' ? 'انسخ رابط الدعوة' : 'انسخ الكود'
        )
      );
    }
    body.appendChild(codeBox);
    const grid = h('div', { class: 'seats-grid' });
    const seatCard = (i) => {
      const p = room.seats[i];
      const team = i % 2;
      const card = h('button', { class: 'seat-card team' + team + (p ? '' : ' empty') });
      if (p) {
        card.append(U.avatar(p), h('div', { class: 'n', text: p.name + (i === room.you ? ' (أنت)' : '') }), h('div', { class: 's', text: p.bot ? 'كمبيوتر — المسه للحذف' : i === 0 ? 'صاحب الغرفة' : 'جاهز' }));
        if (p.bot && room.host) card.onclick = () => s.setBot(i, false);
        else if (!p.bot && i !== room.you && room.host) card.onclick = () => {};
      } else {
        card.append(h('div', { class: 'av', text: '+' }), h('div', { class: 'n', text: 'مكان فاضي' }), h('div', { class: 's', text: room.host ? 'المس لإضافة كمبيوتر' : 'بانتظار لاعب' }));
        if (room.host) card.onclick = () => s.setBot(i, true);
        else if (s.seat) card.onclick = () => s.seat(i);
      }
      return card;
    };
    grid.append(h('div', { class: 'team-label', text: 'فريق أ (متقابلين)' }), seatCard(0), seatCard(2), h('div', { class: 'team-label', text: 'فريق ب' }), seatCard(1), seatCard(3));
    body.appendChild(grid);
    const foot = $('#lobby-foot');
    foot.innerHTML = '';
    if (room.host) {
      const humans = room.seats.filter((p) => p && !p.bot).length;
      foot.append(h('button', { class: 'btn', onclick: () => s.begin() }, humans < 4 ? 'ابدأ (الباقي كمبيوتر)' : 'ابدأ اللعب'));
    } else {
      foot.append(h('div', { class: 'note', style: { flex: 1 }, text: 'بانتظار صاحب الغرفة يبدأ اللعبة…' }));
    }
  }

  /* ---------------- sheets ---------------- */
  function settingsSheet() {
    const wasOffline = session && session.kind === 'offline';
    U.modal(
      (sh, m) => {
        sh.appendChild(h('h2', { text: 'الإعدادات' }));
        const body = h('div', { class: 'body' });
        const sw = (label, key, after) => {
          const b = h('button', { class: 'switch' + (settings[key] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!settings[key]), 'aria-label': label });
          b.onclick = () => {
            saveSettings({ [key]: !settings[key] });
            b.classList.toggle('on', !!settings[key]);
            b.setAttribute('aria-checked', String(!!settings[key]));
            if (after) after();
          };
          return h('div', { class: 'row-set' }, h('span', { text: label }), b);
        };
        body.append(sw('الصوت', 'sound'), sw('الاهتزاز', 'vib'), sw('العب الورقة بلمسة وحدة', 'oneTap'), sw('أعلن المشاريع تلقائياً', 'autoProj'), sw('تلميحات اللعب', 'hints'));
        body.appendChild(h('div', { class: 'sec-title', text: 'سرعة الكمبيوتر' }));
        const sp = h('div', { class: 'opts' });
        [[1.4, 'هادي'], [1, 'عادي'], [0.6, 'سريع']].forEach(([k, t]) => {
          const b = h('button', { class: 'opt' + (settings.speed === k ? ' on' : ''), onclick: () => {
            saveSettings({ speed: k });
            sp.querySelectorAll('.opt').forEach((x) => x.classList.toggle('on', x === b));
          } }, t);
          sp.appendChild(b);
        });
        body.appendChild(sp);
        if (Auth.user) {
          body.appendChild(h('div', { class: 'sec-title', text: 'الحساب' }));
          const acct = Auth.mode === 'server' ? (Auth.user.guest ? 'ضيف: ' + Auth.user.nick : 'مسجل باسم: ' + (Auth.user.username || Auth.user.nick)) : Auth.mode === 'claude' ? 'محفوظ بحسابك في Claude' : 'محفوظ على هالجهاز';
          body.appendChild(h('div', { class: 'row-set' }, h('span', { text: acct })));
          if (current !== 'game') {
            if (Auth.mode === 'server') body.appendChild(h('div', { class: 'row-set' }, h('a', { href: '/privacy.html', style: { color: 'var(--saffron-hi)' } }, 'سياسة الخصوصية')));
            body.appendChild(
              h(
                'button',
                {
                  class: 'btn ghost block',
                  style: { marginTop: '12px', color: '#ff9a8f' },
                  onclick: () => {
                    m.close();
                    deleteAccountSheet();
                  },
                },
                'حذف حسابي'
              )
            );
            body.appendChild(
              h(
                'button',
                {
                  class: 'btn ghost block',
                  style: { marginTop: '12px' },
                  onclick: () =>
                    U.confirmBox('تبي تسجل خروج؟', 'خروج', 'لا', async () => {
                      m.close();
                      await Auth.logout();
                      renderLogin();
                    }, true),
                },
                'تسجيل خروج'
              )
            );
          }
        }
        sh.appendChild(body);
        sh.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => m.close() }, 'تمام')));
      },
      { onClose: () => wasOffline && session && session.pause(false) }
    );
  }

  function deleteAccountSheet() {
    const u = Auth.user;
    const needPw = Auth.mode === 'server' && u && !u.guest;
    U.modal(
      (sh, m) => {
        sh.appendChild(h('h2', { text: 'حذف الحساب' }));
        const body = h('div', { class: 'body' });
        body.appendChild(h('p', { class: 'note', style: { textAlign: 'start', fontSize: '15px' }, text: 'ينحذف حسابك وكل بياناته (الاسم والصورة والإحصائيات والترتيب) نهائياً، وما نقدر نرجعه.' }));
        const pw = needPw ? field('كلمة المرور للتأكيد', { type: 'password', name: 'delete-password', autocomplete: 'current-password' }) : null;
        if (pw) body.appendChild(pw.wrap);
        const err = h('div', { class: 'err', role: 'alert' });
        body.appendChild(err);
        sh.appendChild(body);
        const del = h(
          'button',
          {
            class: 'btn red',
            onclick: async () => {
              err.textContent = '';
              del.disabled = true;
              try {
                await Auth.deleteAccount(pw ? pw.input.value : '');
                m.close();
                U.toast('انحذف حسابك');
                renderLogin();
              } catch (e) {
                err.textContent = e.message === 'bad_password' ? 'كلمة المرور غلط' : 'ما قدرنا نحذف الحساب الحين، جرب بعدين';
                del.disabled = false;
              }
            },
          },
          'احذف حسابي نهائياً'
        );
        sh.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'إلغاء'), del));
      },
      { center: true }
    );
  }

  function rulesSheet() {
    U.modal((sh, m) => {
      sh.appendChild(h('h2', { text: 'قوانين البلوت' }));
      const r = h('div', { class: 'body rules' });
      r.innerHTML = `
        <h3>اللعبة</h3>
        <ul><li>أربعة لاعبين، كل اثنين متقابلين فريق، واللعب عكس عقارب الساعة.</li>
        <li>32 ورقة من السبعة للإكة. أول فريق يوصل 152 يفوز بالصكة.</li></ul>
        <h3>التوزيع والشراء</h3>
        <ul><li>كل لاعب ياخذ 5 أوراق وتنكشف ورقة في النص.</li>
        <li><b>اللفة الأولى:</b> حكم (نوع الورقة المكشوفة يصير الحكم)، صن (بدون حكم)، أشكل (صن والورقة لخويك — للاعب الثالث والموزع، ومو على الإكة)، أو بس.</li>
        <li>الصن أقوى من الحكم: إذا أحد قال حكم يقدر غيره يقلبها صن، واللي قال حكم يأكد أو يقلبها صن.</li>
        <li><b>اللفة الثانية:</b> إذا الكل قال بس تقدر تختار حكم بنوع ثاني أو صن، أو ولا. إذا الكل قال ولا يتوزع الورق من جديد.</li>
        <li>المشتري ياخذ الورقة المكشوفة وورقتين، والباقين 3 أوراق.</li></ul>
        <h3>الدبل</h3>
        <ul><li>في الحكم يقدر الخصم يقول دبل (×2)، ويرد المشتري ثري (×3)، ثم فور (×4)، ثم قهوة (اللي يفوز ياخذ الصكة كلها).</li>
        <li>المقفول: ما تبدأ بورقة حكم إلا إذا ما عندك غير حكم.</li>
        <li>في الصن الدبل مسموح بس إذا فريق المشتري فوق 100 والخصم تحت 100.</li></ul>
        <h3>اللعب</h3>
        <ul><li>اللي على يمين الموزع يبدأ أول أكلة، واللي ياكل يبدأ اللي بعدها.</li>
        <li>لازم تنزل من نفس النوع إذا عندك.</li>
        <li>في الحكم: إذا ما عندك النوع لازم تدق بالحكم، وإذا الخصم داق لازم تعلّي عليه إذا تقدر. ما يلزمك تدق إذا الأكلة لخويك وأنت آخر واحد، أو خويك نزل أكبر ورقة باقية.</li>
        <li>إذا انلعب حكم والخصم ماسك الأكلة، لازم تنزل حكم أكبر إذا عندك.</li>
        <li><b>سوا:</b> إذا دورك تبدأ وأوراقك (مع خويك) تاكل كل الباقي مهما لعب الخصم، يطلع لك زر سوا وتنتهي الجولة لصالحكم.</li></ul>
        <h3>ترتيب الورق وقيمته (الأبناط)</h3>
        <table><tr><th>الصن والأنواع الثانية</th><th>البنط</th><th>الحكم</th><th>البنط</th></tr>
        <tr><td>إكة</td><td>11</td><td>ولد</td><td>20</td></tr>
        <tr><td>10</td><td>10</td><td>9</td><td>14</td></tr>
        <tr><td>شايب</td><td>4</td><td>إكة</td><td>11</td></tr>
        <tr><td>بنت</td><td>3</td><td>10</td><td>10</td></tr>
        <tr><td>ولد</td><td>2</td><td>شايب</td><td>4</td></tr>
        <tr><td>9، 8، 7</td><td>0</td><td>بنت</td><td>3</td></tr></table>
        <p>آخر أكلة عليها 10 أبناط (الأرض).</p>
        <h3>المشاريع</h3>
        <table><tr><th>المشروع</th><th>حكم</th><th>صن</th></tr>
        <tr><td>سرا: 3 ورق ورا بعض</td><td>2</td><td>4</td></tr>
        <tr><td>خمسين: 4 ورا بعض</td><td>5</td><td>10</td></tr>
        <tr><td>مية: 5 ورا بعض أو أربع (10، ولد، بنت، شايب)</td><td>10</td><td>20</td></tr>
        <tr><td>أربعمية: أربع إكك</td><td>(مية)</td><td>40</td></tr>
        <tr><td>بلوت: الشايب والبنت من الحكم</td><td>2</td><td>—</td></tr></table>
        <p>تنعلن المشاريع مع أول ورقة، والفريق اللي عنده أكبر مشروع ياخذ مشاريعه كلها. البلوت ينحسب لما تنزل الورقة الثانية.</p>
        <h3>الحساب</h3>
        <ul><li>الحكم: المجموع 162 بنط = 16 نقطة. الصن: 130 بنط = 26 نقطة.</li>
        <li>لازم فريق المشتري يجيب أكثر من الخصم، وإلا تصير <b>خسرانة</b> وتروح النقاط كلها للخصم.</li>
        <li><b>الكبوت</b> (كل الأكلات): الحكم 25 والصن 44.</li></ul>`;
      sh.appendChild(r);
      sh.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => m.close() }, 'تمام')));
    });
  }

  async function leaderboard() {
    const md = U.modal((sh, m) => {
      sh.appendChild(h('h2', { text: 'الترتيب' }));
      sh.appendChild(h('div', { class: 'body', id: 'lb-body' }, h('div', { class: 'note', text: 'جاري التحميل…' })));
      sh.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => m.close() }, 'تمام')));
    });
    let list = null;
    try {
      list = await Auth.leaderboard();
    } catch (e) {
      list = null;
    }
    const body = md.el.querySelector('#lb-body');
    if (!body) return;
    body.innerHTML = '';
    if (!list || !list.length) {
      const st = Object.assign(N.blankStats(), (Auth.user && Auth.user.stats) || {});
      body.append(h('div', { class: 'note', text: list ? 'ما فيه لاعبين بالترتيب بعد — العب أونلاين وتصدّر!' : 'الترتيب يشتغل مع الحسابات أونلاين.' }));
      body.append(h('div', { class: 'lb-row' }, h('span', { class: 'rk', text: '—' }), U.avatar({ av: Auth.user.av }, { noLv: true }), h('span', { class: 'nm', text: Auth.user.nick }), h('span', { class: 'sc', text: st.wins + ' فوز من ' + st.games })));
      return;
    }
    list.forEach((p, i) => {
      body.append(h('div', { class: 'lb-row' }, h('span', { class: 'rk', text: i + 1 }), U.avatar({ av: p.av }, { noLv: true }), h('span', { class: 'nm', text: p.nick || p.name || 'لاعب' }), h('span', { class: 'sc', text: (p.wins || 0) + ' فوز · ' + 'مستوى ' + N.levelOf(p.xp || 0).lv })));
    });
  }

  /* ---------------- boot ---------------- */
  async function boot(hotData) {
    decor();
    try {
      if (window.claude && window.claude.hot && window.claude.hot.snapshot) window.claude.hot.snapshot(() => JSON.parse(JSON.stringify(hotState())));
    } catch (e) {
      /* ignore */
    }
    const m = /^#r-([A-Za-z0-9]{4})$/.exec(location.hash || '');
    if (m) pendingRoom = m[1].toUpperCase();
    const t0 = Date.now();
    let user = null;
    try {
      user = await Auth.init();
    } catch (e) {
      user = null;
    }
    const wait = Math.max(0, 700 - (Date.now() - t0));
    setTimeout(() => {
      const saved = hotData && hotData.offline;
      if (user && saved && saved.st) {
        show('home');
        renderHome();
        startOffline(saved.level, saved.target, saved);
      } else if (user) goHome();
      else renderLogin();
    }, wait);
    Auth.on('user', () => {
      if (current === 'home') renderHome();
    });
    Auth.on('claude', () => {
      if (current === 'home') renderHome();
    });
    Auth.on('server', () => {
      if (current === 'home') renderHome();
      else if (current === 'login' && !Auth.user) renderLogin();
    });
    document.addEventListener('pointerdown', () => S.unlock(), { once: true });
    if ('serviceWorker' in navigator && Auth.mode === 'server') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  function start() {
    const hot = window.claude && window.claude.hot;
    if (hot && typeof hot.ready === 'function') hot.ready((data) => boot(data || {}));
    else boot((hot && hot.data) || {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.BalootApp = { settings, saveSettings, show, goHome };
})();
