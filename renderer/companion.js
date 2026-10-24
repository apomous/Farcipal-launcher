/* FARCIPAL · Companion Eye
 * Глаз-компаньон: тело на SVG (плоть + вены), радужка и зрачок из FARCIPAL EYE,
 * паутина на canvas (верле-нити), частицы поверх, рывок (slam) по кнопке «Запустить».
 *
 * API:
 *   Companion.init({ play, progress, shake })
 *   Companion.slam()        -> Promise, resolves в момент удара
 *   Companion.phase(name)   -> 'idle' | 'loading' | 'running' | 'error'
 *   Companion.setHoverable(bool)
 */
(() => {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const damp = (dt, rate) => 1 - Math.exp(-dt * rate);
  const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

  const COLORS = { green: [61, 207, 111], amber: [232, 180, 90], red: [248, 113, 113] };

  // геометрия: радиус белка в px и в юнитах SVG
  const R = 62, BALL = 92, IRIS = 52, PUPIL = 18;
  const SVG_PX = (260 / BALL) * R, HALF = SVG_PX / 2;

  // ---------- состояние ----------
  let els = {}, W = innerWidth, H = innerHeight, dpr = 1;
  let ctxW, ctxF;
  let mode = "follow";            // follow | hover | slam | recoil | loading | error | sleep
  let wantLoading = false, running = false, hoverable = true, hovering = false;
  let time = 0, last = 0;

  const eye = { x: W / 2, y: H * 0.3, vx: 0, vy: 0, sc: 1, base: Math.PI * 0.5 };
  const mouse = { x: W / 2, y: H / 2, lastMove: performance.now() };
  const cur = {                    // сглаженные визуальные параметры
    lid: 0.1, px: 1.3, py: 1.3, sc: 1, spin: 0.2, vis: 0.6,
    gx: 0, gy: 0, col: [...COLORS.green]
  };
  let btnRect = null, progRect = null;
  let pinT = 0, flash = 0, sqz = 0, sqzAng = 0, tilt = 0;
  let nextBlink = performance.now() + 3000, blinkAt = -1e9;
  let slamS = null, recoilT0 = 0, recoilTarget = { x: 0, y: 0 };
  let errT0 = 0, errTarget = { x: 0, y: 0 };
  let orbitA = 0;
  let shakeUntil = 0, shakeDur = 1, shakePow = 0, shakeX = 0, shakeY = 0;
  const trail = [];
  const parts = [];

  // ---------- нити (верле) ----------
  const NR = 7, NP = 14;
  const ropes = Array.from({ length: NR }, (_, i) => ({
    web: i < 4,
    ph: rnd(0, 6.28),
    pts: Array.from({ length: NP }, () => ({ x: 0, y: 0, px: 0, py: 0 }))
  }));
  function resetRopes() {
    ropes.forEach((r) => r.pts.forEach((p) => { p.x = p.px = eye.x; p.y = p.py = eye.y; }));
  }

  // ---------- сборка SVG: вены, пятна плоти, волокна радужки ----------
  let fib = [], sweepA, sweepB, irisMove, pupilMove, pupil, lidU, lidL, spec, svgEl, layer;

  function buildEye() {
    const $ = (id) => document.getElementById(id);
    svgEl = $("eye"); layer = $("eyeLayer");
    irisMove = $("irisMove"); pupilMove = $("pupilMove"); pupil = $("pupil");
    lidU = $("lidU"); lidL = $("lidL"); spec = $("spec");
    sweepA = $("sweepA"); sweepB = $("sweepB");
    fib = [$("fibA"), $("fibB"), $("fibC")];

    // пятна плоти
    const bl = $("blotches");
    for (let i = 0; i < 12; i++) {
      const a = rnd(0, 6.28), d = Math.sqrt(Math.random()) * 84;
      const e = document.createElementNS(SVGNS, "ellipse");
      e.setAttribute("cx", (Math.cos(a) * d).toFixed(1)); e.setAttribute("cy", (Math.sin(a) * d).toFixed(1));
      e.setAttribute("rx", rnd(8, 22).toFixed(1)); e.setAttribute("ry", rnd(5, 16).toFixed(1));
      e.setAttribute("transform", `rotate(${rnd(0, 180).toFixed(0)} ${e.getAttribute("cx")} ${e.getAttribute("cy")})`);
      e.setAttribute("fill", Math.random() < 0.7 ? "#34344a" : "#0a0a10");
      e.setAttribute("opacity", rnd(0.18, 0.4).toFixed(2));
      bl.appendChild(e);
    }

    // вены: от края белка к радужке, с ответвлениями
    const base = $("veinBase"), flow = $("veinFlow");
    const addVein = (d, w, delay) => {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d); p.setAttribute("fill", "none");
      p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-width", w);
      base.appendChild(p);
      const q = p.cloneNode(); q.style.animationDelay = `-${delay.toFixed(2)}s`; q.setAttribute("stroke-width", (w * 0.9).toFixed(2));
      flow.appendChild(q);
    };
    const N = 17;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rnd(-0.12, 0.12);
      const r0 = BALL + 4, r1 = IRIS + rnd(6, 20);
      const bend = rnd(-0.35, 0.35);
      const m1 = [Math.cos(a + bend) * lerp(r0, r1, 0.5), Math.sin(a + bend) * lerp(r0, r1, 0.5)];
      const e1 = [Math.cos(a + bend * 0.4) * r1, Math.sin(a + bend * 0.4) * r1];
      const s = [Math.cos(a) * r0, Math.sin(a) * r0];
      addVein(`M ${s[0].toFixed(1)} ${s[1].toFixed(1)} Q ${m1[0].toFixed(1)} ${m1[1].toFixed(1)} ${e1[0].toFixed(1)} ${e1[1].toFixed(1)}`, rnd(1, 2.1), rnd(0, 4));
      // ответвления
      const nb = 1 + ((Math.random() * 2) | 0);
      for (let b = 0; b < nb; b++) {
        const t = rnd(0.25, 0.7);
        const bx = lerp(lerp(s[0], m1[0], t), lerp(m1[0], e1[0], t), t), by = lerp(lerp(s[1], m1[1], t), lerp(m1[1], e1[1], t), t);
        const ba = a + rnd(-0.5, 0.5), bl2 = rnd(14, 30);
        addVein(`M ${bx.toFixed(1)} ${by.toFixed(1)} q ${(Math.cos(ba) * bl2 * 0.5).toFixed(1)} ${(Math.sin(ba) * bl2 * 0.5).toFixed(1)} ${(Math.cos(ba + 0.4) * bl2).toFixed(1)} ${(Math.sin(ba + 0.4) * bl2).toFixed(1)}`, rnd(0.5, 1), rnd(0, 4));
      }
    }

    // волокна радужки (ДНК FARCIPAL EYE): 3 группы по 70 нитей
    const tones = ["#174f2c", "#1b5e34", "#1f6c3c", "#247a44"];
    const TAU = Math.PI * 2, FIBERS = 210, k = IRIS / 168;
    for (let i = 0; i < FIBERS; i++) {
      const a = (i / FIBERS) * TAU + rnd(-0.025, 0.025);
      const r0 = PUPIL + 1 + rnd(0, 4);
      const r1 = IRIS * (0.5 + Math.random() * 0.46);
      const bend = rnd(-0.04, 0.04);
      const am = a + bend, rm = (r0 + r1) / 2;
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", `M ${(Math.cos(a) * r0).toFixed(1)} ${(Math.sin(a) * r0).toFixed(1)} Q ${(Math.cos(am) * rm).toFixed(1)} ${(Math.sin(am) * rm).toFixed(1)} ${(Math.cos(a + bend * 1.6) * r1).toFixed(1)} ${(Math.sin(a + bend * 1.6) * r1).toFixed(1)}`);
      const lighter = Math.random() < 0.18;
      p.setAttribute("stroke", lighter ? "#2f9a58" : tones[(Math.random() * tones.length) | 0]);
      p.setAttribute("stroke-opacity", (lighter ? rnd(0.3, 0.55) : rnd(0.2, 0.6)).toFixed(2));
      p.setAttribute("stroke-width", ((0.5 + Math.random() * 1.1) * k * 2.2).toFixed(2));
      p.setAttribute("fill", "none");
      fib[i % 3].appendChild(p);
    }
  }

  // ---------- замеры ----------
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left - shakeX, top: r.top - shakeY, right: r.right - shakeX, bottom: r.bottom - shakeY, width: r.width, height: r.height }; };
  function readRects() {
    if (els.play) btnRect = slamS ? btnRect : rectOf(els.play);
    if (els.progress) progRect = rectOf(els.progress);
  }
  const home = () => ({ x: W / 2, y: btnRect ? Math.max(120, btnRect.top - 140) : H * 0.3 });

  // ---------- выбор режима ----------
  function pickMode(now) {
    if (mode === "slam" || mode === "recoil" || mode === "error") return;
    if (wantLoading) mode = "loading";
    else if (running) mode = "sleep";
    else if (hovering && hoverable && btnRect) mode = "hover";
    else if (now - mouse.lastMove > 10000) mode = "sleep";
    else mode = "follow";
  }

  // ---------- цели для режимов ----------
  function followTarget() {
    let ox = 112, oy = -84;
    if (mouse.x > W - 230) ox = -112;
    if (mouse.y < 170) oy = 84;
    return { x: clamp(mouse.x + ox, R + 10, W - R - 10), y: clamp(mouse.y + oy, R + 60, H - R - 10) };
  }
  function hoverSpot() {
    return { x: clamp(btnRect.right - 18, R + 10, W - R - 10), y: Math.max(R + 60, btnRect.top - R - 16) };
  }

  // ---------- рывок ----------
  function slam() {
    return new Promise((res) => {
      if (!btnRect || mode === "slam" || mode === "recoil") { res(); return; }
      const r = { ...btnRect };
      const I = { x: clamp(eye.x, r.left + r.width * 0.22, r.right - r.width * 0.12), y: r.top + r.height * 0.1 };
      let dx = eye.x - I.x, dy = eye.y - I.y;
      let d = Math.hypot(dx, dy);
      if (d < 12) { dx = 0; dy = -1; d = 1; }
      const dir = { x: dx / d, y: dy / d };
      slamS = {
        phase: "wind", t0: performance.now(), from: { x: eye.x, y: eye.y },
        B: { x: eye.x + dir.x * 40, y: eye.y + dir.y * 40 }, I, dir, res
      };
      sqzAng = Math.atan2(-dir.y, -dir.x);
      mode = "slam"; eye.vx = eye.vy = 0;
    });
  }

  function stepSlam(now) {
    const s = slamS;
    if (s.phase === "wind") {
      const t = clamp((now - s.t0) / 170, 0, 1);
      eye.x = lerp(s.from.x, s.B.x, easeOut(t)); eye.y = lerp(s.from.y, s.B.y, easeOut(t));
      if (t >= 1) { s.phase = "dash"; s.t0 = now; }
    } else if (s.phase === "dash") {
      const t = clamp((now - s.t0) / 190, 0, 1), u = easeIn(t);
      eye.x = lerp(s.B.x, s.I.x, u); eye.y = lerp(s.B.y, s.I.y, u);
      sqz = u * 0.6;
      if (t >= 1) { s.phase = "hold"; s.t0 = now; impact(s.I); s.res(); }
    } else if (s.phase === "hold") {
      const t = clamp((now - s.t0) / 110, 0, 1);
      eye.x = s.I.x; eye.y = s.I.y; sqz = 1 - t * 0.6;
      if (t >= 1) {
        recoilT0 = now;
        recoilTarget = { x: clamp(s.I.x + s.dir.x * 150, R, W - R), y: clamp(s.I.y + s.dir.y * 150, R + 60, H - R) };
        eye.vx = s.dir.x * 1000; eye.vy = s.dir.y * 1000;
        mode = "recoil"; slamS = null; pinT = 0;
      }
    }
  }

  function impact(pt) {
    flash = 1;
    sqz = 1;
    doShake(reduced ? 3 : 12, 420);
    burst(pt.x, pt.y, reduced ? 14 : 48, COLORS.green, -Math.PI / 2, 1.5);
    if (els.play) {
      els.play.classList.add("slammed");
      setTimeout(() => els.play.classList.remove("slammed"), 300);
    }
    ring();
  }

  function doShake(pow, dur) { shakePow = pow; shakeDur = dur; shakeUntil = performance.now() + dur; }

  // ---------- ошибка ----------
  function fail() {
    if (slamS) { slamS = null; }
    const ctr = btnRect ? { x: (btnRect.left + btnRect.right) / 2, y: (btnRect.top + btnRect.bottom) / 2 } : { x: W / 2, y: H / 2 };
    let dx = eye.x - ctr.x, dy = eye.y - ctr.y, d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    if (Math.abs(dx) < 0.3) dx = Math.random() < 0.5 ? -0.7 : 0.7;
    wantLoading = false; running = false;
    mode = "error"; errT0 = performance.now(); pinT = 0;
    eye.vx = dx * 1500; eye.vy = dy * 1500 - 300;
    errTarget = { x: clamp(eye.x + dx * 200, R + 10, W - R - 10), y: clamp(eye.y + dy * 120 - 60, R + 60, H - R - 10) };
    burst(eye.x, eye.y, reduced ? 6 : 18, COLORS.red, Math.atan2(dy, dx), 2.4);
    doShake(reduced ? 1 : 4, 260);
  }

  // ---------- частицы ----------
  function burst(x, y, n, col, baseAng, spread) {
    for (let i = 0; i < n && parts.length < 140; i++) {
      const a = baseAng + rnd(-spread, spread) * 0.5, sp = rnd(160, 640);
      const frag = Math.random() < 0.3;
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(0.45, 1.1),
        size: frag ? rnd(6, 14) : Math.floor(rnd(2, 5)), frag, ang: rnd(0, 6.28), spin: rnd(-9, 9), col
      });
    }
  }

  function ring() {
    const g = document.getElementById("rings");
    if (!g || !g.animate) return;
    for (let i = 0; i < 3; i++) {
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("fill", "none"); c.setAttribute("stroke-width", "1.5"); c.style.stroke = "var(--ec)";
      g.appendChild(c);
      try {
        const a = c.animate([{ r: "20px", opacity: 0.8 }, { r: "125px", opacity: 0 }], { duration: 900, delay: i * 120, easing: "ease-out", fill: "both" });
        a.onfinish = () => c.remove();
      } catch { c.remove(); }
    }
  }

  // ---------- физика ----------
  function spring(tx, ty, k, zeta, dt) {
    const c = 2 * Math.sqrt(k) * zeta;
    eye.vx += (k * (tx - eye.x) - c * eye.vx) * dt;
    eye.vy += (k * (ty - eye.y) - c * eye.vy) * dt;
    eye.x += eye.vx * dt; eye.y += eye.vy * dt;
  }

  // ---------- кадр ----------
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt <= 0) return;
    dt = Math.min(dt, 0.033); time += dt;
    readRects();
    pickMode(now);

    const bobK = reduced ? 0 : 1;
    const bob = { x: Math.sin(time * 0.9) * 6 * bobK, y: Math.cos(time * 1.3) * 9 * bobK };

    // цели и параметры режима
    let lid = 1, px = 1, py = 1, sc = 1, spin = 1, vis = 1, col = COLORS.green;
    let gazeAt = { x: mouse.x, y: mouse.y };
    let pin = false;

    if (mode === "follow") {
      const T = followTarget(); spring(T.x + bob.x, T.y + bob.y, 24, 0.75, dt);
    } else if (mode === "hover") {
      const T = hoverSpot(); spring(T.x + bob.x * 0.4, T.y + bob.y * 0.4, 40, 0.7, dt);
      px = 0.4; py = 1.22; lid = 0.95; pin = true;
    } else if (mode === "slam") {
      stepSlam(now); px = 0.3; py = 1.25; lid = 0.9; pin = true;
      if (btnRect) gazeAt = { x: (btnRect.left + btnRect.right) / 2, y: (btnRect.top + btnRect.bottom) / 2 };
    } else if (mode === "recoil") {
      spring(recoilTarget.x, recoilTarget.y, 70, 0.5, dt); px = 0.7; py = 1.1;
      if (now - recoilT0 > 420) mode = "follow";
    } else if (mode === "loading") {
      col = COLORS.amber; sc = 0.62; px = 0.82; py = 0.88; spin = 3;
      if (progRect) {
        orbitA += dt * 2.2;
        const cx = progRect.left + progRect.width / 2, cy = progRect.top + progRect.height / 2 + 6;
        const rx = Math.min(progRect.width / 2 + 56, W / 2 - 90), ry = 42;
        spring(cx + Math.cos(orbitA) * rx, cy + Math.sin(orbitA) * ry, 90, 0.8, dt);
        gazeAt = { x: cx, y: cy };
      }
    } else if (mode === "error") {
      col = COLORS.red; px = 0.5; py = 1.1; lid = 0.72; spin = 0.4;
      spring(errTarget.x, errTarget.y, 30, 0.45, dt);
      if (btnRect) gazeAt = { x: (btnRect.left + btnRect.right) / 2, y: (btnRect.top + btnRect.bottom) / 2 };
      if (now - errT0 > 2300) mode = "follow";
    } else if (mode === "sleep") {
      const T = home(); spring(T.x + bob.x * 0.5, T.y + bob.y * 0.6, 7, 0.9, dt);
      lid = 0.09; px = 1.35; py = 1.35; spin = 0.15; vis = 0.6;
      gazeAt = { x: eye.x, y: eye.y + 80 };
    }

    // натяжение нитей
    pinT = pin ? Math.min(1, pinT + dt * 2.2) : 0;
    flash = Math.max(0, flash - dt * 2.6);
    if (mode !== "slam" && mode !== "hold") sqz = Math.max(0, sqz - dt * 5);

    // моргание
    if (!(mode === "sleep") && now > nextBlink) { blinkAt = now; nextBlink = now + rnd(2800, 6200); }
    const bp = (now - blinkAt) / 140;
    if (bp >= 0 && bp <= 1) lid *= Math.abs(bp * 2 - 1);

    // сглаживание параметров
    const sm = damp(dt, 9);
    cur.lid = lerp(cur.lid, lid, damp(dt, lid < cur.lid ? 18 : 7));
    cur.px = lerp(cur.px, px, sm); cur.py = lerp(cur.py, py, sm);
    cur.sc = lerp(cur.sc, sc, damp(dt, 5));
    cur.spin = lerp(cur.spin, spin, damp(dt, 3));
    cur.vis = lerp(cur.vis, vis, damp(dt, 3));
    for (let i = 0; i < 3; i++) cur.col[i] = lerp(cur.col[i], col[i], damp(dt, 5));

    // взгляд: зрачок всегда смотрит на gazeAt
    let ex = gazeAt.x - eye.x, ey = gazeAt.y - eye.y, ed = Math.hypot(ex, ey) || 1;
    const g = Math.min(1, ed / 220);
    cur.gx = lerp(cur.gx, (ex / ed) * g, damp(dt, 22));
    cur.gy = lerp(cur.gy, (ey / ed) * g, damp(dt, 22));

    tilt = lerp(tilt, clamp(eye.vx * 0.012, -12, 12), damp(dt, 6));

    updateRopes(dt);
    draw(now);
  }

  function updateRopes(dt) {
    const speed = Math.hypot(eye.vx, eye.vy);
    if (speed > 40) eye.base = angLerp(eye.base, Math.atan2(-eye.vy, -eye.vx), 0.08);
    const anch = btnRect ? [
      { x: btnRect.left + btnRect.width * 0.12, y: btnRect.top + 2 },
      { x: btnRect.left + btnRect.width * 0.42, y: btnRect.top + 2 },
      { x: btnRect.left + btnRect.width * 0.74, y: btnRect.top + 2 },
      { x: btnRect.right - 2, y: btnRect.top + btnRect.height * 0.4 }
    ] : null;
    const rr = R * cur.sc * 0.8;
    const dt2 = dt * dt;

    for (let i = 0; i < NR; i++) {
      const rope = ropes[i], pts = rope.pts;
      const pinned = rope.web && pinT > 0.01 && anch;
      let phi = eye.base + (i - (NR - 1) / 2) * 0.42;
      if (pinned) phi = Math.atan2(anch[i].y - eye.y, anch[i].x - eye.x) + (i - 1.5) * 0.1;
      const rx = eye.x + Math.cos(phi) * rr, ry = eye.y + Math.sin(phi) * rr;

      const grav = pinned ? 520 : 380;
      for (let k = 1; k < NP; k++) {
        const p = pts[k];
        const vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985;
        p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + grav * dt2;
      }
      pts[0].x = pts[0].px = rx; pts[0].y = pts[0].py = ry;
      let L = 8.5 * cur.sc + 1.5;
      if (pinned) {
        const a = anch[i], dist = Math.hypot(a.x - rx, a.y - ry);
        L = Math.max(4, (dist / (NP - 1)) * (1 + (1 - pinT) * 0.5));
        pts[NP - 1].x = a.x; pts[NP - 1].y = a.y;
      }
      for (let it = 0; it < 6; it++) {
        for (let k = 0; k < NP - 1; k++) {
          const a = pts[k], b = pts[k + 1];
          let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.0001;
          const diff = (d - L) / d;
          const wa = k === 0 ? 0 : 0.5, wb = (pinned && k + 1 === NP - 1) ? 0 : 0.5, tw = wa + wb;
          if (tw === 0) continue;
          a.x += dx * diff * (wa / tw); a.y += dy * diff * (wa / tw);
          b.x -= dx * diff * (wb / tw); b.y -= dy * diff * (wb / tw);
        }
        if (pinned) { pts[NP - 1].x = anch[i].x; pts[NP - 1].y = anch[i].y; }
      }
    }
  }

  // ---------- отрисовка ----------
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  let lastEc = "";

  function draw(now) {
    // --- тело глаза ---
    const sc = cur.sc;
    const sx = 1 - 0.24 * sqz, sy = 1 + 0.16 * sqz;
    let jx = 0, jy = 0;
    if (mode === "error") { const a = Math.max(0, 1 - (now - errT0) / 1300) * 7; jx = rnd(-a, a); jy = rnd(-a, a); }
    svgEl.style.transform =
      `translate3d(${(eye.x + jx - HALF).toFixed(1)}px,${(eye.y + jy - HALF).toFixed(1)}px,0) rotate(${tilt.toFixed(2)}deg) ` +
      `rotate(${sqzAng.toFixed(3)}rad) scale(${(sx * sc).toFixed(3)},${(sy * sc).toFixed(3)}) rotate(${(-sqzAng).toFixed(3)}rad)`;

    // цвет
    const ec = `rgb(${cur.col[0] | 0},${cur.col[1] | 0},${cur.col[2] | 0})`;
    if (ec !== lastEc) { layer.style.setProperty("--ec", ec); lastEc = ec; }

    // радужка и зрачок смотрят на цель
    irisMove.setAttribute("transform", `translate(${(cur.gx * 24).toFixed(2)} ${(cur.gy * 24).toFixed(2)})`);
    pupilMove.setAttribute("transform", `translate(${(cur.gx * 10).toFixed(2)} ${(cur.gy * 10).toFixed(2)})`);
    pupil.setAttribute("rx", (PUPIL * cur.px).toFixed(2));
    pupil.setAttribute("ry", (PUPIL * cur.py).toFixed(2));
    spec.setAttribute("transform", `translate(${(cur.gx * 6).toFixed(2)} ${(cur.gy * 6).toFixed(2)})`);

    // веки
    const o = clamp(cur.lid, 0, 1.05);
    lidU.setAttribute("transform", `translate(0 ${(-104 * o).toFixed(2)})`);
    lidL.setAttribute("transform", `translate(0 ${(104 * o).toFixed(2)})`);

    // вращение волокон и дуг-сканеров
    const sp = cur.spin * time;
    fib[0].setAttribute("transform", `rotate(${(sp * 2.9).toFixed(2)})`);
    fib[1].setAttribute("transform", `rotate(${(-sp * 2).toFixed(2)})`);
    fib[2].setAttribute("transform", `rotate(${(sp * 1.1).toFixed(2)})`);
    sweepA.setAttribute("transform", `rotate(${(sp * 52).toFixed(1)})`);
    sweepB.setAttribute("transform", `rotate(${(-sp * 83).toFixed(1)})`);

    // --- canvas: нити и след ---
    ctxW.clearRect(0, 0, W, H);
    ctxW.globalCompositeOperation = "lighter";
    ctxW.lineCap = "round"; ctxW.lineJoin = "round";

    if (mode === "loading" || trail.length) {
      if (mode === "loading") { trail.push({ x: eye.x, y: eye.y }); if (trail.length > 48) trail.shift(); }
      else trail.shift();
      for (let i = 1; i < trail.length; i++) {
        const u = i / trail.length;
        ctxW.strokeStyle = rgba(cur.col, 0.45 * u);
        ctxW.lineWidth = 1 + 3.2 * u * sc;
        ctxW.beginPath(); ctxW.moveTo(trail[i - 1].x, trail[i - 1].y); ctxW.lineTo(trail[i].x, trail[i].y); ctxW.stroke();
      }
    }

    const fl = flash;
    const base = [lerp(cur.col[0], 214, fl), lerp(cur.col[1], 255, fl), lerp(cur.col[2], 228, fl)];
    for (let i = 0; i < NR; i++) {
      const pts = ropes[i].pts;
      const pulse = 0.55 + 0.35 * Math.sin(time * 3 + ropes[i].ph);
      const alpha = clamp(pulse * cur.vis + fl, 0, 1);
      if (fl > 0.05) { ctxW.shadowColor = rgba(COLORS.green, 1); ctxW.shadowBlur = 16 * fl; } else ctxW.shadowBlur = 0;
      for (let pass = 0; pass < 2; pass++) {
        ctxW.strokeStyle = rgba(base, pass === 0 ? alpha * 0.16 : alpha * 0.85);
        ctxW.lineWidth = pass === 0 ? 3.2 + fl * 3 : 0.9 + fl * 1.2;
        ctxW.beginPath(); ctxW.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < NP - 1; k++) {
          const mx = (pts[k].x + pts[k + 1].x) / 2, my = (pts[k].y + pts[k + 1].y) / 2;
          ctxW.quadraticCurveTo(pts[k].x, pts[k].y, mx, my);
        }
        ctxW.lineTo(pts[NP - 1].x, pts[NP - 1].y);
        ctxW.stroke();
      }
    }
    ctxW.shadowBlur = 0;

    // --- canvas: частицы поверх глаза ---
    ctxF.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += 1 / 60; // фиксированный шаг: дёшево и достаточно
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.vy += 900 / 60; p.vx *= 0.985;
      p.x += p.vx / 60; p.y += p.vy / 60; p.ang += p.spin / 60;
      const a = 1 - p.life / p.max;
      ctxF.fillStyle = ctxF.strokeStyle = rgba(p.col, a);
      if (p.frag) {
        ctxF.lineWidth = 1.2; ctxF.beginPath();
        ctxF.moveTo(p.x, p.y); ctxF.lineTo(p.x + Math.cos(p.ang) * p.size, p.y + Math.sin(p.ang) * p.size); ctxF.stroke();
      } else {
        ctxF.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
    }

    // --- тряска экрана ---
    if (els.shake) {
      if (now < shakeUntil) {
        const u = (shakeUntil - now) / shakeDur, a = shakePow * u * u;
        shakeX = rnd(-a, a); shakeY = rnd(-a, a);
        els.shake.style.transform = `translate(${shakeX.toFixed(1)}px,${shakeY.toFixed(1)}px)`;
      } else if (shakeX || shakeY) { shakeX = shakeY = 0; els.shake.style.transform = ""; }
    }
  }

  // ---------- публичный API ----------
  function resize() {
    W = innerWidth; H = innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
    [["web", ctxW], ["fx", ctxF]].forEach(([id]) => {
      const c = document.getElementById(id);
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + "px"; c.style.height = H + "px";
    });
    ctxW = document.getElementById("web").getContext("2d");
    ctxF = document.getElementById("fx").getContext("2d");
    ctxW.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxF.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const Companion = {
    init(opts) {
      els = opts;
      buildEye(); resize();
      addEventListener("resize", resize);
      addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.lastMove = performance.now(); }, { passive: true });
      if (els.play) {
        els.play.addEventListener("pointerenter", () => { hovering = true; });
        els.play.addEventListener("pointerleave", () => { hovering = false; });
        els.play.addEventListener("focus", () => { hovering = true; });
        els.play.addEventListener("blur", () => { hovering = false; });
      }
      readRects();
      const h = home(); eye.x = h.x; eye.y = h.y; resetRopes();
      last = performance.now();
      requestAnimationFrame(frame);
    },
    slam,
    setHoverable(v) { hoverable = !!v; },
    phase(name) {
      if (name === "loading") { wantLoading = true; running = false; }
      else if (name === "running") { wantLoading = false; running = true; flash = 0.7; ring(); if (mode !== "slam" && mode !== "recoil") mode = "follow"; }
      else if (name === "error") { fail(); }
      else { wantLoading = false; running = false; mouse.lastMove = performance.now(); }
    }
  };
  window.Companion = Companion;
})();
