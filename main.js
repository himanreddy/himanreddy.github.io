/* Himan Reddy · portfolio #2 · Tuk the tuk-tuk. Plain JS, no dependencies.
   One rAF loop drives two Tuk rigs (hero + corner companion), reads scrollY,
   and applies spring/lerp smoothing. Everything here is an enhancement:
   with JS off or reduced motion on, the page is complete and static. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mapLin = (v, a, b, c, d) => c + (d - c) * clamp((v - a) / (b - a), 0, 1);
const root = document.documentElement;
const mqRM = matchMedia('(prefers-reduced-motion: reduce)');
const mqFine = matchMedia('(hover: hover) and (pointer: fine)');
let override = false;
const motion = () => !mqRM.matches || override;

/* ---------- spring helpers ---------- */
class Spring {
  constructor(w = 14, z = 1, x = 0) { this.w = w; this.z = z; this.x = x; this.v = 0; this.t = x; }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.w * this.w * (this.t - this.x) - 2 * this.z * this.w * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  }
  acc() { return this.w * this.w * (this.t - this.x) - 2 * this.z * this.w * this.v; }
  kick(v) { this.v += v; }
}
/* unit-step response of a spring, sampled into a CSS linear() easing */
function springCurve(w, z, T = .8, n = 56) {
  const p = []; let x = 0, v = 0; const h = T / n / 8;
  for (let i = 0; i <= n; i++) {
    p.push(+x.toFixed(4));
    for (let k = 0; k < 8; k++) { v += (w * w * (1 - x) - 2 * z * w * v) * h; x += v * h; }
  }
  p[n] = 1; return 'linear(' + p.join(',') + ')';
}
const HAS_LINEAR = window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0,1)');
const easePop = HAS_LINEAR ? springCurve(26, .42, .6) : 'cubic-bezier(.2,1.4,.4,1)';
if (HAS_LINEAR) root.style.setProperty('--spring', springCurve(16, .5, .9));

/* ---------- honk sound (off by default) ---------- */
let soundOn = false, actx = null;
function beepSound(n) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    for (let i = 0; i < n; i++) {
      const t0 = actx.currentTime + i * .2;
      const g = actx.createGain(), f = actx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1500;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.09, t0 + .012);
      g.gain.setValueAtTime(.09, t0 + .1); g.gain.linearRampToValueAtTime(0, t0 + .16);
      [[392, 'sawtooth'], [494, 'square']].forEach(([fr, ty]) => {
        const o = actx.createOscillator(); o.type = ty; o.frequency.value = fr;
        o.connect(f); o.start(t0); o.stop(t0 + .18);
      });
      f.connect(g); g.connect(actx.destination);
    }
  } catch (e) { /* audio is optional */ }
}

/* ---------- shared input state ---------- */
const input = { x: 0, y: 0, has: false, touch: false, touchUntil: 0, stamp: 0, last: performance.now(), sy: scrollY, vel: 0, dy: 0 };
const bump = () => { input.stamp++; input.last = performance.now(); };
let looks = [];          // [data-look] elements, for the companion

/* ---------- the rig ---------- */
const PX = 10.5, PY = 9.5;
class Tuk {
  constructor(svg, o) {
    this.svg = svg; this.kind = o.kind; this.beepEl = o.beep; this.active = false;
    const q = s => svg.querySelector(s);
    this.e = {
      root: q('.t-root'), shadow: q('.t-shadow'), body: q('.t-body'), lamps: q('.t-lamps'), mouth: q('.t-mouth'),
      cab: q('.t-cab'), eyes: q('.t-eyes'), roof: q('.t-roof'), flag: q('.t-flagpt'),
      eyeL: q('.t-eyeL'), eyeR: q('.t-eyeR'), pupL: q('.t-eyeL .t-pup'), pupR: q('.t-eyeR .t-pup'),
      lidL: q('.t-eyeL .t-lid'), lidR: q('.t-eyeR .t-lid'), browL: q('.t-browL'), browR: q('.t-browR'),
      treads: [...svg.querySelectorAll('.tread')]
    };
    this.cache = new Map();
    // springs
    this.pupX = new Spring(15, .82); this.pupY = new Spring(15, .82);
    this.faceX = 0; this.faceY = 0; this.bodyX = 0;
    this.pop = new Spring(20, .5);        // eye widening
    this.brow = new Spring(18, .6);       // -1 sad .. +1 raised
    this.lid = new Spring(30, .9);        // 0 open .. 1 shut (sleepy/yawn)
    this.hop = new Spring(24, .38);       // px up (negative)
    this.nod = new Spring(22, .45);       // head nod
    this.roll = new Spring(11, .7);
    this.flagA = new Spring(14, .6);
    this.spin = new Spring(9, .7);
    this.enter = new Spring(6.6, .52);    // 0 far away .. 1 parked
    this.enterOn = false; this.enterDone = true; this.enterDy = 150;
    this.wheel = 0; this.wheelV = 0;
    this.blinkAt = performance.now() + 2200; this.blinkStart = -1; this.dbl = false;
    this.mouthTemp = null; this.mouthUntil = 0; this.grin = false;
    this.lookEl = null; this.secEl = null;
    this.gazeOv = null; this.glanceStart = 0; this.yawnStart = 0; this.glanced = false; this.yawned = false;
    this.seen = input.stamp; this.sleepy = false;
    this.honks = []; this.sayTimer = 0; this.donut = 0; this.squash = 0;
    this.R = this.kind === 'hero' ? [430, 760] : [700, 1300];
  }
  set(el, key, val) { if (this.cache.get(key) !== val) { this.cache.set(key, val); el.setAttribute('transform', val); } }
  mouth(m) { if (this.svg.dataset.mouth !== m) this.svg.dataset.mouth = m; }

  say(txt, ms = 900) {
    const b = this.beepEl; if (!b) return;
    clearTimeout(this.sayTimer); b.textContent = txt; b.classList.add('show');
    if (motion()) { b.getAnimations().forEach(a => a.cancel()); b.animate([{ transform: 'rotate(-10deg) scale(.2)', opacity: 0 }, { transform: 'rotate(-4deg) scale(1)', opacity: 1 }], { duration: 560, easing: easePop, fill: 'both' }); }
    this.sayTimer = setTimeout(() => {
      if (motion()) { const a = b.animate([{ opacity: 1 }, { opacity: 0, transform: 'rotate(-4deg) scale(.85)' }], { duration: 160, fill: 'forwards' }); a.onfinish = () => { b.classList.remove('show'); a.cancel(); }; }
      else b.classList.remove('show');
    }, ms);
  }
  face(m, ms) { this.mouthTemp = m; this.mouthUntil = performance.now() + ms; }

  honk(tag) {
    const now = performance.now();
    this.honks = this.honks.filter(t => now - t < 1000); this.honks.push(now);
    const n = this.honks.length;
    if (n >= 3) { this.honks.length = 0; this.doDonut(); return; }
    const dbl = n === 2;
    this.say(dbl ? 'BEEP BEEP!' : 'BEEP!', dbl ? 1100 : 850);
    beepSound(dbl ? 2 : 1);
    this.face('ooh', 520);
    if (!motion()) return;
    this.hop.kick(dbl ? -640 : -520); this.pop.kick(dbl ? 22 : 15); this.brow.kick(14);
    this.wheelV += dbl ? 900 : 380;
    this.svg.classList.remove('honking'); void this.svg.getBoundingClientRect(); this.svg.classList.add('honking');
    setTimeout(() => this.svg.classList.remove('honking'), 650);
  }
  doDonut() {
    this.say('VROOM!', 1400); beepSound(2);
    this.face('grin', 1500);
    if (!motion()) return;
    this.spin.x = 0; this.spin.v = 0; this.spin.t = Math.PI * 2; this.donut = 1;
    this.hop.kick(-720); this.wheelV += 2600; this.pop.kick(16);
    this.svg.classList.remove('puffing'); void this.svg.getBoundingClientRect(); this.svg.classList.add('puffing');
  }
  perk() { if (!motion()) return; this.brow.kick(16); this.pop.kick(12); this.nod.kick(-60); }
  startEnter() {
    this.enterOn = true; this.enterDone = false; this.enter.x = 0; this.enter.v = 0; this.enter.t = 1;
    this.greeted = false; this.svg.classList.remove('puffing');
  }

  update(dt, now) {
    const svg = this.svg, e = this.e, mo = motion();
    const rect = svg.getBoundingClientRect();
    if (rect.width < 10) return;
    // ----- input reset / perk -----
    if (this.seen !== input.stamp) {
      this.seen = input.stamp;
      if (this.sleepy) { this.sleepy = false; this.perk(); }
      this.glanced = false; this.yawned = false; this.glanceStart = 0; this.yawnStart = 0; this.gazeOv = null;
    }
    // ----- gaze target -----
    let gx = 0, gy = 0;
    if (mo) {
      const fx = rect.left + rect.width * .5, fy = rect.top + rect.height * .478;
      let tx = null, ty = null, full = false;
      if (this.lookEl) { const r = this.lookEl.getBoundingClientRect(); tx = r.left + r.width / 2; ty = r.top + r.height / 2; full = true; }
      else if (input.has && (mqFine.matches || now < input.touchUntil)) { tx = input.x; ty = input.y; }
      else if (this.kind === 'mini' && this.secEl) { const r = this.secEl.getBoundingClientRect(); tx = r.left + r.width / 2; ty = r.top + r.height / 2; full = true; }
      if (tx !== null) {
        const dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy);
        const f = full ? 1 : mapLin(d, this.R[0], this.R[1], 1, 0);
        gx = clamp(dx / Math.max(rect.width * .6, 140), -1, 1) * f;
        gy = clamp(dy / Math.max(rect.height * .6, 140), -1, 1) * f;
      }
      // idle life (only when nothing has happened for a while)
      const idle = now - input.last;
      if (!this.glanced && idle > 8000 && this.enterDone) { this.glanced = true; this.glanceStart = now; }
      if (this.glanceStart) {
        const t = now - this.glanceStart;
        if (t < 650) { gx = -.9; gy = .05; } else if (t < 1450) { gx = .9; gy = 0; } else this.glanceStart = 0;
      }
      if (!this.yawned && idle > 20000 && this.enterDone) { this.yawned = true; this.yawnStart = now; this.sleepy = true; }
    }
    // yawn timeline
    let lidT = 0, browT = 0, mouthState = null;
    if (this.yawnStart) {
      const t = now - this.yawnStart;
      if (t < 500) lidT = .25; else if (t < 1100) { lidT = .6; mouthState = 'yawn'; browT = -.4; }
      else if (t < 1650) { lidT = 1; mouthState = 'yawn'; browT = -.2; } else if (t < 2500) { lidT = .45; mouthState = 'yawn'; browT = -.3; }
      else if (t < 3200) lidT = .3; else this.yawnStart = 0;
    }
    // ----- blink -----
    if (mo && this.blinkStart < 0 && now > this.blinkAt && !this.yawnStart) { this.blinkStart = now; }
    let blink = 0;
    if (this.blinkStart >= 0) {
      const t = (now - this.blinkStart) / 150;
      if (t >= 1) { this.blinkStart = -1; this.blinkAt = now + (!this.dbl && Math.random() < .2 ? 160 : 3000 + Math.random() * 3000); this.dbl = !this.dbl && this.blinkAt - now < 400; }
      else { const s = t < .5 ? t * 2 : 2 - t * 2; blink = s * s * (3 - 2 * s); }
    }
    // ----- enter (drive-in from the horizon) -----
    let es = 1, edy = 0;
    if (this.enterOn && !this.enterDone && mo) {
      const p0 = this.enter.x;
      this.enter.step(dt);
      const p = this.enter.x, dp = p - p0;
      this.wheel += dp * 520;
      const a = this.enter.acc();
      this.squash = clamp(a * .0034, -.085, .085);
      es = .16 + .84 * p; edy = -(1 - p) * this.enterDy;
      if (!this.greeted && p > .985 && Math.abs(this.enter.v) < .6) { this.greeted = true; this.svg.classList.add('puffing'); setTimeout(() => this.say('สวัสดี!', 2300), 260); }
      if (this.greeted && Math.abs(this.enter.v) < .02 && Math.abs(1 - p) < .002) { this.enterDone = true; this.squash = 0; }
    } else if (this.enterOn && this.enterDone) { this.squash *= .85; }
    else if (this.enterOn && !mo) { es = 1; }
    else if (this.kind === 'hero' && !this.enterOn) { /* before start: far away */ es = .16; edy = -this.enterDy; }

    // ----- scroll → wheels + roll -----
    const sv = input.vel;
    if (mo) { this.wheel += input.dy * .5; this.roll.t = clamp(sv * .0024, -3.6, 3.6); }
    else this.roll.t = 0;
    const roll = this.roll.step(dt);

    // ----- spring updates -----
    this.pupX.t = gx; this.pupY.t = gy;
    const sdt = Math.min(dt, .033);
    let px = this.pupX.step(sdt), py = this.pupY.step(sdt);
    const pl = Math.hypot(px, py); if (pl > 1) { px /= pl; py /= pl; }
    const kf = 1 - Math.exp(-5 * dt), kb = 1 - Math.exp(-3 * dt);
    const pitch = mo ? clamp(sv / 2200, -.5, .5) : 0;
    this.faceX += (gx - this.faceX) * kf; this.faceY += (clamp(gy * .35 + pitch, -1, 1) - this.faceY) * kf; this.bodyX += (gx - this.bodyX) * kb;
    this.lid.t = Math.max(lidT, 0);
    this.brow.t = browT + (mo ? clamp(-gy * .35, -.35, .35) : 0);
    const lid = clamp(Math.max(this.lid.step(sdt), blink), 0, 1);
    const brow = this.brow.step(sdt), pop = this.pop.step(sdt), nod = this.nod.step(sdt);
    const hop = this.hop.step(sdt);
    const spinA = this.spin.step(sdt);
    if (this.donut && this.spin.x > Math.PI * 2 - .02 && Math.abs(this.spin.v) < .05) { this.donut = 0; this.spin.x = 0; this.spin.t = 0; this.spin.v = 0; }
    // flag points at CTAs
    let fa = 0;
    if (this.lookEl && this.lookEl.classList.contains('btn')) { const r = this.lookEl.getBoundingClientRect(); fa = clamp((r.left + r.width / 2 - (rect.left + rect.width / 2)) / rect.width * 60, -48, 48); }
    this.flagA.t = fa; const flagA = this.flagA.step(sdt);
    // wheels
    this.wheel += this.wheelV * dt; this.wheelV *= Math.exp(-4 * dt);
    const tr = 'translate(0 ' + ((this.wheel % 16 + 16) % 16).toFixed(1) + ')';

    // ----- apply -----
    const fx = this.faceX, fy = this.faceY;
    const ex = fx * 10.5, ey = fy * 6 + nod * .12 + hop * .0;
    const sq = this.squash, hv = clamp(this.hop.v * .00012, -.08, .08);
    const sx = (1 - sq * .6 - hv * .5 - Math.abs(sv) * .0000045) * (this.donut ? Math.cos(spinA) : 1), sy = 1 + sq + hv * .9 - Math.min(.03, Math.abs(sv) * .000012);
    const rr = roll + this.bodyX * 2.2;
    const hopY = hop + edy;
    this.set(e.root, 'r', `translate(200 329) translate(0 ${hopY.toFixed(2)}) rotate(${rr.toFixed(2)}) scale(${(sx * es).toFixed(4)} ${(sy * es).toFixed(4)}) translate(-200 -329)`);
    const shs = es * (1 + clamp(hop, -30, 0) * .008);
    this.set(e.shadow, 's', `translate(200 329) scale(${(shs * (this.donut ? Math.abs(Math.cos(spinA)) * .6 + .4 : 1)).toFixed(3)} ${(es).toFixed(3)}) translate(-200 -329)`);
    this.set(e.body, 'b', `translate(${(fx * 1.3).toFixed(2)} 0)`);
    this.set(e.cab, 'c', `translate(${(fx * 1.6).toFixed(2)} ${(fy * .6).toFixed(2)})`);
    this.set(e.roof, 'o', `translate(${(fx * 3.4).toFixed(2)} ${(fy * 1.6 + nod * .06).toFixed(2)})`);
    this.set(e.lamps, 'l', `translate(${(fx * 3.4).toFixed(2)} ${(fy * 1.8).toFixed(2)})`);
    this.set(e.mouth, 'm', `translate(${(200 + fx * 6.4).toFixed(2)} ${(230 + fy * 3.2).toFixed(2)})`);
    this.set(e.eyes, 'e', `translate(${ex.toFixed(2)} ${ey.toFixed(2)})`);
    const popS = 1 + clamp(pop, -.2, .45) * .09, sL = (1 + fx * .07) * 1, sR = (1 - fx * .07);
    this.set(e.eyeL, 'el', `translate(150 150) scale(${(sL).toFixed(3)} ${(popS * (1 + fx * .03)).toFixed(3)})`);
    this.set(e.eyeR, 'er', `translate(250 150) scale(${(sR).toFixed(3)} ${(popS * (1 - fx * .03)).toFixed(3)})`);
    const pxs = (px * PX).toFixed(2), pys = (py * PY).toFixed(2);
    this.set(e.pupL, 'pl', `translate(${pxs} ${pys})`); this.set(e.pupR, 'pr', `translate(${pxs} ${pys})`);
    const lidY = (-74 + 74 * lid).toFixed(1);
    this.set(e.lidL, 'll', `translate(0 ${lidY})`); this.set(e.lidR, 'lr', `translate(0 ${lidY})`);
    const by = (-brow * 3 + (brow < 0 ? -brow * 2 : 0)).toFixed(2), tl = (-brow * 7 + (brow < 0 ? brow * -4 : 0)).toFixed(1);
    this.set(e.browL, 'bl', `translate(150 ${(111 + +by).toFixed(2)}) rotate(${(+tl * -1 * -1).toFixed(1)})`);
    this.set(e.browR, 'br', `translate(250 ${(111 + +by).toFixed(2)}) rotate(${(-tl).toFixed(1)})`);
    this.set(e.flag, 'f', `translate(70 36) rotate(${flagA.toFixed(1)})`);
    e.treads.forEach((t, i) => this.set(t, 't' + i, tr));
    // mouth
    let m = 'smile';
    if (now < this.mouthUntil && this.mouthTemp) m = this.mouthTemp;
    else if (mouthState) m = mouthState;
    else if (this.grin) m = 'grin';
    this.mouth(m);
  }
}

/* ---------- build the rigs ---------- */
const heroSvg = $('#tukBtn .tuk'), stage = $('#stage'), mini = $('#mini');
const hero = new Tuk(heroSvg, { kind: 'hero', beep: $('#beep') });
// companion: clone of the hero with unique ids
const clone = heroSvg.cloneNode(true);
$$('[id]', clone).forEach(n => { n.id = n.id + '-m'; });
$$('[clip-path]', clone).forEach(n => n.setAttribute('clip-path', n.getAttribute('clip-path').replace(')', '-m)')));
mini.appendChild(clone);
const miniBeep = document.createElement('div'); miniBeep.className = 'beep'; miniBeep.setAttribute('aria-hidden', 'true'); mini.appendChild(miniBeep);
const comp = new Tuk(clone, { kind: 'mini', beep: miniBeep });
const rigs = [hero, comp];

/* hero road dashes (perspective) */
const dashes = $$('.rd');
let dashPh = 0;
function drawDashes(ph) {
  const H = 332, B = 560, n = dashes.length;
  dashes.forEach((r, i) => {
    const z = ((i / n) + ph) % 1, k = z * z;
    const y = H + (B - H) * k, w = 2 + 15 * k, h = 4 + 40 * k;
    r.setAttribute('x', (260 - w / 2).toFixed(1)); r.setAttribute('y', y.toFixed(1)); r.setAttribute('width', w.toFixed(1)); r.setAttribute('height', h.toFixed(1)); r.setAttribute('rx', (w / 3).toFixed(1));
  });
}
drawDashes(0);

/* visibility */
let heroVis = true;
function measureEnter() {
  const sr = stage.getBoundingClientRect(), tr = heroSvg.getBoundingClientRect();
  const ppu = tr.width / 400 || 1;                     // screen px per svg unit
  hero.enterDy = Math.max(60, (sr.height * .34) / ppu);
}
new IntersectionObserver(es => {
  heroVis = es[0].isIntersecting;
  hero.active = heroVis;
  const showMini = !es[0].isIntersecting || es[0].intersectionRatio < .12;
  mini.classList.toggle('show', showMini); comp.active = showMini || mini.classList.contains('show'); if (showMini) wake();
}, { threshold: [0, .12, .4] }).observe(stage);
new IntersectionObserver(es => document.body.classList.toggle('in-contact', es[0].isIntersecting), { threshold: .6 }).observe($('#contact'));
hero.active = true; comp.active = false;
// companion is always updated while the loop runs (cheap) so it is ready when it slides in
comp.active = true;

/* ---------- look-at / hover reactions ---------- */
looks = $$('[data-look]');
const setLook = el => { rigs.forEach(r => { r.lookEl = el; }); };
function nearestLook() {
  const vh = innerHeight; let best = null, bd = 1e9;
  for (const el of looks) { const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > vh) continue; const d = Math.abs(r.top + r.height / 2 - vh * .5); if (d < bd) { bd = d; best = el; } }
  return best;
}
looks.forEach(el => {
  el.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; setLook(el); if (motion() && el.classList.contains('card')) comp.nod.kick(90); });
  el.addEventListener('pointerleave', () => setLook(null));
});
$$('.btn').forEach(b => {
  b.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; setLook(b); rigs.forEach(r => r.grin = true); });
  b.addEventListener('pointerleave', () => { setLook(null); rigs.forEach(r => r.grin = false); });
  b.addEventListener('focus', () => rigs.forEach(r => r.grin = true)); b.addEventListener('blur', () => rigs.forEach(r => r.grin = false));
});

/* ---------- pointer ---------- */
addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') { input.has = true; input.x = e.clientX; input.y = e.clientY; }
  else { input.has = true; input.touch = true; input.x = e.clientX; input.y = e.clientY; input.touchUntil = performance.now() + 1100; }
  bump(); wake();
}, { passive: true });
addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { input.has = true; input.x = e.clientX; input.y = e.clientY; input.touchUntil = performance.now() + 1100; } bump(); wake(); }, { passive: true });
addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') input.touchUntil = performance.now() + 900; }, { passive: true });
document.documentElement.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') input.has = false; });
document.addEventListener('mouseleave', () => { input.has = false; });
addEventListener('blur', () => { input.has = false; });
addEventListener('scroll', () => { bump(); wake(); }, { passive: true });
addEventListener('keydown', e => {
  bump();
  if (e.key && e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey && !/input|textarea/i.test(e.target.tagName)) (heroVis ? hero : comp).doDonut();
  konami(e.key);
});
const KON = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']; let ki = 0;
function konami(k) { ki = (k === KON[ki] || k.toLowerCase() === KON[ki]) ? ki + 1 : (k === KON[0] ? 1 : 0); if (ki === KON.length) { ki = 0; (heroVis ? hero : comp).doDonut(); } }

/* honk: hero button + companion */
$('#tukBtn').addEventListener('click', () => { hero.honk(); bump(); wake(); });
mini.addEventListener('click', () => { if (mini.classList.contains('show')) { comp.honk(); bump(); wake(); } });

/* sound toggle */
const snd = $('#snd');
snd.addEventListener('click', () => {
  soundOn = !soundOn; snd.setAttribute('aria-pressed', soundOn); $('b', snd).textContent = soundOn ? 'on' : 'off';
  if (soundOn) beepSound(1);
});

/* reduced-motion opt-in */
const moBtn = $('#moBtn');
function syncMotionUI() { moBtn.hidden = !(mqRM.matches && !override); if (!mqRM.matches) root.classList.remove('motion-on'); }
moBtn.addEventListener('click', () => {
  override = true; root.classList.add('motion-on', 'anim'); moBtn.hidden = true;
  hero.enterOn = true; hero.enterDone = true; hero.squash = 0; wake();
});
mqRM.addEventListener && mqRM.addEventListener('change', () => { syncMotionUI(); root.classList.toggle('anim', motion()); wake(); });
syncMotionUI();

/* ---------- main loop ---------- */
let raf = 0, last = 0, lookT = 0;
function frame(now) {
  raf = 0;
  const dt = Math.min(.05, (now - last) / 1000 || .016); last = now;
  const sy = scrollY; input.dy = sy - input.sy; input.sy = sy;
  input.vel += (input.dy / Math.max(dt, .004) - input.vel) * (1 - Math.exp(-12 * dt));
  if (Math.abs(input.vel) < 1) input.vel = 0;
  const mo = motion();
  // scroll-linked, cheap CSS vars
  if (mo) {
    root.style.setProperty('--road', (sy * .8).toFixed(1));
    dashPh = (sy * .0032) % 1; drawDashes(dashPh);
    routeProgress();
  }
  // companion looks at the section in view when the pointer isn't around
  if (now - lookT > 220) { lookT = now; comp.secEl = (!input.has || !mqFine.matches) ? nearestLook() : null; }
  rigs.forEach(r => r.active && r.update(dt, now));
  magnets(dt);
  if (mo && !document.hidden) raf = requestAnimationFrame(frame);
}
function wake() { if (!raf && !document.hidden && motion()) { last = performance.now(); raf = requestAnimationFrame(frame); } else if (!motion() && !staticDone) paintStatic(); }
document.addEventListener('visibilitychange', wake);

/* static (reduced-motion) paint: neutral front-facing pose, once */
let staticDone = false;
function paintStatic() { staticDone = true; hero.enterOn = true; hero.enterDone = true; comp.enterOn = true; comp.enterDone = true; rigs.forEach(r => r.update(.016, performance.now())); heroSvg.closest('.tuk-btn').dataset.ready = '1'; }

/* magnetic CTAs */
const btns = $$('.btn').map(el => ({ el, x: 0, y: 0 }));
function magnets(dt) {
  if (!motion() || !mqFine.matches) return;
  const k = 1 - Math.exp(-11 * dt);
  for (const b of btns) {
    let tx = 0, ty = 0;
    if (input.has) {
      const r = b.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = input.x - cx, dy = input.y - cy, ox = Math.max(0, Math.abs(dx) - r.width / 2), oy = Math.max(0, Math.abs(dy) - r.height / 2);
      if (Math.hypot(ox, oy) < 80) { tx = clamp(dx * .1, -8, 8); ty = clamp(dy * .16, -8, 8); }
    }
    b.x += (tx - b.x) * k; b.y += (ty - b.y) * k;
    const sx = Math.abs(b.x) < .05 ? '0px' : b.x.toFixed(2) + 'px', sy2 = Math.abs(b.y) < .05 ? '0px' : b.y.toFixed(2) + 'px';
    if (b.sx !== sx || b.sy !== sy2) { b.sx = sx; b.sy = sy2; b.el.style.setProperty('--mx', sx); b.el.style.setProperty('--my', sy2); }
  }
}

/* ---------- page reveals, scramble, counters, route ---------- */
const CH = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%&/<>';
function scramble(el) {
  const fin = el.dataset.t || (el.dataset.t = el.textContent);
  el.classList.add('go');
  if (!motion()) { el.textContent = fin; return; }
  const n = fin.length, t0 = performance.now(), dur = 520 + n * 12; let lastT = 0;
  (function step(now) {
    if (now - lastT > 42) {
      lastT = now; const p = clamp((now - t0) / dur, 0, 1), k = Math.floor(p * n); let s = '';
      for (let i = 0; i < n; i++) s += (i < k || fin[i] === ' ' || fin[i] === '·') ? fin[i] : CH[(Math.random() * CH.length) | 0];
      el.textContent = p >= 1 ? fin : s;
    }
    if (now - t0 < dur) requestAnimationFrame(step); else el.textContent = fin;
  })(t0);
}
function count(el) {
  const to = +el.dataset.count, suf = el.dataset.suffix || '', fmt = v => Math.round(v).toLocaleString('en-US') + suf;
  if (!motion()) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 1100;
  (function s(now) { const p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 4); el.textContent = fmt(to * e); if (p < 1) requestAnimationFrame(s); })(t0);
}
$$('.scr').forEach(el => { el.dataset.t = el.textContent; });
$$('[data-count]').forEach(el => { if (root.classList.contains('anim')) el.textContent = '0' + (el.dataset.suffix || ''); });
$$('.rv').forEach(el => { const sibs = [...el.parentElement.children].filter(c => c.classList.contains('rv')); el.style.setProperty('--d', (sibs.indexOf(el) * .07).toFixed(2) + 's'); });
const io = new IntersectionObserver(es => es.forEach(en => {
  if (!en.isIntersecting) return; const el = en.target; io.unobserve(el);
  if (el.classList.contains('rv')) el.classList.add('in');
  $$('.scr', el).forEach(scramble); if (el.matches('.scr')) scramble(el);
  $$('[data-count]', el).forEach(count); if (el.matches('[data-count]')) count(el);
}), { threshold: .35, rootMargin: '0px 0px -6% 0px' });
$$('.rv, .scr:not(.rv .scr)').forEach(el => io.observe(el));
$$('[data-count]').forEach(el => io.observe(el));
// hero label scrambles right away, after the fonts are in
const hl = $('.hero-head .scr'); if (hl) { const go = () => setTimeout(() => scramble(hl), 250); (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go); }

const routeEl = $('#routeEl');
function routeProgress() {
  const r = routeEl.getBoundingClientRect(), p = clamp((innerHeight * .62 - r.top) / (r.height - 40), 0, 1);
  if (routeEl._p !== p) { routeEl._p = p; routeEl.style.setProperty('--p', p.toFixed(4)); }
}

$('#yr').textContent = new Date().getFullYear();

/* ---------- start ---------- */
function boot() {
  measureEnter();
  if (motion()) {
    hero.enterOn = false; heroSvg.closest('.tuk-btn').dataset.ready = '1';
    hero.update(.016, performance.now());                  // park it far away, no flash
    setTimeout(() => { hero.startEnter(); wake(); }, 650);
    wake();
  } else paintStatic();
}
addEventListener('resize', () => { measureEnter(); wake(); });
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(boot);
setTimeout(() => { if (!heroSvg.closest('.tuk-btn').dataset.ready) boot(); }, 2500);
})();
