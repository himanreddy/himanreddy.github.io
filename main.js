(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = mq.matches;
  mq.addEventListener?.('change', e => { reduced = e.matches; update(true); });
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const pad = (n, l) => String(Math.max(0, Math.round(n))).padStart(l, '0');
  const root = document.documentElement;
  const px = () => parseFloat(getComputedStyle(root).getPropertyValue('--P')) || 3;

  $('#yr').textContent = new Date().getFullYear();

  const hud = $('.hud'), hScore = $('#hScore'), hCoins = $('#hCoins'), hTime = $('#hTime');
  const hills = $('#hills'), bushes = $('#bushes'), ground = $('#ground'), clouds = $('#clouds');
  const char = $('#char'), sprite = $('#sprite');
  const flag = $('#flag'), contact = $('#contact');
  const jobs = $$('.job'), railFill = $('#railFill'), course = $('#course');
  const stageEl = $('.stage');

  let coins = 0, cleared = false, firstPass = true;
  let lastY = scrollY, lastMove = 0, dir = 1, jumpUntil = 0;

  /* ---- numbers that count up when revealed ---- */
  const fmt = (n, s) => n.toLocaleString('en-US') + (s || '');
  function countUp(el) {
    const end = +el.dataset.count, suf = el.dataset.suffix || '';
    if (reduced) { el.textContent = fmt(end, suf); return; }
    const t0 = performance.now(), dur = 1200;
    const step = now => {
      const k = clamp((now - t0) / dur);
      // stepped so it ticks like an arcade counter
      const v = Math.round(end * (Math.floor(k * 12) / 12));
      el.textContent = fmt(k === 1 ? end : v, k === 1 ? suf : '');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const rv = $$('.rv');
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in'); io.unobserve(e.target);
    const n = $('.num', e.target); if (n) countUp(n);
  }), { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }) : null;
  rv.forEach(el => io ? io.observe(el) : el.classList.add('in'));

  /* ---- ? block hit ---- */
  function hit(job, animate) {
    job.classList.add('hit');
    coins++;
    if (animate && !reduced) {
      job.classList.add('bump');
      setTimeout(() => job.classList.remove('bump'), 1000);
      jumpUntil = performance.now() + 520;
      char.classList.remove('hop'); void char.offsetWidth; char.classList.add('hop');
      hud.classList.add('bump'); setTimeout(() => hud.classList.remove('bump'), 450);
    }
  }

  function update(force) {
    const y = scrollY, vh = innerHeight;
    const max = Math.max(1, document.documentElement.scrollHeight - vh);
    const prog = clamp(y / max);
    const P = px();

    /* parallax layers: clouds slowest, hills, bushes, ground = running speed */
    if (!reduced) {
      clouds.style.backgroundPositionX = (-y * 0.12) + 'px';
      hills.style.backgroundPositionX = (-y * 0.25) + 'px';
      bushes.style.backgroundPositionX = (-y * 0.5) + 'px';
      ground.style.backgroundPositionX = (-y) + 'px';
    } else {
      clouds.style.backgroundPositionX = hills.style.backgroundPositionX = bushes.style.backgroundPositionX = ground.style.backgroundPositionX = '0px';
    }

    /* runner */
    const now = performance.now();
    if (y !== lastY) { dir = y > lastY ? 1 : -1; lastMove = now; }
    lastY = y;

    /* ? blocks: hit when the block reaches ~70% of the visible play area */
    const hudH = hud.offsetHeight, stageH = stageEl.offsetHeight;
    const line = hudH + (vh - hudH - stageH) * 0.72;
    jobs.forEach(j => {
      if (j.classList.contains('hit')) return;
      const r = $('.blk', j).getBoundingClientRect();
      if (r.top < line) hit(j, !firstPass && !force);
    });

    /* course rail fill (solid colour, draws down as you pass blocks) */
    const cr = course.getBoundingClientRect();
    const lastBlk = $('.blk', jobs[jobs.length - 1]).getBoundingClientRect();
    const total = (lastBlk.top - cr.top);
    railFill.style.transform = `scaleY(${total > 0 ? clamp((line - cr.top) / total) : 0})`;

    /* flagpole: flag slides down over the last stretch of scroll */
    const D = Math.min(520, Math.max(240, max * 0.12));
    const p = reduced ? 1 : clamp((y - (max - D)) / D);
    const poleH = 256, flagH = 52;
    flag.style.top = (24 + p * (poleH - flagH - 24 - 8)) + 'px';
    const nowClear = max - y < 6 || (p >= 1 && max - y < 40);
    if (nowClear !== cleared) { cleared = nowClear; document.body.classList.toggle('is-clear', cleared); if (cleared && !reduced) { jumpUntil = now + 520; char.classList.remove('hop'); void char.offsetWidth; char.classList.add('hop'); } }
    if (reduced && max - y < 6) document.body.classList.add('is-clear');

    /* HUD */
    const bonus = cleared ? 5000 : 0;
    hScore.textContent = pad(prog * 3000 + coins * 200 + bonus, 6);
    hCoins.textContent = 'x' + pad(coins, 2);
    if (!cleared) hTime.textContent = pad(400 * (1 - prog), 3);
    else hTime.textContent = pad(0, 3);
    setFrame(y, P);
    firstPass = false;
  }

  function setFrame(y, P) {
    const now = performance.now();
    let s = 0;
    if (reduced) s = 0;
    else if (cleared) s = 4;
    else if (now < jumpUntil) s = 3;
    else if (now - lastMove < 140) s = 1 + (Math.floor(y / (P * 5)) % 2);
    sprite.dataset.s = s;
    sprite.classList.toggle('back', !reduced && dir < 0 && !cleared);
  }

  let ticking = false;
  const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } };
  addEventListener('scroll', req, { passive: true });
  addEventListener('resize', req);
  // keep sprite going idle when scrolling stops
  setInterval(() => { if (!reduced) setFrame(scrollY, px()); }, 90);

  update(true);
  if (document.fonts?.ready) document.fonts.ready.then(() => update(true));
  addEventListener('load', () => update(true));
})();
