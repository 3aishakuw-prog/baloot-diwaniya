/* Tiny synthesized sound set (no audio files needed) + vibration. */
(function () {
  'use strict';
  let ctx = null;
  let noiseBuf = null;
  const S = { on: true, vib: true };

  function ac() {
    if (!S.on) return null;
    try {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) {
      return null;
    }
  }

  function noise(t0, dur, freq, q, gain, sweepTo) {
    const c = ac();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }
  function tone(t0, dur, freq, gain, type) {
    const c = ac();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  const now = () => (ac() ? ctx.currentTime : 0);

  const play = {
    card() {
      const t = now();
      if (!ctx) return;
      noise(t, 0.07, 2600, 1.2, 0.5);
      noise(t + 0.01, 0.05, 900, 1, 0.25);
    },
    deal() {
      const t = now();
      if (!ctx) return;
      for (let i = 0; i < 8; i++) noise(t + i * 0.055, 0.045, 3000 + Math.random() * 600, 1.4, 0.18);
    },
    collect() {
      const t = now();
      if (!ctx) return;
      noise(t, 0.28, 600, 0.8, 0.22, 2400);
    },
    tick() {
      const t = now();
      if (!ctx) return;
      tone(t, 0.09, 320, 0.18, 'triangle');
    },
    turn() {
      const t = now();
      if (!ctx) return;
      tone(t, 0.16, 784, 0.12);
      tone(t + 0.1, 0.22, 1046, 0.1);
    },
    bid() {
      const t = now();
      if (!ctx) return;
      tone(t, 0.12, 440, 0.12, 'triangle');
    },
    big() {
      const t = now();
      if (!ctx) return;
      [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.08, 0.3, f, 0.12, 'triangle'));
    },
    good() {
      const t = now();
      if (!ctx) return;
      [587, 740, 880].forEach((f, i) => tone(t + i * 0.1, 0.32, f, 0.12));
    },
    bad() {
      const t = now();
      if (!ctx) return;
      [440, 370, 311].forEach((f, i) => tone(t + i * 0.13, 0.36, f, 0.11, 'triangle'));
    },
    win() {
      const t = now();
      if (!ctx) return;
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(t + i * 0.11, 0.45, f, 0.12, 'triangle'));
    },
    err() {
      const t = now();
      if (!ctx) return;
      tone(t, 0.12, 180, 0.15, 'square');
    },
  };

  function vib(ms) {
    if (!S.vib) return;
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {
      /* ignore */
    }
  }

  window.BalootSound = {
    settings: S,
    play(name) {
      try {
        if (S.on && play[name]) play[name]();
      } catch (e) {
        /* ignore */
      }
    },
    vib,
    unlock() {
      ac();
    },
  };
})();
