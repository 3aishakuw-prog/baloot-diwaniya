/* DOM helpers, modals, toasts, avatars and Arabic labels shared by the screens. */
(function () {
  'use strict';
  const N = () => window.BalootNet;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);

  function avBg(av) {
    const i = N().AVATARS.indexOf(av);
    return N().AV_BG[(i >= 0 ? i : 0) % N().AV_BG.length];
  }
  function avatar(p, opts) {
    opts = opts || {};
    const el = h('div', { class: 'av' + (opts.lg ? ' lg' : ''), style: { background: avBg(p.av) } });
    el.appendChild(h('span', { text: p.av || '🦅' }));
    if (p.lv && !opts.noLv) el.appendChild(h('span', { class: 'lvl', text: p.lv }));
    if (p.bot && !opts.noBot) el.appendChild(h('span', { class: 'bot', text: '🤖', title: 'كمبيوتر' }));
    return el;
  }

  let modalStack = [];
  function modal(build, opts) {
    opts = opts || {};
    const root = $('#modal-root');
    const back = h('div', { class: 'modal-back' + (opts.center ? ' center' : '') });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    if (!opts.center) sheet.appendChild(h('div', { class: 'grip' }));
    back.appendChild(sheet);
    const api = {
      el: sheet,
      close() {
        if (!back.parentNode) return;
        back.remove();
        modalStack = modalStack.filter((m) => m !== api);
        if (opts.onClose) opts.onClose();
      },
    };
    build(sheet, api);
    if (!opts.sticky) {
      back.addEventListener('click', (e) => {
        if (e.target === back) api.close();
      });
    }
    root.appendChild(back);
    modalStack.push(api);
    return api;
  }
  function closeAllModals() {
    modalStack.slice().forEach((m) => m.close());
  }
  function confirmBox(text, yes, no, onYes, danger) {
    return modal(
      (s, m) => {
        s.appendChild(h('h2', { text }));
        s.appendChild(
          h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, no || 'لا'), h('button', { class: 'btn ' + (danger ? 'red' : ''), onclick: () => (m.close(), onYes()) }, yes || 'نعم'))
        );
      },
      { center: true }
    );
  }

  function toast(text, ms) {
    const root = $('#toast-root');
    if (!root) return;
    const t = h('div', { class: 'toast', text });
    root.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms || 2200);
    setTimeout(() => t.remove(), (ms || 2200) + 400);
  }

  const L = {
    bid: { hokm: 'حكم', sun: 'صن', ashkal: 'أشكل', hokm2: 'حكم ثاني', confirm: 'حكم', pass1: 'بس', pass2: 'ولا' },
    dbl: { double: 'دبل', doubleLocked: 'دبل مقفول', triple: 'ثري', four: 'فور', fourLocked: 'فور مقفول', gahwa: 'قهوة ☕', pass: 'بس' },
    proj: { sira: 'سرا', '50': 'خمسين', '100': 'مية', '400': 'أربعمية' },
    suit: { S: 'سبيت', H: 'هاص', D: 'ديمن', C: 'شريا' },
    outcome: { made: 'نجح المشتري', fail: 'خسرانة!', kaboot: 'كبوت!', kabootFail: 'كبوت عكسي!' },
    mult: { 2: 'دبل', 3: 'ثري', 4: 'فور' },
    phrases: ['السلام عليكم', 'كفو!', 'يا حلو', 'شد حيلك', 'صح لسانك', 'تكفى ركز', 'الله يعين', 'يا ساتر', 'مشينا', 'هههه', 'زين', 'العب بسرعة'],
    emojis: ['👍', '😂', '😮', '🔥', '👏', '☕', '😅', '🤝', '😎'],
  };

  function suitSym(s) {
    return { S: '♠', H: '♥', D: '♦', C: '♣' }[s] || '';
  }
  function contractText(c) {
    if (!c) return '';
    if (c.type === 'sun') return c.ashkal ? 'أشكل' : 'صن';
    return 'حكم ' + suitSym(c.trump);
  }

  window.BalootUI = { h, $, avatar, avBg, modal, closeAllModals, confirmBox, toast, L, suitSym, contractText };
})();
