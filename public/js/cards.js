/* Card art: original SVG faces, a Sadu-woven back, and table/emblem patterns. */
(function () {
  'use strict';
  const RED = '#b8232b';
  const INK = '#1b1714';
  const GOLD = '#d9a441';
  const SUIT_PATH = {
    H: 'M50 90 C21 66 4 48 4 29 C4 14 15 4 29 4 C39 4 46 10 50 18 C54 10 61 4 71 4 C85 4 96 14 96 29 C96 48 79 66 50 90Z',
    D: 'M50 3 Q68 30 93 50 Q68 70 50 97 Q32 70 7 50 Q32 30 50 3Z',
    S: 'M50 5 C79 30 96 46 96 63 C96 77 86 86 73 86 C64 86 57 82 53 75 C54 85 58 92 67 97 L33 97 C42 92 46 85 47 75 C43 82 36 86 27 86 C14 86 4 77 4 63 C4 46 21 30 50 5Z',
    C: 'M50 7 A20 20 0 1 1 49.9 7 Z M27 40 A20 20 0 1 1 26.9 40 Z M73 40 A20 20 0 1 1 72.9 40 Z M45 55 Q47 82 34 97 L66 97 Q53 82 55 55 Z',
  };
  const isRed = (s) => s === 'H' || s === 'D';
  const RL = { '7': '7', '8': '8', '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

  function pip(s, cx, cy, size, flip, color) {
    const k = size / 100;
    const t = `translate(${cx - 50 * k} ${cy - 50 * k}) scale(${k})`;
    const rot = flip ? ` rotate(180 ${cx} ${cy})` : '';
    if (s === 'C') {
      return `<g transform="${rot ? rot.trim() + ' ' : ''}${t}"><path d="${SUIT_PATH.C}" fill="${color}" fill-rule="nonzero"/></g>`;
    }
    return `<g transform="${rot ? rot.trim() + ' ' : ''}${t}"><path d="${SUIT_PATH[s]}" fill="${color}"/></g>`;
  }

  const PIPS = {
    '7': [[62, 70], [138, 70], [100, 110], [62, 140], [138, 140], [62, 210, 1], [138, 210, 1]],
    '8': [[62, 70], [138, 70], [100, 105], [62, 140], [138, 140], [100, 175, 1], [62, 210, 1], [138, 210, 1]],
    '9': [[62, 66], [138, 66], [62, 113], [138, 113], [100, 140], [62, 167, 1], [138, 167, 1], [62, 214, 1], [138, 214, 1]],
    T: [[62, 66], [138, 66], [100, 92], [62, 113], [138, 113], [62, 167, 1], [138, 167, 1], [100, 188, 1], [62, 214, 1], [138, 214, 1]],
  };

  function cornerIndex(r, s, color) {
    const label = RL[r];
    const fs = label.length > 1 ? 40 : 46;
    const ls = label.length > 1 ? -3 : 0;
    const one = `<text x="${label.length > 1 ? 27 : 26}" y="50" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${fs}" letter-spacing="${ls}" fill="${color}">${label}</text>${pip(s, 26, 76, 26, false, color)}`;
    return `<g>${one}</g><g transform="rotate(180 100 140)">${one}</g>`;
  }

  // Original court designs: K crown, Q rosette, J shield-and-spear, framed in Sadu triangles.
  function courtArt(r, s) {
    const col = isRed(s) ? RED : INK;
    const bg = r === 'K' ? '#7a1a1f' : r === 'Q' ? '#26346a' : '#285c45';
    let teeth = '';
    for (let i = 0; i < 9; i++) {
      const x = 52 + i * 10.7;
      teeth += `<path d="M${x} 46 l5.3 9 l5.3 -9z" fill="${GOLD}"/><path d="M${x} 234 l5.3 -9 l5.3 9z" fill="${GOLD}"/>`;
    }
    let emblem = '';
    if (r === 'K') {
      emblem = `<path d="M62 150 L62 112 L80 130 L100 100 L120 130 L138 112 L138 150 Z" fill="${GOLD}"/>
        <rect x="60" y="152" width="80" height="10" rx="3" fill="${GOLD}"/>
        <circle cx="62" cy="108" r="6" fill="#f3e3bf"/><circle cx="100" cy="95" r="7" fill="#f3e3bf"/><circle cx="138" cy="108" r="6" fill="#f3e3bf"/>
        <path d="M92 138 l8 -10 l8 10 l-8 10z" fill="${bg}"/>`;
    } else if (r === 'Q') {
      let petals = '';
      for (let i = 0; i < 8; i++) petals += `<ellipse cx="100" cy="106" rx="9" ry="22" fill="${i % 2 ? '#f3e3bf' : GOLD}" transform="rotate(${i * 45} 100 128)"/>`;
      emblem = `${petals}<circle cx="100" cy="128" r="12" fill="${bg}" stroke="${GOLD}" stroke-width="4"/>`;
    } else {
      emblem = `<rect x="97" y="86" width="6" height="96" fill="#f3e3bf"/><path d="M100 72 l9 18 h-18z" fill="#f3e3bf"/>
        <path d="M100 104 L132 120 L126 154 L100 172 L74 154 L68 120 Z" fill="${GOLD}"/>
        <path d="M100 116 L120 126 L116 150 L100 160 L84 150 L80 126 Z" fill="${bg}"/>
        <path d="M100 126 l9 12 l-9 12 l-9 -12z" fill="${GOLD}"/>`;
    }
    const suitBadge = `<circle cx="100" cy="203" r="17" fill="#fbf4e3"/>${pip(s, 100, 203, 22, false, col)}`;
    return `<rect x="44" y="40" width="112" height="200" rx="8" fill="${bg}"/>
      <rect x="49" y="45" width="102" height="190" rx="6" fill="none" stroke="${GOLD}" stroke-width="2"/>
      ${teeth}${emblem}${suitBadge}`;
  }

  function aceArt(s) {
    const col = isRed(s) ? RED : INK;
    return `<path d="M100 66 L156 140 L100 214 L44 140 Z" fill="none" stroke="${GOLD}" stroke-width="3"/>
      <path d="M100 80 L145 140 L100 200 L55 140 Z" fill="none" stroke="${col}" stroke-opacity=".25" stroke-width="2"/>
      ${pip(s, 100, 140, 64, false, col)}`;
  }

  function faceSVG(card) {
    const r = card[0];
    const s = card[1];
    const color = isRed(s) ? RED : INK;
    let center = '';
    if (PIPS[r]) center = PIPS[r].map((p) => pip(s, p[0], p[1], 34, false, color)).join('');
    else if (r === 'A') center = aceArt(s);
    else center = courtArt(r, s);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280">
      <rect x="2" y="2" width="196" height="276" rx="16" fill="#fdf8ec" stroke="#cdbf9f" stroke-width="3"/>
      ${center}${cornerIndex(r, s, color)}</svg>`;
  }

  function backSVG() {
    let tri = '';
    for (let i = 0; i < 8; i++) {
      const x = 22 + i * 19.5;
      tri += `<path d="M${x} 122 l9.75 -16 l9.75 16z" fill="#efe4cc"/><path d="M${x} 158 l9.75 16 l9.75 -16z" fill="#efe4cc"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280">
      <defs><pattern id="d" width="22" height="22" patternUnits="userSpaceOnUse">
        <rect width="22" height="22" fill="#82191b"/><path d="M11 3 L19 11 L11 19 L3 11Z" fill="#5a0f12"/><circle cx="11" cy="11" r="2" fill="#e8b05a"/></pattern></defs>
      <rect x="2" y="2" width="196" height="276" rx="16" fill="#fdf8ec" stroke="#cdbf9f" stroke-width="3"/>
      <rect x="12" y="12" width="176" height="256" rx="10" fill="url(#d)"/>
      <rect x="18" y="104" width="164" height="72" fill="#1f1713"/>
      ${tri}
      <rect x="18" y="136" width="164" height="8" fill="#2f6b4f"/>
      <path d="M100 118 L122 140 L100 162 L78 140Z" fill="#d9a441" stroke="#1f1713" stroke-width="3"/>
      <path d="M100 129 L111 140 L100 151 L89 140Z" fill="#82191b"/>
      <rect x="12" y="12" width="176" height="256" rx="10" fill="none" stroke="#efe4cc" stroke-width="3"/></svg>`;
  }

  const uri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/\s{2,}/g, ' '));
  const cache = {};
  function face(card) {
    if (!cache[card]) cache[card] = uri(faceSVG(card));
    return cache[card];
  }
  let backUri = null;
  function back() {
    if (!backUri) backUri = uri(backSVG());
    return backUri;
  }
  function suitIcon(s, size, color) {
    const c = color || (isRed(s) ? RED : INK);
    return `<svg class="suit-ic" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><path d="${SUIT_PATH[s]}" fill="${c}"/></svg>`;
  }

  // Sadu band for the rug border (repeats horizontally)
  function saduBand(h) {
    let s = '';
    const W = 64;
    // saw teeth top and bottom, diamond chain in the middle
    s += `<rect width="${W}" height="${h}" fill="#1d1612"/>`;
    s += `<rect y="0" width="${W}" height="4" fill="#efe4cc"/><rect y="${h - 4}" width="${W}" height="4" fill="#efe4cc"/>`;
    for (let i = 0; i < 4; i++) {
      const x = i * 16;
      s += `<path d="M${x} 4 l8 10 l8 -10z" fill="#c8302f"/><path d="M${x} ${h - 4} l8 -10 l8 10z" fill="#c8302f"/>`;
    }
    const m = h / 2;
    s += `<path d="M0 ${m} L16 ${m - 9} L32 ${m} L16 ${m + 9}Z" fill="#efe4cc"/><path d="M32 ${m} L48 ${m - 9} L64 ${m} L48 ${m + 9}Z" fill="#e0a43a"/>`;
    s += `<path d="M10 ${m} L16 ${m - 4} L22 ${m} L16 ${m + 4}Z" fill="#2f6b4f"/><path d="M42 ${m} L48 ${m - 4} L54 ${m} L48 ${m + 4}Z" fill="#1d1612"/>`;
    return uri(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${s}</svg>`);
  }
  function saduSide(w) {
    let s = `<rect width="${w}" height="40" fill="#1d1612"/>`;
    s += `<path d="M0 0 L${w} 20 L0 40Z" fill="#efe4cc" opacity=".9"/><path d="M${w} 0 L${w * 0.35} 20 L${w} 40Z" fill="#c8302f"/>`;
    return uri(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="40" viewBox="0 0 ${w} 40">${s}</svg>`);
  }
  function fieldPattern() {
    const s = `<rect width="48" height="48" fill="#8e1c1d"/>
      <path d="M0 0h48v1H0z" fill="#7a1517" opacity=".55"/><path d="M0 24h48v1H0z" fill="#a1282a" opacity=".35"/>
      <path d="M24 16 L32 24 L24 32 L16 24Z" fill="#7d1719" opacity=".6"/>`;
    return uri(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${s}</svg>`);
  }
  function emblem(size) {
    // app emblem: Sadu diamond with a spade-heart pair
    return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
      <path d="M60 4 L116 60 L60 116 L4 60Z" fill="#82191b" stroke="#d9a441" stroke-width="4"/>
      <path d="M60 18 L102 60 L60 102 L18 60Z" fill="none" stroke="#efe4cc" stroke-width="2" stroke-dasharray="6 5"/>
      <g transform="translate(33 40) scale(.3)"><path d="${SUIT_PATH.S}" fill="#1d1612"/></g>
      <g transform="translate(57 40) scale(.3)"><path d="${SUIT_PATH.H}" fill="#efe4cc"/></g>
      <path d="M60 78 l8 8 l-8 8 l-8 -8z" fill="#d9a441"/></svg>`;
  }

  window.BalootArt = { face, back, suitIcon, saduBand, saduSide, fieldPattern, emblem, isRed, SUIT_PATH };
})();
