/* FARCIPAL · Companion Eye v2
 * Тело: SVG в двух слоях (статичное тело с кожей и венами + живой слой с радужкой и веками).
 * Щупальца: 13 верле-цепей на canvas, ищут опору на краях интерфейса, между ними паутинные перемычки.
 *
 * API:
 *   Companion.init({ play, progress, shake, targets })   targets: CSS-селектор элементов-опор
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
  const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const angLerp = (a, b, t) => a + angDiff(a, b) * t;
  const f1 = (v) => v.toFixed(1);

  const COLORS = { green: [61, 207, 111], amber: [232, 180, 90], red: [248, 113, 113] };
  const FLESH_GREEN = [24, 96, 54];

  // геометрия: радиус белка в px и в юнитах SVG
  const R = 68, BALL = 92, IRIS = 52, PUPIL = 21, IRIS_K = 0.84, IRIS_E = IRIS * IRIS_K;
  const SVG_PX = (260 / BALL) * R, HALF = SVG_PX / 2;

  // ---------- состояние ----------
  let els = {}, W = innerWidth, H = innerHeight, dpr = 1;
  let ctxW, ctxF, eyeEl;
  let mode = "follow";            // follow | hover | slam | recoil | loading | error | sleep
  let wantLoading = false, running = false, hoverable = true, hovering = false;
  let time = 0, last = 0;

  const eye = { x: W / 2, y: H * 0.3, vx: 0, vy: 0, base: Math.PI * 0.5 };
  const mouse = { x: W / 2, y: H / 2, lastMove: performance.now() };
  const cur = { lid: 0.1, px: 1.3, py: 1.3, sc: 1, spin: 0.2, vis: 0.6, gx: 0, gy: 0, tint: 0, col: [...COLORS.green] };
  let btnRect = null, progRect = null;
  let pinT = 0, flash = 0, sqz = 0, sqzAng = 0, tilt = 0;
  let nextBlink = performance.now() + 2500, blinkAt = -1e9, blinkAgain = false;
  let slamS = null, recoilT0 = 0, recoilTarget = { x: 0, y: 0 };
  let errT0 = 0, errTarget = { x: 0, y: 0 };
  let orbitA = 0, forceLid = null;
  let shakeUntil = 0, shakeDur = 1, shakePow = 0, shakeX = 0, shakeY = 0;
  const trail = [];
  const parts = [];

  // ---------- сборка SVG ----------
  let fib = [], sweepA, sweepB, irisMove, pupilMove, pupil, pupilShade, pupilGlint, tint;
  let edgeU, edgeL, fillUp, fillLo, bandUp, bandLo;

  const sampleQ = (p0, p1, p2, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y });
    }
    return out;
  };

  // жирная вена: многоугольник с плавным сужением
  function taper(pts, w0, w1, scale, ox, oy) {
    const n = pts.length, L = [], Rr = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d, ny = dx / d, t = i / (n - 1);
      const w = lerp(w0, w1, Math.pow(t, 0.75)) * scale * 0.5;
      L.push(f1(pts[i].x + nx * w + ox) + " " + f1(pts[i].y + ny * w + oy));
      Rr.push(f1(pts[i].x - nx * w + ox) + " " + f1(pts[i].y - ny * w + oy));
    }
    return "M" + L.join("L") + "L" + Rr.reverse().join("L") + "Z";
  }

  function buildEye() {
    const $ = (id) => document.getElementById(id);
    eyeEl = $("eye");
    eyeEl.style.width = eyeEl.style.height = SVG_PX.toFixed(1) + "px";
    irisMove = $("irisMove"); pupilMove = $("pupilMove"); pupil = $("pupil");
    pupilShade = $("pupilShade"); pupilGlint = $("pupilGlint"); tint = $("tint");
    veinFlowEl = $("veinFlow"); sweepA = $("sweepA"); sweepB = $("sweepB");
    fib = [$("fibA"), $("fibB"), $("fibC")];
    edgeU = $("edgeU"); edgeL = $("edgeL"); fillUp = $("fillUp"); fillLo = $("fillLo"); bandUp = $("bandUp"); bandLo = $("bandLo");

    // пятна плоти и поры
    const bl = $("blotches");
    const add = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); bl.appendChild(e); };
    for (let i = 0; i < 16; i++) {
      const a = rnd(0, 6.28), d = Math.sqrt(Math.random()) * 86, cx = Math.cos(a) * d, cy = Math.sin(a) * d;
      add("ellipse", {
        cx: f1(cx), cy: f1(cy), rx: f1(rnd(8, 24)), ry: f1(rnd(5, 17)), transform: `rotate(${rnd(0, 180) | 0} ${f1(cx)} ${f1(cy)})`,
        fill: ["#5a4a6a", "#3a5a4c", "#4a4a62", "#05050a"][(Math.random() * 4) | 0], opacity: rnd(0.14, 0.34).toFixed(2)
      });
    }
    for (let i = 0; i < 70; i++) {
      const a = rnd(0, 6.28), d = Math.sqrt(Math.random()) * 88;
      add("circle", { cx: f1(Math.cos(a) * d), cy: f1(Math.sin(a) * d), r: f1(rnd(0.6, 1.7)), fill: "#000", opacity: rnd(0.2, 0.45).toFixed(2) });
    }

    // вены: выходят из-под радужки, ветвятся к краю и слегка перекрывают его
    const veins = [], flows = [];
    const polar = (ang, r) => ({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
    const sampleC = (p0, p1, p2, p3, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), u = 1 - t;
        out.push({
          x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
        });
      }
      return out;
    };
    const N = 14, rIn = IRIS_E - 4, rOut = BALL + 6;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rnd(-0.12, 0.12), bend = rnd(-0.3, 0.3);
      const pts = sampleC(
        polar(a, rIn), polar(a + rnd(-0.22, 0.22), lerp(rIn, rOut, 0.34)),
        polar(a + bend + rnd(-0.22, 0.22), lerp(rIn, rOut, 0.68)), polar(a + bend, rOut), 22);
      const w0 = rnd(6.5, 8.8), w1 = 2.1;
      veins.push({ pts, w0, w1, hi: true });
      flows.push(pts);
      const nb = 1 + ((Math.random() * 2) | 0);
      for (let b = 0; b < nb; b++) {
        const idx = 7 + ((Math.random() * 9) | 0), s0 = pts[idx], t = idx / 21;
        const tx = pts[idx + 1].x - pts[idx - 1].x, ty = pts[idx + 1].y - pts[idx - 1].y;
        let ang = Math.atan2(ty, tx) + (Math.random() < 0.5 ? -1 : 1) * rnd(0.4, 0.8);
        const len = rnd(16, 30);
        let dx = Math.cos(ang), dy = Math.sin(ang);
        if (dx * s0.x + dy * s0.y < 0) { ang = Math.atan2(ty, tx) - Math.sign(ang - Math.atan2(ty, tx)) * rnd(0.4, 0.8); dx = Math.cos(ang); dy = Math.sin(ang); }
        const pw = lerp(w0, w1, Math.pow(t, 0.75));
        veins.push({
          pts: sampleQ(s0, { x: s0.x + dx * len * 0.5 - dy * rnd(-5, 5), y: s0.y + dy * len * 0.5 + dx * rnd(-5, 5) }, { x: s0.x + dx * len, y: s0.y + dy * len }, 11),
          w0: pw * 0.62, w1: 0.9, hi: true
        });
      }
    }
    let dS = "", dM = "", dH = "";
    veins.forEach((v) => {
      dS += taper(v.pts, v.w0, v.w1, 1.5, 1.6, 2.2);
      dM += taper(v.pts, v.w0, v.w1, 1, 0, 0);
      if (v.hi) dH += taper(v.pts, v.w0, v.w1, 0.24, -1.2, -1.5);
    });
    $("veinShadow").appendChild(Object.assign(document.createElementNS(SVGNS, "path"), {})).setAttribute("d", dS);
    $("veinMain").appendChild(document.createElementNS(SVGNS, "path")).setAttribute("d", dM);
    $("veinHi").appendChild(document.createElementNS(SVGNS, "path")).setAttribute("d", dH);

    // бегущий свет по венам (живой слой)
    const vf = $("veinFlow");
    flows.forEach((pts, i) => {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", "M" + pts.map((q) => f1(q.x) + " " + f1(q.y)).join("L"));
      p.setAttribute("stroke-width", f1(rnd(1.1, 1.9)));
      p.style.strokeDashoffset = `calc(var(--vf, 0px) - ${rnd(0, 75).toFixed(1)}px)`;
      p.style.stroke = "var(--ec)";
      vf.appendChild(p);
    });

    // волокна радужки (ДНК FARCIPAL EYE)
    const tones = ["#174f2c", "#1b5e34", "#1f6c3c", "#247a44"];
    const TAU = Math.PI * 2, FIBERS = 210, k = IRIS / 168;
    for (let i = 0; i < FIBERS; i++) {
      const a = (i / FIBERS) * TAU + rnd(-0.025, 0.025);
      const r0 = PUPIL + 1 + rnd(0, 4), r1 = IRIS * (0.5 + Math.random() * 0.46), bend = rnd(-0.04, 0.04);
      const am = a + bend, rm = (r0 + r1) / 2;
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", `M ${f1(Math.cos(a) * r0)} ${f1(Math.sin(a) * r0)} Q ${f1(Math.cos(am) * rm)} ${f1(Math.sin(am) * rm)} ${f1(Math.cos(a + bend * 1.6) * r1)} ${f1(Math.sin(a + bend * 1.6) * r1)}`);
      const lighter = Math.random() < 0.18;
      p.setAttribute("stroke", lighter ? "#2f9a58" : tones[(Math.random() * tones.length) | 0]);
      p.setAttribute("stroke-opacity", (lighter ? rnd(0.3, 0.55) : rnd(0.2, 0.6)).toFixed(2));
      p.setAttribute("stroke-width", ((0.5 + Math.random() * 1.1) * k * 2.2).toFixed(2));
      p.setAttribute("fill", "none");
      fib[i % 3].appendChild(p);
    }
    setLids(0);
  }

  // ---------- веки ----------
  // c: 0 = открыт, 1 = закрыт. Края — миндалевидный разрез: верхний выгнут вверх, нижний вниз,
  // при закрытии оба стягиваются в одну линию.
  function setLids(c) {
    const ysU = lerp(-18, 6, c), ycU = lerp(-70, 14, c);
    const cl = Math.pow(c, 1.5);
    const ysL = lerp(26, 6, cl), ycL = lerp(68, 14, cl);
    const kU = 2 * ycU - ysU, kL = 2 * ycL - ysL;
    const eU = `M -112 ${f1(ysU)} Q 0 ${f1(kU)} 112 ${f1(ysU)}`;
    const eL = `M -112 ${f1(ysL)} Q 0 ${f1(kL)} 112 ${f1(ysL)}`;
    edgeU.setAttribute("d", eU); edgeL.setAttribute("d", eL);
    fillUp.setAttribute("d", `M -112 -240 H 112 V ${f1(ysU)} Q 0 ${f1(kU)} -112 ${f1(ysU)} Z`);
    fillLo.setAttribute("d", `M -112 240 H 112 V ${f1(ysL)} Q 0 ${f1(kL)} -112 ${f1(ysL)} Z`);
    bandUp.setAttribute("d", `M -112 ${f1(ysU)} Q 0 ${f1(kU)} 112 ${f1(ysU)} L 112 ${f1(ysU + 30)} Q 0 ${f1(kU + 30)} -112 ${f1(ysU + 30)} Z`);
    bandLo.setAttribute("d", `M -112 ${f1(ysL)} Q 0 ${f1(kL)} 112 ${f1(ysL)} L 112 ${f1(ysL - 26)} Q 0 ${f1(kL - 26)} -112 ${f1(ysL - 26)} Z`);
  }

  // моргание: быстро закрываем, на миг держим, медленнее открываем (230 мс)
  function blinkAmount(now) {
    const t = (now - blinkAt) / 230;
    if (t < 0 || t > 1) return 0;
    if (t < 0.3) return easeIn(t / 0.3);
    if (t < 0.4) return 1;
    return 1 - easeOut((t - 0.4) / 0.6);
  }

  // ---------- замеры ----------
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left - shakeX, top: r.top - shakeY, right: r.right - shakeX, bottom: r.bottom - shakeY, width: r.width, height: r.height }; };
  function readRects() {
    if (els.play) btnRect = slamS ? btnRect : rectOf(els.play);
    if (els.progress) progRect = rectOf(els.progress);
  }
  const home = () => ({ x: W / 2, y: btnRect ? Math.max(130, btnRect.top - 150) : H * 0.3 });
  const hoverAnchors = () => btnRect ? [
    { x: btnRect.left + btnRect.width * 0.16, y: btnRect.top + 2 },
    { x: btnRect.left + btnRect.width * 0.36, y: btnRect.top + 2 },
    { x: btnRect.left + btnRect.width * 0.56, y: btnRect.top + 2 },
    { x: btnRect.left + btnRect.width * 0.78, y: btnRect.top + 2 },
    { x: btnRect.right - 2, y: btnRect.top + btnRect.height * 0.35 }
  ] : null;

  // ---------- режимы ----------
  function pickMode(now) {
    if (mode === "slam" || mode === "recoil" || mode === "error") return;
    if (wantLoading) mode = "loading";
    else if (running) mode = "sleep";
    else if (hovering && hoverable && btnRect) mode = "hover";
    else if (now - mouse.lastMove > 10000) mode = "sleep";
    else mode = "follow";
  }
  function followTarget() {
    let ox = 118, oy = -90;
    if (mouse.x > W - 240) ox = -118;
    if (mouse.y < 180) oy = 90;
    return { x: clamp(mouse.x + ox, R + 10, W - R - 10), y: clamp(mouse.y + oy, R + 60, H - R - 10) };
  }
  const hoverSpot = () => ({ x: clamp(btnRect.right - 20, R + 10, W - R - 10), y: Math.max(R + 60, btnRect.top - R - 18) });

  // ---------- рывок ----------
  function slam() {
    return new Promise((res) => {
      if (!btnRect || mode === "slam" || mode === "recoil") { res(); return; }
      const r = { ...btnRect };
      const I = { x: clamp(eye.x, r.left + r.width * 0.22, r.right - r.width * 0.12), y: r.top + r.height * 0.1 };
      let dx = eye.x - I.x, dy = eye.y - I.y, d = Math.hypot(dx, dy);
      if (d < 12) { dx = 0; dy = -1; d = 1; }
      const dir = { x: dx / d, y: dy / d };
      slamS = { phase: "wind", t0: performance.now(), from: { x: eye.x, y: eye.y }, B: { x: eye.x + dir.x * 40, y: eye.y + dir.y * 40 }, I, dir, res };
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
      eye.x = lerp(s.B.x, s.I.x, u); eye.y = lerp(s.B.y, s.I.y, u); sqz = u * 0.6;
      if (t >= 1) { s.phase = "hold"; s.t0 = now; impact(s.I); s.res(); }
    } else if (s.phase === "hold") {
      const t = clamp((now - s.t0) / 110, 0, 1);
      eye.x = s.I.x; eye.y = s.I.y; sqz = 1 - t * 0.6;
      if (t >= 1) {
        recoilT0 = now;
        recoilTarget = { x: clamp(s.I.x + s.dir.x * 150, R, W - R), y: clamp(s.I.y + s.dir.y * 150, R + 60, H - R) };
        eye.vx = s.dir.x * 1000; eye.vy = s.dir.y * 1000;
        mode = "recoil"; slamS = null; pinT = 0; engaged.fill(false);
      }
    }
  }
  function impact(pt) {
    flash = 1; sqz = 1;
    doShake(reduced ? 3 : 12, 420);
    burst(pt.x, pt.y, reduced ? 14 : 48, COLORS.green, -Math.PI / 2, 1.5);
    if (els.play) { els.play.classList.add("slammed"); setTimeout(() => els.play.classList.remove("slammed"), 300); }
    ring();
    const an = hoverAnchors(); if (an) an.forEach((q) => pulses.push({ x: q.x, y: q.y, t: 0 }));
  }
  function doShake(pow, dur) { shakePow = pow; shakeDur = dur; shakeUntil = performance.now() + dur; }

  // ---------- ошибка ----------
  function fail() {
    slamS = null;
    const ctr = btnRect ? { x: (btnRect.left + btnRect.right) / 2, y: (btnRect.top + btnRect.bottom) / 2 } : { x: W / 2, y: H / 2 };
    let dx = eye.x - ctr.x, dy = eye.y - ctr.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    if (Math.abs(dx) < 0.3) dx = Math.random() < 0.5 ? -0.7 : 0.7;
    wantLoading = false; running = false; snapAll();
    mode = "error"; errT0 = performance.now(); pinT = 0;
    eye.vx = dx * 1500; eye.vy = dy * 1500 - 300;
    errTarget = { x: clamp(eye.x + dx * 200, R + 10, W - R - 10), y: clamp(eye.y + dy * 120 - 60, R + 60, H - R - 10) };
    burst(eye.x, eye.y, reduced ? 6 : 18, COLORS.red, Math.atan2(dy, dx), 2.4);
    doShake(reduced ? 1 : 4, 260);
  }

  // ---------- частицы ----------
  function burst(x, y, n, col, baseAng, spread) {
    for (let i = 0; i < n && parts.length < 140; i++) {
      const a = baseAng + rnd(-spread, spread) * 0.5, sp = n <= 4 ? rnd(40, 150) : rnd(160, 640), frag = n > 4 && Math.random() < 0.3;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(0.45, 1.1), size: frag ? rnd(6, 14) : Math.floor(rnd(2, 5)), frag, ang: rnd(0, 6.28), spin: rnd(-9, 9), col });
    }
  }
  function ring() {
    const g = document.getElementById("rings");
    if (!g || !g.animate) return;
    for (let i = 0; i < 3; i++) {
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("fill", "none"); c.setAttribute("stroke-width", "1.5"); c.style.stroke = "var(--ec)";
      g.appendChild(c);
      try { const a = c.animate([{ r: "20px", opacity: 0.8 }, { r: "125px", opacity: 0 }], { duration: 900, delay: i * 120, easing: "ease-out", fill: "both" }); a.onfinish = () => c.remove(); } catch { c.remove(); }
    }
  }

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
    readRects(); scanHover(now); pickMode(now);

    const bobK = reduced ? 0 : 1;
    const bob = { x: Math.sin(time * 0.9) * 6 * bobK, y: Math.cos(time * 1.3) * 9 * bobK };
    let lid = 1, px = 1, py = 1, sc = 1, spin = 1, vis = 1, col = COLORS.green, tintT = 0;
    let gazeAt = { x: mouse.x, y: mouse.y };
    let pin = false;

    if (mode === "follow") {
      const T = lastWant === "cap" ? { x: clamp(capPerch.x, R + 10, W - R - 10), y: clamp(capPerch.y, R + 60, H - R - 10) } : followTarget();
      spring(T.x + bob.x * 0.6 + pullVec.x, T.y + bob.y * 0.6 + pullVec.y, 24, 0.75, dt);
    } else if (mode === "hover") {
      const T = hoverSpot(); spring(T.x + bob.x * 0.4 - pullAmt * 3, T.y + bob.y * 0.4 + pullAmt * 9, 40, 0.7, dt);
      px = 0.4; py = 1.22; lid = 0.93; pin = true;
    } else if (mode === "slam") {
      stepSlam(now); px = 0.3; py = 1.25; lid = 0.88; pin = true;
      if (btnRect) gazeAt = { x: (btnRect.left + btnRect.right) / 2, y: (btnRect.top + btnRect.bottom) / 2 };
    } else if (mode === "recoil") {
      spring(recoilTarget.x, recoilTarget.y, 70, 0.5, dt); px = 0.7; py = 1.1;
      if (now - recoilT0 > 420) mode = "follow";
    } else if (mode === "loading") {
      col = COLORS.amber; sc = 0.62; px = 0.82; py = 0.88; spin = 3; tintT = 0.1;
      if (progRect) {
        orbitA += dt * 2.2;
        const cx = progRect.left + progRect.width / 2, cy = progRect.top + progRect.height / 2 + 6;
        const rx = Math.min(progRect.width / 2 + 56, W / 2 - 90), ry = 44;
        spring(cx + Math.cos(orbitA) * rx, cy + Math.sin(orbitA) * ry, 90, 0.8, dt);
        gazeAt = { x: cx, y: cy };
      }
    } else if (mode === "error") {
      col = COLORS.red; px = 0.5; py = 1.1; lid = 0.7; spin = 0.4; tintT = 0.22;
      spring(errTarget.x, errTarget.y, 30, 0.45, dt);
      if (btnRect) gazeAt = { x: (btnRect.left + btnRect.right) / 2, y: (btnRect.top + btnRect.bottom) / 2 };
      if (now - errT0 > 2300) mode = "follow";
    } else if (mode === "sleep") {
      const T = home(); spring(T.x + bob.x * 0.5, T.y + bob.y * 0.6, 7, 0.9, dt);
      lid = 0.09; px = 1.35; py = 1.35; spin = 0.15; vis = 0.65;
      gazeAt = { x: eye.x, y: eye.y + 80 };
    }

    pinT = pin ? Math.min(1, pinT + dt * 2.2) : 0;
    flash = Math.max(0, flash - dt * 2.6);
    if (mode !== "slam") sqz = Math.max(0, sqz - dt * 5);

    // моргание: рандомно, иногда двойное; во сне не моргаем
    if (mode !== "sleep" && now > nextBlink) {
      blinkAt = now; blinkAgain = Math.random() < 0.16;
      nextBlink = blinkAgain ? now + 330 : now + (mode === "loading" ? rnd(5000, 9000) : rnd(2600, 6500));
      if (blinkAgain) blinkAgain = false;
    }

    const sm = damp(dt, 9);
    cur.lid = lerp(cur.lid, lid, damp(dt, lid < cur.lid ? 14 : 6));
    cur.px = lerp(cur.px, px, sm); cur.py = lerp(cur.py, py, sm);
    cur.sc = lerp(cur.sc, sc, damp(dt, 5));
    cur.spin = lerp(cur.spin, spin, damp(dt, 3));
    cur.vis = lerp(cur.vis, vis, damp(dt, 3));
    cur.tint = lerp(cur.tint, tintT, damp(dt, 4));
    for (let i = 0; i < 3; i++) cur.col[i] = lerp(cur.col[i], col[i], damp(dt, 5));

    const ex = gazeAt.x - eye.x, ey = gazeAt.y - eye.y, ed = Math.hypot(ex, ey) || 1, g = Math.min(1, ed / 220);
    cur.gx = lerp(cur.gx, (ex / ed) * g, damp(dt, 22));
    cur.gy = lerp(cur.gy, (ey / ed) * g, damp(dt, 22));
    tilt = lerp(tilt, clamp(eye.vx * 0.008, -7, 7), damp(dt, 6));

    updateThreads(dt);
    draw(now);
  }

  // ---------- живая сеть: нити с жизненным циклом ----------
  // Thread: wait → grow (вырастает из глаза) → live (колышется, передаёт данные, ветвится) → cut (обрыв) → wait → ...
  const NMAIN = 14, NPM = 18, NPC = 10, MAXKIDS = 10;
  const LEGS = [3, 4, 5, 6, 7];          // нити-«лапки»: цепляются за кнопку и за элементы под курсором
  const nz = (x) => (Math.sin(x) + 0.5 * Math.sin(2.13 * x + 1.7) + 0.25 * Math.sin(4.7 * x + 4.1)) / 1.75;
  const smooth01 = (t) => t * t * (3 - 2 * t);
  const pulses = [];                      // вспышки-узлы в точках крепления
  const engaged = [false, false, false, false, false];
  let capAge = 0, leaveAge = 0, lastWant = null, pullAmt = 0, lastCapEl = null, stepsDone = 0;
  const pullVec = { x: 0, y: 0 };

  // периметр прямоугольника: параметр s идёт по часовой от левого верхнего угла
  const pinfo = { s: 0, nx: 0, ny: -1, px: 0, py: 0 };
  function perimInfo(r, x, y) {
    const w = r.width, h = r.height;
    const cx = clamp(x, r.left, r.right), cy = clamp(y, r.top, r.bottom);
    const dl = cx - r.left, dr = r.right - cx, dt = cy - r.top, db = r.bottom - cy, m = Math.min(dl, dr, dt, db);
    if (m === dt) { pinfo.s = cx - r.left; pinfo.nx = 0; pinfo.ny = -1; pinfo.px = cx; pinfo.py = r.top; }
    else if (m === dr) { pinfo.s = w + (cy - r.top); pinfo.nx = 1; pinfo.ny = 0; pinfo.px = r.right; pinfo.py = cy; }
    else if (m === db) { pinfo.s = w + h + (r.right - cx); pinfo.nx = 0; pinfo.ny = 1; pinfo.px = cx; pinfo.py = r.bottom; }
    else { pinfo.s = 2 * w + h + (r.bottom - cy); pinfo.nx = -1; pinfo.ny = 0; pinfo.px = r.left; pinfo.py = cy; }
    return pinfo;
  }
  function perimPoint(r, s) {
    const w = r.width, h = r.height, P = 2 * (w + h);
    s = ((s % P) + P) % P;
    if (s < w) return { x: r.left + s, y: r.top };
    s -= w; if (s < h) return { x: r.right, y: r.top + s };
    s -= h; if (s < w) return { x: r.right - s, y: r.bottom };
    s -= w; return { x: r.left, y: r.bottom - s };
  }

  class Thread {
    constructor(i, n, isKid) {
      this.i = i; this.n = n; this.isKid = !!isKid;
      this.leg = isKid ? -1 : LEGS.indexOf(i);
      this.pts = Array.from({ length: n }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
      this.pk = [];
      this.ph = rnd(0, 6.28); this.sway = rnd(0.55, 1);
      this.state = "wait"; this.wait = isKid ? 0 : rnd(0.05, 1.6);
      this.parent = null;
      this.reset();
    }
    reset() {
      this.target = null; this.reachT = 0; this.attachAge = 0; this.pinned = false; this.held = false;
      this.grow = 0; this.growDur = 1; this.age = 0; this.life = 6; this.off = 0; this.rel = 0; this.ri = 0;
      this.reach = 110; this.L = 7; this.Lc = 7; this.cut = 0; this.cutT = 0; this.kids = 0;
      this.branchT = rnd(1.2, 3); this.taut = 0; this.pkT = rnd(0.2, 1.4); this.stepCd = 0; this.thr = rnd(70, 110);
      this.pk.length = 0; this.fresh = true;
    }
    get alive() { return this.state === "grow" || this.state === "live"; }

    spawn(quick) {
      this.reset();
      this.state = "grow";
      this.growDur = quick ? 0.4 : rnd(0.9, 1.6);
      this.life = rnd(4.5, 9.5);
      this.off = rnd(-1.9, 1.9);
      this.reach = rnd(95, 150);
      this.L = (this.reach / (this.n - 1)) * rnd(0.9, 1.15);
    }
    spawnChild(parent, ri) {
      this.reset(); this.parent = parent; this.ri = ri; parent.kids++;
      this.state = "grow"; this.growDur = rnd(0.5, 0.9); this.life = rnd(1.4, 3.2);
      this.rel = (Math.random() < 0.5 ? -1 : 1) * rnd(0.5, 0.95);
      this.reach = rnd(38, 72); this.L = this.reach / (this.n - 1);
    }

    // обрыв: дальняя часть улетает и гаснет, ближняя втягивается обратно
    snap(kb) {
      if (!this.alive) return;
      const n = this.n, grown = Math.floor(this.grow * (n - 1));
      let cut = kb != null ? kb : Math.floor((n - 1) * rnd(0.3, 0.75));
      cut = Math.min(cut, grown - 1);
      if (this.parent) this.parent.kids--;
      this.target = null; this.pinned = false; this.held = false; this.pk.length = 0;
      if (cut < 2) { this.state = "wait"; this.wait = 0.2; this.parent = null; return; }
      this.state = "cut"; this.cut = cut; this.cutT = 0;
      const p = this.pts[cut];
      if (!this.parent) burst(p.x, p.y, 3, [...cur.col], rnd(0, 6.28), 6.28);
      for (let k = cut + 1; k < n; k++) { this.pts[k].px += rnd(-3, 3); this.pts[k].py += rnd(-3, 3); }
    }

    step(dt, E) {
      const n = this.n;
      if (this.state === "wait") {
        this.wait -= dt;
        if (!this.isKid && this.wait <= 0 && mode !== "error") {
          const legOn = this.leg >= 0 && E.engaged[this.leg] && E.want && E.legD[this.leg];
          if (legOn) this.spawn(true);
          else if (this.i < E.activeMax) this.spawn(false);
        }
        return;
      }

      // ---- корень нити и направление роста
      let rx, ry, dirAng;
      if (this.parent) {
        const pp = this.parent;
        if (!pp.alive && this.alive) { if (this.state === "grow") this.grow = Math.max(this.grow, 0.3); this.life = 0; this.age = 1; this.state = this.state === "grow" ? "live" : this.state; }
        const ri = Math.min(this.ri, pp.n - 2), a = pp.pts[ri], b = pp.pts[ri + 1], c = pp.pts[Math.max(0, ri - 1)];
        rx = a.x; ry = a.y; dirAng = Math.atan2(b.y - c.y, b.x - c.x) + this.rel;
      } else {
        let phi = eye.base + this.off;
        if (this.leg >= 0 && E.engaged[this.leg] && E.want && E.legD[this.leg]) phi = Math.atan2(E.legD[this.leg].y - eye.y, E.legD[this.leg].x - eye.x);
        this.phi = phi;
        rx = eye.x + Math.cos(phi) * E.rr; ry = eye.y + Math.sin(phi) * E.rr;
        dirAng = phi + 0.6 * nz(time * 0.35 + this.ph);
      }
      const pts = this.pts, Lb = this.L * E.sc;
      if (this.fresh) { pts.forEach((p) => { p.x = p.px = rx; p.y = p.py = ry; }); this.Lc = Lb; this.fresh = false; }

      // ---- жизненный цикл
      if (this.state === "grow") { this.grow = Math.min(1, this.grow + dt / this.growDur); if (this.grow >= 1) this.state = "live"; }
      else if (this.state === "live") {
        if (!this.held) this.age += dt * E.tScale;
        if (!this.held && this.age >= this.life) this.snap();
      }

      // ---- лапки: цепляются за кнопку и ходят по элементу под курсором
      if (this.leg >= 0) {
        const on = E.engaged[this.leg] && E.want, D = on ? E.legD[this.leg] : null;
        if (this.state === "grow" && on) this.growDur = Math.min(this.growDur, 0.4);
        this.held = !!on && E.want === "play" && this.state !== "cut";
        if (!on && this.target && this.state === "live") this.snap();
        if (this.state === "live" && D) {
          const plant = () => { this.target = { x: D.x, y: D.y }; this.reachT = 0; this.pinned = false; this.attachAge = 0; };
          if (!this.target) { plant(); if (E.want === "cap") this.life = this.age + rnd(2.6, 5.2); }
          else if (E.want === "play") {
            if (Math.hypot(this.target.x - D.x, this.target.y - D.y) > 30) plant(); else { this.target.x = D.x; this.target.y = D.y; }
          }
          else {
            this.stepCd -= dt;
            if (Math.hypot(this.target.x - D.x, this.target.y - D.y) > this.thr && this.stepCd <= 0 && E.stepsFree > 0) {
              E.stepsFree--; plant(); stepsDone++; this.stepCd = rnd(0.16, 0.32); this.thr = rnd(70, 110);
            }
          }
        }
      }
      // перетянули или eye дёрнулся слишком резко — обрыв
      if (this.target && this.state === "live" && !this.held) {
        if (Math.hypot(this.target.x - rx, this.target.y - ry) > 300 * E.sc || E.speed > 650) this.snap();
      }

      // ---- физика (верле) с шумом: сеть дышит и колышется всегда
      const cutting = this.state === "cut", kb = cutting ? this.cut : -1;
      const gi = this.state === "grow" ? Math.max(2, Math.floor(this.grow * (n - 1))) : n - 1;
      const att = this.target ? easeOut(this.reachT) : 0, asleep = mode === "sleep";
      const grav = asleep ? 170 : 40, breath = 1 + 0.16 * Math.sin(time * 0.9 + this.ph);
      const dx = Math.cos(dirAng), dy = Math.sin(dirAng), dt2 = dt * dt;
      for (let k = 1; k <= gi; k++) {
        const p = pts[k], f = k / (n - 1);
        let ax = 0, ay = grav;
        if (!(cutting && k > kb)) {
          if (!cutting) {
            const sk = (asleep ? 10 : 46) * (0.15 + 0.85 * f) * (1 - att);
            ax += (rx + dx * k * Lb * breath - p.x) * sk; ay += (ry + dy * k * Lb * breath - p.y) * sk;
          }
          const a = pts[k - 1], b = pts[Math.min(gi, k + 1)];
          let nx = -(b.y - a.y), ny = b.x - a.x; const nd = Math.hypot(nx, ny) || 1; nx /= nd; ny /= nd;
          const w = (asleep ? 60 : 420) * f * (1 - 0.8 * att) * this.sway * (nz(time * 1.5 + k * 0.52 + this.ph) + 0.6 * Math.sin(time * 2.9 + k * 0.9 + this.ph * 2));
          ax += nx * w; ay += ny * w;
        }
        const vx = (p.x - p.px) * 0.94, vy = (p.y - p.py) * 0.94;
        p.px = p.x; p.py = p.y; p.x += vx + ax * dt2; p.y += vy + ay * dt2;
      }
      pts[0].x = pts[0].px = rx; pts[0].y = pts[0].py = ry;

      // ---- крепление: кончик тянется к опоре, натяжение нарастает постепенно
      let pinTip = false, Lt = Lb;
      if (this.target && this.state === "live") {
        const tip = pts[n - 1];
        this.reachT = Math.min(1, this.reachT + dt * 2.6);
        if (this.reachT < 1) { const kk = damp(dt, 4 + 14 * this.reachT); tip.x += (this.target.x - tip.x) * kk; tip.y += (this.target.y - tip.y) * kk; }
        else {
          if (!this.pinned) {
            this.pinned = true; this.attachAge = 0;
            pulses.push({ x: this.target.x, y: this.target.y, t: 0 });
            for (let k = 3; k < n - 2; k++) pts[k].px += (k % 2 ? 1 : -1) * rnd(1.5, 4);   // дрожь при зацепе
          }
          tip.x = this.target.x; tip.y = this.target.y; pinTip = true; this.attachAge += dt;
        }
        const dist = Math.hypot(this.target.x - rx, this.target.y - ry);
        const slack = this.pinned ? lerp(0.38, 0.025, smooth01(clamp(this.attachAge / 0.9, 0, 1))) : 0.22;
        Lt = Math.max(Lb, (dist / (n - 1)) * (1 + slack));
      }
      this.Lc += (Lt - this.Lc) * damp(dt, 9);
      const L = this.Lc, shrink = cutting ? 1 - 0.9 * easeOut(Math.min(1, this.cutT / 0.5)) : 1;
      for (let it = 0; it < 4; it++) {
        for (let k = 0; k < gi; k++) {
          if (cutting && k === kb) continue;
          const a = pts[k], b = pts[k + 1], ddx = b.x - a.x, ddy = b.y - a.y, d = Math.hypot(ddx, ddy) || 0.0001;
          const diff = (d - (cutting && k < kb ? L * shrink : L)) / d;
          const wa = k === 0 ? 0 : 0.5, wb = (pinTip && k + 1 === n - 1) ? 0 : 0.5, tw = wa + wb;
          if (tw === 0) continue;
          a.x += ddx * diff * (wa / tw); a.y += ddy * diff * (wa / tw);
          b.x -= ddx * diff * (wb / tw); b.y -= ddy * diff * (wb / tw);
        }
        if (pinTip) { pts[n - 1].x = this.target.x; pts[n - 1].y = this.target.y; }
      }
      for (let k = gi + 1; k < n; k++) { pts[k].x = pts[k].px = pts[gi].x; pts[k].y = pts[k].py = pts[gi].y; }
      this.taut = clamp(Math.hypot(pts[gi].x - rx, pts[gi].y - ry) / (gi * L), 0, 1);

      if (cutting) {
        this.cutT += dt;
        if (this.cutT >= 0.75) { this.state = "wait"; this.wait = this.leg >= 0 ? rnd(0.15, 0.5) : rnd(0.3, 1.2); this.parent = null; this.pk.length = 0; }
      }
      this.stepPackets(dt);
    }

    // бегущие «пакеты данных»: от глаза к опоре и обратно
    stepPackets(dt) {
      if (this.state !== "live") { if (this.pk.length) this.pk.length = 0; return; }
      this.pkT -= dt;
      if (this.pkT <= 0 && this.pk.length < 3) {
        this.pkT = this.pinned ? rnd(0.35, 0.9) : rnd(1.1, 3);
        if (!this.isKid || Math.random() < 0.5) this.pk.push({ s: 0, v: rnd(7, 12), d: 1 });
      }
      for (let i = this.pk.length - 1; i >= 0; i--) {
        const q = this.pk[i]; q.s += q.v * q.d * dt;
        if (q.d > 0 && q.s >= this.n - 1) {
          if (this.pinned) {
            pulses.push({ x: this.target.x, y: this.target.y, t: 0, small: true });
            if (Math.random() < 0.6) { q.d = -1; q.s = this.n - 1; q.v = rnd(6, 10); } else this.pk.splice(i, 1);
          } else this.pk.splice(i, 1);
        } else if (q.d < 0 && q.s <= 0) this.pk.splice(i, 1);
      }
    }

    draw(ctx, vis, fl) {
      if (this.state === "wait") return;
      const n = this.n, pts = this.pts, cutting = this.state === "cut";
      const gIdx = this.state === "grow" ? Math.max(1, Math.floor(this.grow * (n - 1))) : n - 1;
      const breath = 0.8 + 0.2 * Math.sin(time * 1.1 + this.ph);
      const base = vis * breath * Math.min(1, 0.25 + this.grow * 2.5);
      const mix = clamp((this.pinned ? this.taut * 0.4 : 0) + fl * 0.6, 0, 1);
      const c = [lerp(cur.col[0], 215, mix), lerp(cur.col[1], 255, mix), lerp(cur.col[2], 228, mix)];
      const path = (a, b) => {
        ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y);
        for (let k = a + 1; k < b; k++) ctx.quadraticCurveTo(pts[k].x, pts[k].y, (pts[k].x + pts[k + 1].x) / 2, (pts[k].y + pts[k + 1].y) / 2);
        ctx.lineTo(pts[b].x, pts[b].y);
      };
      const stroke = (a, b, alpha) => {
        if (b - a < 1 || alpha <= 0.01) return;
        path(a, b);
        ctx.strokeStyle = rgba(cur.col, 0.07 * alpha); ctx.lineWidth = 5; ctx.stroke();           // мягкое свечение
        ctx.strokeStyle = rgba(c, 0.78 * alpha); ctx.lineWidth = 1.05; ctx.stroke();               // тонкое ядро
        ctx.setLineDash(this.pinned ? [2, 5] : [1.4, 9]); ctx.lineDashOffset = -time * (this.pinned ? 64 : 26);
        ctx.strokeStyle = rgba([225, 255, 235], 0.6 * alpha); ctx.lineWidth = 1.4; ctx.stroke();   // поток данных
        ctx.setLineDash([]);
        const e = a + Math.max(1, Math.floor((b - a) * 0.4));
        path(a, e); ctx.strokeStyle = rgba(c, 0.5 * alpha); ctx.lineWidth = 2; ctx.stroke();       // утолщение у корня
      };
      ctx.globalCompositeOperation = "lighter";
      if (cutting) {
        const ci = Math.floor(this.cut);
        stroke(0, ci, base * clamp(1 - this.cutT / 0.55, 0, 1));
        stroke(ci + 1, n - 1, base * clamp(1 - this.cutT / 0.7, 0, 1));
        return;
      }
      stroke(0, gIdx, base);
      // узлы: кончик растущей нити, место ветвления, точка крепления
      const tip = pts[gIdx], growing = this.state === "grow";
      if (this.pinned) {
        ctx.fillStyle = rgba(c, 0.85 * vis); ctx.beginPath(); ctx.arc(tip.x, tip.y, 2.3, 0, 6.283); ctx.fill();
      } else {
        ctx.fillStyle = rgba(c, (growing ? 0.95 : 0.5 + 0.3 * Math.sin(time * 5 + this.ph)) * base);
        ctx.beginPath(); ctx.arc(tip.x, tip.y, growing ? 2.2 : 1.3, 0, 6.283); ctx.fill();
        ctx.fillStyle = rgba(c, 0.14 * base); ctx.beginPath(); ctx.arc(tip.x, tip.y, 5, 0, 6.283); ctx.fill();
      }
      if (this.parent) {
        ctx.fillStyle = rgba(c, 0.9 * vis); ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 2.2, 0, 6.283); ctx.fill();
        ctx.fillStyle = rgba(c, 0.18 * vis); ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 5.5, 0, 6.283); ctx.fill();
      }
      // бегущие точки с хвостом
      for (const q of this.pk) {
        for (let h = 0; h < 4; h++) {
          const s = q.s - q.d * h * 0.8;
          if (s < 0 || s > n - 1) continue;
          const i = Math.min(n - 2, Math.floor(s)), u = s - i;
          const x = lerp(pts[i].x, pts[i + 1].x, u), y = lerp(pts[i].y, pts[i + 1].y, u);
          ctx.fillStyle = rgba([232, 255, 242], (1 - h * 0.27) * 0.9 * vis); ctx.beginPath(); ctx.arc(x, y, 2.1 - h * 0.35, 0, 6.283); ctx.fill();
          if (h === 0) { ctx.fillStyle = rgba(cur.col, 0.22 * vis); ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.283); ctx.fill(); }
        }
      }
    }
  }

  const threads = Array.from({ length: NMAIN }, (_, i) => new Thread(i, NPM, false));
  const kids = Array.from({ length: MAXKIDS }, (_, i) => new Thread(100 + i, NPC, true));
  function resetThreads() { threads.forEach((t) => { t.state = "wait"; t.wait = rnd(0.05, 1.4); t.reset(); }); }
  const E = { rr: 0, sc: 1, want: null, legD: [null, null, null, null, null], engaged, stepsFree: 2, activeMax: NMAIN, tScale: 1, speed: 0 };

  function snapAll() { engaged.fill(false); threads.forEach((t) => t.snap()); kids.forEach((k) => k.snap()); }

  // что под курсором: элемент, за который можно зацепиться
  let capEl = null, capRect = null, capS = 0, lastHit = -1e9;
  const capPerch = { x: 0, y: 0 };   // точка рядом с элементом, откуда глаз «щупает» его сетью
  function scanHover(now) {
    if (now - lastHit > 50) {
      lastHit = now;
      const el = els.targets ? document.elementFromPoint(mouse.x, mouse.y) : null;
      const c = el ? el.closest(els.targets) : null;
      capEl = c && c !== els.play ? c : null;
    }
    capRect = capEl ? rectOf(capEl) : null;
  }

  function updateThreads(dt) {
    const speed = Math.hypot(eye.vx, eye.vy);
    if (speed > 40) eye.base = angLerp(eye.base, Math.atan2(-eye.vy, -eye.vx), 0.07);
    const sc = cur.sc, asleep = mode === "sleep";
    E.rr = R * sc * 0.8; E.sc = sc; E.speed = speed;
    E.tScale = asleep ? 0.35 : 1; E.activeMax = asleep ? 6 : NMAIN;

    // чего хотим: зацепиться за кнопку или «исследовать» элемент под курсором
    const anch = hoverAnchors();
    const hoverMode = (mode === "hover" || mode === "slam") && !!anch;
    const capActive = !hoverMode && mode === "follow" && !!capRect && sc > 0.9;
    const want = hoverMode ? "play" : capActive ? "cap" : null;
    if (want !== lastWant) { if (want) capAge = 0; else leaveAge = 0; lastWant = want; }
    if (want) { capAge += dt; leaveAge = 0; } else { leaveAge += dt; capAge = 0; }
    if (mode === "slam") capAge = Math.max(capAge, 5);
    E.want = want;

    if (want === "cap") {
      const P = 2 * (capRect.width + capRect.height), inf = perimInfo(capRect, mouse.x, mouse.y), sT = inf.s;
      capPerch.x = inf.px + inf.nx * 125; capPerch.y = inf.py + inf.ny * 125;
      if (capEl !== lastCapEl) { capS = sT; lastCapEl = capEl; }
      else capS += clamp(((sT - capS + P * 1.5) % P) - P / 2, -520 * dt, 520 * dt);
    }
    for (let j = 0; j < 5; j++) {
      if (want) { if (capAge > (want === "play" ? 0.12 + j * 0.17 : 0.1 + j * 0.15)) engaged[j] = true; }
      else if (engaged[j] && leaveAge > j * 0.09) engaged[j] = false;     // отпускаем по одной
      let D = null;
      if (want === "play") D = anch[j];
      else if (want === "cap") {
        const p = perimPoint(capRect, capS + (j - 2) * 85), d = Math.hypot(p.x - eye.x, p.y - eye.y);
        if (d < 255 * sc && d > R * sc * 1.1 + 14) D = p;
      }
      E.legD[j] = D;
    }

    let stepping = 0;
    threads.forEach((t) => { if (t.leg >= 0 && t.target && t.reachT < 1) stepping++; });
    E.stepsFree = Math.max(0, 2 - stepping);

    threads.forEach((t) => t.step(dt, E));
    kids.forEach((k) => k.step(dt, E));

    // ветвление: от живой нити иногда отрастает боковая
    if (!asleep) {
      for (const t of threads) {
        if (t.state !== "live") continue;
        t.branchT -= dt;
        if (t.branchT <= 0) {
          t.branchT = rnd(1.6, 4);
          if (t.kids < 1 || (t.kids < 2 && Math.random() < 0.3)) { const k = kids.find((x) => x.state === "wait"); if (k) k.spawnChild(t, 4 + ((Math.random() * (t.n - 9)) | 0)); }
        }
      }
    }

    for (let i = pulses.length - 1; i >= 0; i--) { pulses[i].t += dt * 2.2; if (pulses[i].t >= 1) pulses.splice(i, 1); }

    // натяжение сети чуть тянет глаз к тому, за что он держится
    let nPin = 0, sx = 0, sy = 0;
    for (const t of threads) if (t.leg >= 0 && t.pinned && t.target) { nPin++; sx += t.target.x - eye.x; sy += t.target.y - eye.y; }
    const len = Math.hypot(sx, sy) || 1, mag = Math.min(22, len / Math.max(1, nPin) * 0.12);
    pullVec.x = lerp(pullVec.x, nPin ? (sx / len) * mag : 0, damp(dt, 6));
    pullVec.y = lerp(pullVec.y, nPin ? (sy / len) * mag : 0, damp(dt, 6));
    pullAmt = lerp(pullAmt, want === "play" ? nPin / 5 : 0, damp(dt, 6));
  }

  // ---------- отрисовка ----------
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  let lastEc = "", veinFlowEl = null;

  function drawThreads() {
    const ctx = ctxW, fl = flash, vis = cur.vis;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // паутинные перемычки между соседними нитями: едва заметные, мерцают в такт дыханию
    ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = 0.7;
    for (let i = 0; i < NMAIN - 1; i++) {
      const A = threads[i], B = threads[i + 1];
      if (A.state !== "live" || B.state !== "live") continue;
      for (let r = 0; r < 3; r++) {
        const k = 4 + r * 4, pa = A.pts[k], pb = B.pts[k], d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        if (d > 140 || d < 3) continue;
        ctx.strokeStyle = rgba(cur.col, (0.26 * (1 - d / 140) * (0.6 + 0.4 * Math.sin(time * 2 + i + r * 1.7)) + fl * 0.3) * vis);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y);
        ctx.quadraticCurveTo((pa.x + pb.x) / 2, (pa.y + pb.y) / 2 + 4 + (1 - Math.min(A.taut, B.taut)) * 6, pb.x, pb.y); ctx.stroke();
      }
    }
    for (let i = 0; i < NMAIN; i++) threads[i].draw(ctx, vis, fl);
    for (let i = 0; i < MAXKIDS; i++) kids[i].draw(ctx, vis, fl);
    // вспышки-узлы в точках крепления
    ctx.globalCompositeOperation = "lighter";
    for (const p of pulses) {
      const a = (1 - p.t) * (p.small ? 0.5 : 0.75), r = 2 + p.t * (p.small ? 9 : 16);
      ctx.strokeStyle = rgba([225, 255, 235], a * vis); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.stroke();
      ctx.fillStyle = rgba(cur.col, a * vis); ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function draw(now) {
    // --- тело ---
    const sc = cur.sc, sx = 1 - 0.24 * sqz, sy = 1 + 0.16 * sqz;
    let jx = 0, jy = 0;
    if (mode === "error") { const a = Math.max(0, 1 - (now - errT0) / 1300) * 7; jx = rnd(-a, a); jy = rnd(-a, a); }
    eyeEl.style.transform =
      `translate3d(${f1(eye.x + jx - HALF)}px,${f1(eye.y + jy - HALF)}px,0) rotate(${tilt.toFixed(2)}deg) ` +
      `rotate(${sqzAng.toFixed(3)}rad) scale(${(sx * sc).toFixed(3)},${(sy * sc).toFixed(3)}) rotate(${(-sqzAng).toFixed(3)}rad)`;

    const ec = `rgb(${cur.col[0] | 0},${cur.col[1] | 0},${cur.col[2] | 0})`;
    if (ec !== lastEc) { eyeEl.parentNode.style.setProperty("--ec", ec); lastEc = ec; }
    tint.setAttribute("opacity", cur.tint.toFixed(3));

    irisMove.setAttribute("transform", `translate(${f1(cur.gx * 30)} ${f1(cur.gy * 30)})`);
    pupilMove.setAttribute("transform", `translate(${f1(cur.gx * 10)} ${f1(cur.gy * 10)})`);
    pupil.setAttribute("rx", (PUPIL * cur.px).toFixed(2)); pupil.setAttribute("ry", (PUPIL * cur.py).toFixed(2));
    pupilShade.setAttribute("rx", ((PUPIL + 10) * cur.px).toFixed(2)); pupilShade.setAttribute("ry", ((PUPIL + 10) * cur.py).toFixed(2));
    pupilGlint.setAttribute("cx", f1(-6 * cur.px)); pupilGlint.setAttribute("cy", f1(-7 * Math.min(cur.py, 1.15)));

    // веки: базовая открытость + естественное моргание
    const baseC = 1 - clamp(cur.lid, 0, 1), b = blinkAmount(now);
    setLids(forceLid != null ? forceLid : baseC + b * (1 - baseC));

    veinFlowEl.style.setProperty("--vf", (-((time * 23) % 75)).toFixed(1) + "px");
    const sp = cur.spin * time;
    fib[0].setAttribute("transform", `rotate(${(sp * 2.9).toFixed(2)})`);
    fib[1].setAttribute("transform", `rotate(${(-sp * 2).toFixed(2)})`);
    fib[2].setAttribute("transform", `rotate(${(sp * 1.1).toFixed(2)})`);
    sweepA.setAttribute("transform", `rotate(${(sp * 52).toFixed(1)})`);
    sweepB.setAttribute("transform", `rotate(${(-sp * 83).toFixed(1)})`);

    // --- canvas: след, щупальца ---
    ctxW.clearRect(0, 0, W, H);
    if (mode === "loading" || trail.length) {
      if (mode === "loading") { trail.push({ x: eye.x, y: eye.y }); if (trail.length > 48) trail.shift(); } else trail.shift();
      ctxW.globalCompositeOperation = "lighter"; ctxW.lineCap = "round";
      for (let i = 1; i < trail.length; i++) {
        const u = i / trail.length;
        ctxW.strokeStyle = rgba(cur.col, 0.45 * u); ctxW.lineWidth = 1 + 3.2 * u * sc;
        ctxW.beginPath(); ctxW.moveTo(trail[i - 1].x, trail[i - 1].y); ctxW.lineTo(trail[i].x, trail[i].y); ctxW.stroke();
      }
    }
    drawThreads();

    // --- частицы поверх глаза ---
    ctxF.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += 1 / 60;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.vy += 900 / 60; p.vx *= 0.985; p.x += p.vx / 60; p.y += p.vy / 60; p.ang += p.spin / 60;
      const a = 1 - p.life / p.max;
      ctxF.fillStyle = ctxF.strokeStyle = rgba(p.col, a);
      if (p.frag) { ctxF.lineWidth = 1.2; ctxF.beginPath(); ctxF.moveTo(p.x, p.y); ctxF.lineTo(p.x + Math.cos(p.ang) * p.size, p.y + Math.sin(p.ang) * p.size); ctxF.stroke(); }
      else ctxF.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }

    // --- тряска ---
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
    W = innerWidth; H = innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    ["web", "fx"].forEach((id) => {
      const c = document.getElementById(id);
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + "px"; c.style.height = H + "px";
    });
    ctxW = document.getElementById("web").getContext("2d");
    ctxF = document.getElementById("fx").getContext("2d");
    ctxW.setTransform(dpr, 0, 0, dpr, 0, 0); ctxF.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.Companion = {
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
      const h = home(); eye.x = h.x; eye.y = h.y; resetThreads();
      last = performance.now();
      requestAnimationFrame(frame);
    },
    slam,
    setHoverable(v) { hoverable = !!v; },
    phase(name) {
      if (name === "loading") { wantLoading = true; running = false; }
      else if (name === "running") { wantLoading = false; running = true; flash = 0.7; ring(); if (mode !== "slam" && mode !== "recoil") mode = "follow"; }
      else if (name === "error") fail();
      else { wantLoading = false; running = false; mouse.lastMove = performance.now(); }
    },
    _force(c) { forceLid = c; },
    _dbg() {
      return {
        mode, x: eye.x, y: eye.y, cap: capEl ? capEl.className : null, want: lastWant,
        alive: threads.filter((t) => t.alive).length, pinned: threads.filter((t) => t.pinned).length,
        kids: kids.filter((k) => k.state !== "wait").length, steps: stepsDone,
        states: threads.map((t) => t.state[0]).join(""),
        legs: LEGS.map((i) => { const t = threads[i]; return `${t.state[0]} t=${t.target ? 1 : 0} r=${t.reachT.toFixed(2)} p=${t.pinned ? 1 : 0} h=${t.held ? 1 : 0} eng=${engaged[LEGS.indexOf(i)] ? 1 : 0} D=${E.legD[LEGS.indexOf(i)] ? 1 : 0}`; })
      };
    }
  };
})();
