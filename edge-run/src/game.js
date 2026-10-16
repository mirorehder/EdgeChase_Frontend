/* =========================================================================
   EdgeChase Game — Endless-Runner-Engine (Vanilla Canvas, kein Build nötig)

   Du sprintest über Dächer, das EDGE (Logo) jagt dich von hinten. Fehler lassen
   es näher kommen (Threat-Meter). Läuft es voll oder stürzt du in eine Lücke,
   hat es dich. Distanz = Score.

   Technik
   - Alles wird in Welt-Einheiten (u) berechnet und gezeichnet; U = Pixel pro Einheit.
     Dadurch sieht das Spiel auf jedem Gerät gleich aus und ist gleich schwer.
   - Fester Zeitschritt (1/240 s): Physik und Score sind unabhängig von der Bildrate.
   - Score = Distanz in Metern, aus der Laufzeit-Geschwindigkeit (u/s) – NICHT aus
     der Bildschirmbreite. Gleiche Leistung = gleicher Score auf Handy und Desktop.
   - Der Score ist nur das Ticket in die serverseitige Auswertung (/api/reward).
   ========================================================================= */

import { buildScenery, drawLayer, mulberry32 } from "./art.js";

const STEP = 1 / 240;

const CFG = {
  // Tempo in Einheiten pro Sekunde (1 u = 0.085 m  ->  300 u/s = 25 m/s … 620 u/s = 53 m/s)
  speed0: 300, speedMax: 620, tau: 55,
  mPerU: 0.085,
  // Sprung
  gravity: 2300, jumpV: 615, doubleV: 540, cutV: 230, minHold: 0.09,
  coyote: 0.08, buffer: 0.12,
  // Threat (EDGE holt auf)
  threatOnHit: 0.42, threatDecay: 0.05, shardRelief: 0.025, stumble: 0.42,
  // Hindernis-Abstände in Metern (wachsen leicht mit dem Tempo)
  gapMinM: 20, gapMaxM: 34,
  beamClear: 27,          // lichte Höhe unter dem Balken (Rutschen passt, Stehen nicht)
  shardM: 1,              // Meter-Bonus pro Scherbe
};

const ROOF_H = 10;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

/* ---------------- Kleine Grafik-Bausteine (einmal vorgerendert) ---------------- */
function buildGlow(color) {
  const c = mk(64, 64), x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color); g.addColorStop(0.35, color.replace(/[\d.]+\)$/, "0.35)")); g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return c;
}
function buildVignette(danger) {
  const w = 256, h = 144, c = mk(w, h), x = c.getContext("2d");
  const g = x.createRadialGradient(w / 2, h / 2, h * 0.38, w / 2, h / 2, Math.hypot(w, h) / 2);
  if (danger) { g.addColorStop(0, "rgba(237,28,36,0)"); g.addColorStop(1, "rgba(237,28,36,0.85)"); }
  else { g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.62)"); }
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  return c;
}
function buildRoof(px) {
  const Tu = 360, c = mk(Tu * px, ROOF_H * px), x = c.getContext("2d");
  x.scale(px, px);
  const g = x.createLinearGradient(0, 0, 0, ROOF_H); g.addColorStop(0, "#2d2d35"); g.addColorStop(1, "#141418");
  x.fillStyle = g; x.fillRect(0, 0, Tu, ROOF_H);
  x.fillStyle = "rgba(255,95,85,0.40)"; x.fillRect(0, 0, Tu, 0.7);          // Kantenlicht (rote Sonne)
  x.fillStyle = "rgba(255,255,255,0.10)"; x.fillRect(0, 0.7, Tu, 0.6);
  x.fillStyle = "rgba(0,0,0,0.5)";
  for (let i = 0; i < 4; i++) x.fillRect(i * 90 + 20, 1.2, 1.1, ROOF_H);      // Dehnungsfugen
  const r = mulberry32(5);
  for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.06})`; x.fillRect(r() * Tu, 1.5 + r() * 6, 1 + r() * 1.5, 0.7); }
  x.fillStyle = "#0a0a0d"; x.fillRect(0, ROOF_H - 1.4, Tu, 1.4);
  return c;
}

/* ---------------- Pose-Mathematik ---------------- */
// Zwei-Knochen-IK: Hüfte (hx,hy) -> Fuß (fx,fy); bend=-1: Knie zeigt nach vorn (+x).
function ik(hx, hy, fx, fy, l1, l2, bend) {
  let dx = fx - hx, dy = fy - hy, d = Math.hypot(dx, dy);
  const maxd = l1 + l2 - 0.02;
  if (d > maxd) { const k = maxd / d; dx *= k; dy *= k; d = maxd; }
  if (d < 0.5) d = 0.5;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mx = hx + (dx * a) / d, my = hy + (dy * a) / d;
  return { kx: mx + (-dy / d) * h * bend, ky: my + (dx / d) * h * bend, fx: hx + dx, fy: hy + dy };
}
const mixArr = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
function mixPose(a, b, t) {
  if (t <= 0) return a; if (t >= 1) return b;
  return { hx: lerp(a.hx, b.hx, t), hh: lerp(a.hh, b.hh, t), lean: lerp(a.lean, b.lean, t),
    fA: mixArr(a.fA, b.fA, t), fB: mixArr(a.fB, b.fB, t), aA: mixArr(a.aA, b.aA, t), aB: mixArr(a.aB, b.aB, t) };
}
function runPose(ph, k) {
  const foot = (q) => {
    q -= Math.floor(q);
    if (q < 0.42) return [lerp(8, -12, q / 0.42), 2.2];                              // Bodenkontakt: Fuß wandert nach hinten
    const u = (q - 0.42) / 0.58;                                                       // Schwung: Fuß hebt ab und kommt nach vorn
    return [lerp(-12, 8, smooth(u)), 2.2 + (10 + 5 * k) * Math.sin(Math.PI * Math.pow(u, 0.85))];
  };
  const a = Math.cos(TAU * ph);
  return { hx: 0, hh: 19.2 - 1.4 * Math.cos(2 * TAU * (ph - 0.2)), lean: 0.2 + 0.22 * k,
    fA: foot(ph), fB: foot(ph + 0.5), aA: [-0.95 * a, 1.3 + 0.2 * a], aB: [0.95 * a, 1.3 - 0.2 * a] };
}
function airPose(v) {                    // v: +1 steigt … -1 fällt
  const t = (clamp(v, -1, 1) + 1) / 2;
  return { hx: 0, hh: lerp(21.5, 20, t), lean: lerp(0.1, 0.2, t),
    fA: [lerp(8.5, 6.5, t), lerp(3.5, 12, t)], fB: [lerp(-6, -8, t), lerp(1.5, 5, t)],
    aA: [lerp(1.6, 2.5, t), 0.4], aB: [lerp(-1.4, -0.6, t), 0.5] };
}
const SLIDE = { hx: -4, hh: 7.8, lean: -1.15, fA: [17, 3.2], fB: [7, 2], aA: [1.5, 0.2], aB: [-1.9, 0.3] };
const READY = { hx: 0, hh: 16, lean: 0.5, fA: [6, 2.2], fB: [-8, 2.2], aA: [1.0, 1.1], aB: [-0.9, 1.0] };

export function createGame(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const logoImg = opts.logoImg || null;
  const wordmarkImg = opts.wordmarkImg || null;
  const onScore = opts.onScore || (() => {});
  const onThreat = opts.onThreat || (() => {});
  const onGameOver = opts.onGameOver || (() => {});

  const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);   // Spiellogik
  const vis = Math.random;                                    // nur Optik (Wackeln, Funken)

  let W = 0, H = 0, DPR = 1, U = 1, Wu = 480, Hu = 290, GY = 226, playerX = 100;
  let scn = null, roof = null, vigDark = null, vigRed = null, tinted = null;
  const glowRed = buildGlow("rgba(255,60,60,1)");
  const glowWarm = buildGlow("rgba(255,200,140,1)");
  let raf = 0, loopOn = false, running = false, lastT = 0, acc = 0, resizeT = 0;
  let dprCap = 2, emaDt = 1 / 60, slowFrames = 0;
  let S;

  /* ---------------- Zustand ---------------- */
  function reset() {
    S = {
      phase: "ready",            // ready -> run -> dying -> over
      t: 0, runT: 0, base: CFG.speed0, mul: 1, v: 0,
      dist: 0, bonus: 0, scroll: 0, score: -1, lastThreat: -1,
      threat: 0.12, stumble: 0, invuln: 0, hitStop: 0, shake: 0, flash: 0, flashCol: "255,255,255",
      p: { h: 0, vy: 0, dx: 0, onGround: true, coyote: 0, airJumps: 0, jumpHold: 0, cuttable: false,
           slideT: 0, sliding: false, runPhase: 0, air: 0, slideK: 0, readyK: 1, landK: 0, hitK: 0,
           spin: -1, rot: 0, vxd: 0, vyd: 0, spinV: 0, dead: false },
      obstacles: [], shards: [], parts: [],
      nextSpawnM: 16, spawnAcc: 0, spawned: 0, lastType: "", sameRun: 0,
      jumps: 0, hits: 0, reason: null, over: false, startMs: 0, endMs: 0, deathT: 0,
      chaserAng: 0, lunge: 0, dustT: 0, emberT: 0,
      scarf: Array.from({ length: 9 }, () => ({ x: 0, y: 0 })), scarfInit: false,
      pose: null,
    };
    S.pose = computePose();
  }

  /* ---------------- Layout & Szenerie ---------------- */
  function layout() {
    DPR = Math.min(dprCap, window.devicePixelRatio || 1);
    W = Math.max(2, canvas.clientWidth); H = Math.max(2, canvas.clientHeight);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    const portrait = H > W * 1.05;
    U = Math.min(W / (portrait ? 300 : 480), H / 290);          // CSS-Pixel pro Einheit
    Wu = W / U; Hu = H / U;
    GY = Hu * (portrait ? 0.68 : 0.78);
    playerX = clamp(Wu * 0.24, 72, 130);
    const Us = Math.min(U * DPR, 2.2);                           // Szenerie bewusst nicht in voller Retina-Auflösung
    scn = buildScenery({ Wu, Hu, GY, U: Us, W: Math.ceil(Wu * Us), H: Math.ceil(Hu * Us), wordmarkImg, skyH: portrait ? GY * 0.95 : Math.min(GY, 300) });
    roof = buildRoof(Math.min(U * DPR, 3));
    vigDark = buildVignette(false); vigRed = buildVignette(true);
    tinted = null;
  }
  function onResize() { clearTimeout(resizeT); resizeT = setTimeout(() => { layout(); if (!loopOn) draw(); }, 140); }

  /* ---------------- Eingabe ---------------- */
  const input = { jumpBuf: 0, jumpHeld: false, slideHeld: false, slideReq: false };
  function pressJump() { if (running) { input.jumpBuf = CFG.buffer; input.jumpHeld = true; } }
  function releaseJump() { input.jumpHeld = false; }
  function pressSlide() { if (running) { input.slideHeld = true; input.slideReq = true; } }
  function releaseSlide() { input.slideHeld = false; }
  const isJumpKey = (c) => c === "Space" || c === "ArrowUp" || c === "KeyW";
  const isSlideKey = (c) => c === "ArrowDown" || c === "KeyS";
  function onKeyDown(e) {
    if (isJumpKey(e.code)) { e.preventDefault(); if (!e.repeat) pressJump(); }
    else if (isSlideKey(e.code)) { e.preventDefault(); if (!e.repeat) pressSlide(); }
  }
  function onKeyUp(e) { if (isJumpKey(e.code)) releaseJump(); else if (isSlideKey(e.code)) releaseSlide(); }
  function onBlur() { releaseJump(); releaseSlide(); }
  // Touch: Tippen = Springen (nach 35 ms, damit eine Wischgeste nicht erst springt), nach unten wischen = Rutschen
  let touchId = null, touchY = 0, swiped = false, jumpTimer = 0;
  function onTouchStart(e) {
    e.preventDefault();
    if (touchId !== null) return;
    const t = e.changedTouches[0]; touchId = t.identifier; touchY = t.clientY; swiped = false;
    clearTimeout(jumpTimer); jumpTimer = setTimeout(() => { jumpTimer = 0; if (!swiped) pressJump(); }, 35);
  }
  function onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId || swiped) continue;
      if (t.clientY - touchY > 16) { swiped = true; clearTimeout(jumpTimer); jumpTimer = 0; releaseJump(); pressSlide(); }
    }
  }
  function onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId) continue;
      if (jumpTimer) { clearTimeout(jumpTimer); jumpTimer = 0; if (!swiped) pressJump(); }
      releaseJump(); releaseSlide(); touchId = null;
    }
  }
  const onMouseDown = (e) => { if (e.button === 0) pressJump(); };
  const onMouseUp = () => releaseJump();
  function bindInput() {
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
  }
  function unbindInput() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    clearTimeout(jumpTimer); jumpTimer = 0; touchId = null;
  }

  /* ---------------- Hindernisse ---------------- */
  // block: drüber springen · beam: drunter rutschen (oder drüber) · gap: Lücke zwischen den Dächern
  const obstTop = (o) => (o.type === "beam" ? GY - CFG.beamClear - o.h : GY - o.h);
  function chooseType() {
    const seq = ["block", "beam", "block", "gap"];            // sanfter Einstieg: jedes Hindernis einmal kennenlernen
    if (S.spawned < seq.length) return seq[S.spawned];
    const r = rng();
    let type = r < 0.5 ? "block" : r < 0.77 ? "beam" : "gap";
    if (type === S.lastType && S.sameRun >= 2) type = type === "block" ? "beam" : "block";
    return type;
  }
  function spawnObstacle() {
    const type = chooseType();
    S.sameRun = type === S.lastType ? S.sameRun + 1 : 1; S.lastType = type; S.spawned++;
    const x = Wu + 40;
    let o;
    if (type === "block") {
      const k = rng();
      if (k < 0.4) o = { type, kind: "crate", x, w: 28, h: 25 + rng() * 4 };
      else if (k < 0.65) o = { type, kind: "stack", x, w: 28, h: 52 };
      else o = { type, kind: "vent", x, w: 46 + rng() * 6, h: 30 };
    } else if (type === "beam") {
      o = { type, kind: "beam", x, w: 56 + rng() * 26, h: 12 };
    } else {
      o = { type, kind: "gap", x, w: 92 + (S.base - CFG.speed0) * 0.12 + rng() * 26, h: 0 };
    }
    S.obstacles.push(o);
    // Scherben als Wegweiser: Bogen über Block/Lücke, tiefe Reihe unter dem Balken
    if (rng() < (type === "beam" ? 0.5 : 0.4)) {
      if (type === "beam") for (let i = 0; i < 4; i++) S.shards.push({ x: o.x + 8 + i * ((o.w - 16) / 3), y: 8 });
      else {
        const peak = type === "gap" ? 52 : Math.max(o.h + 20, 50), n = 5;
        for (let i = 0; i < n; i++) {
          const q = (i - (n - 1) / 2) / ((n - 1) / 2);
          S.shards.push({ x: o.x + o.w / 2 + q * (o.w / 2 + 26), y: 14 + (peak - 14) * (1 - q * q) });
        }
      }
    }
  }
  const overGap = (x) => { for (const o of S.obstacles) if (o.type === "gap" && x > o.x + 4 && x < o.x + o.w - 4) return true; return false; };

  /* ---------------- Partikel ---------------- */
  // k: 0 Staub · 1 Funke · 2 Splitter · 3 Glut;  w=1: bewegt sich mit der Welt nach links
  function addP(k, x, y, vx, vy, life, r, color, g = 0, w = 1) {
    if (S.parts.length > 280) S.parts.shift();
    S.parts.push({ k, x, y, vx, vy, life, max: life, r, color, g, w });
  }
  function burst(x, y, color, n, speed = 300, k = 1) {
    for (let i = 0; i < n; i++) { const a = vis() * TAU, s = speed * (0.35 + vis() * 0.65); addP(k, x, y, Math.cos(a) * s, Math.sin(a) * s - 60, 0.3 + vis() * 0.35, 1 + vis() * 1.4, color, 700, 0); }
  }
  function dustPuff(x, n, vx = 0) { for (let i = 0; i < n; i++) addP(0, x + (vis() - 0.5) * 8, GY - 1, vx + (vis() - 0.5) * 60, -10 - vis() * 40, 0.35 + vis() * 0.25, 1.4 + vis() * 1.6, "190,180,170", -20, 1); }

  /* ---------------- Pose ---------------- */
  function computePose() {
    const p = S.p;
    const k = clamp(S.v / CFG.speedMax, 0, 1);
    let pose = runPose(p.runPhase, k);
    pose = mixPose(pose, airPose(clamp(p.vy / 450, -1, 1)), smooth(p.air));
    pose = mixPose(pose, SLIDE, smooth(p.slideK));
    pose = mixPose(pose, READY, smooth(p.readyK));
    if (p.landK > 0.01 || p.hitK > 0.01) {
      pose = { ...pose, hh: pose.hh - 3.8 * p.landK, lean: pose.lean + 0.18 * p.landK - 0.5 * p.hitK,
        aA: [pose.aA[0] + p.hitK * 1.0, pose.aA[1]], aB: [pose.aB[0] - p.hitK * 0.5, pose.aB[1]] };
    }
    return pose;
  }
  const neckLocal = (pose) => ({ x: pose.hx + Math.sin(pose.lean) * 12.2, y: -pose.hh - Math.cos(pose.lean) * 12.2 });

  /* ---------------- Update ---------------- */
  function update(dt) {
    S.t += dt;
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 40);
    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 3.2);
    if (S.phase === "ready") { readyStep(dt); return; }
    if (S.hitStop > 0) { S.hitStop -= dt; return; }
    if (S.phase === "dying") { dyingStep(dt); return; }
    if (S.phase !== "run") return;
    runStep(dt);
  }

  function readyStep(dt) {
    const p = S.p;
    p.runPhase += dt * 0.3;
    S.pose = computePose();
    updateScarf(dt, 40);
    S.emberT -= dt; if (S.emberT <= 0) { S.emberT = 0.07; chaserEmbers(); }
    stepParticles(dt, 0);
  }

  function runStep(dt) {
    const p = S.p;
    // --- Tempo ---
    S.runT += dt;
    S.base = CFG.speed0 + (CFG.speedMax - CFG.speed0) * (1 - Math.exp(-S.runT / CFG.tau));
    const want = S.stumble > 0 ? 0.45 : 1;
    S.mul += (want - S.mul) * Math.min(1, dt * (want < S.mul ? 25 : 6));
    if (S.stumble > 0) S.stumble -= dt;
    if (S.invuln > 0) S.invuln -= dt;
    S.v = S.base * S.mul * Math.min(1, 0.4 + S.runT * 1.2);
    S.dist += S.v * dt; S.scroll += S.v * dt;
    S.score = Math.floor(S.dist * CFG.mPerU + S.bonus);
    S.chaserAng += dt * (1.2 + S.threat * 3);

    // --- Eingabe: Sprung (gepuffert) & Rutschen ---
    if (input.jumpBuf > 0) input.jumpBuf -= dt;
    if (input.jumpBuf > 0) {
      if (p.onGround || (p.coyote > 0 && p.airJumps === 0)) {
        p.vy = CFG.jumpV; p.onGround = false; p.coyote = 0; p.jumpHold = 0; p.cuttable = true; p.slideT = 0;
        S.jumps++; input.jumpBuf = 0; dustPuff(playerX - 4, 5, -S.v * 0.3);
      } else if (p.airJumps < 1 && (p.vy > 0 || p.h > 12)) {
        p.vy = CFG.doubleV; p.airJumps++; p.cuttable = false; p.spin = 0;
        S.jumps++; input.jumpBuf = 0;
        for (let i = 0; i < 7; i++) addP(0, playerX + (vis() - 0.5) * 10, GY - p.h - 6, (vis() - 0.5) * 140 - S.v * 0.2, 20 + vis() * 50, 0.4, 1.6 + vis(), "220,215,210", 0, 0);
      }
    }
    if (input.slideReq) { input.slideReq = false; if (p.onGround) p.slideT = 0.5; }
    if (p.slideT > 0) p.slideT -= dt;
    const wasSliding = p.sliding;
    p.sliding = p.onGround && (input.slideHeld || p.slideT > 0);
    if (p.sliding && !wasSliding) dustPuff(playerX + 6, 6, S.v * 0.1);

    // --- Physik ---
    const supported = !overGap(playerX + p.dx);
    if (p.onGround && !supported) { p.onGround = false; p.vy = 0; p.coyote = CFG.coyote; }
    if (!p.onGround) {
      if (p.coyote > 0) p.coyote -= dt;
      if (p.cuttable) { p.jumpHold += dt; if (!input.jumpHeld && p.jumpHold >= CFG.minHold && p.vy > CFG.cutV) { p.vy = CFG.cutV; p.cuttable = false; } }
      const g = CFG.gravity * (p.vy < 0 ? 1.15 : 1) * (input.slideHeld && p.h > 8 ? 1.9 : 1);
      p.vy -= g * dt; p.h += p.vy * dt;
      if (p.h <= 0 && p.vy <= 0 && supported) {
        if (p.vy < -260) { p.landK = 1; dustPuff(playerX, 6, -S.v * 0.15); }
        p.h = 0; p.onGround = true; p.airJumps = 0; p.cuttable = false; p.spin = -1; p.rot = 0;
        if (input.slideHeld) p.slideT = 0.5;
      }
      if (p.h < -70) return die("fall");
    } else { p.coyote = CFG.coyote; p.airJumps = 0; }
    p.landK = Math.max(0, p.landK - dt * 8); p.hitK = Math.max(0, p.hitK - dt * 3);
    p.air += ((p.onGround ? 0 : 1) - p.air) * Math.min(1, dt * (p.onGround ? 26 : 18));
    p.slideK += ((p.sliding ? 1 : 0) - p.slideK) * Math.min(1, dt * 22);
    p.readyK += (0 - p.readyK) * Math.min(1, dt * 8);
    if (p.spin >= 0) { p.spin += dt / 0.5; p.rot = p.spin >= 1 ? 0 : smooth(p.spin) * TAU; if (p.spin >= 1) p.spin = -1; }
    if (p.onGround) p.runPhase += dt * (2.6 + 1.0 * clamp(S.v / CFG.speedMax, 0, 1)) * (S.stumble > 0 ? 0.7 : 1);

    // --- Hindernisse & Scherben ---
    S.spawnAcc += S.v * dt * CFG.mPerU;
    if (S.spawnAcc >= S.nextSpawnM) {
      S.spawnAcc = 0;
      S.nextSpawnM = (CFG.gapMinM + rng() * (CFG.gapMaxM - CFG.gapMinM)) * (0.8 + (S.base / CFG.speedMax) * 0.6);
      spawnObstacle();
    }
    for (const o of S.obstacles) o.x -= S.v * dt;
    for (const s of S.shards) s.x -= S.v * dt;
    if (S.obstacles.length && S.obstacles[0].x + S.obstacles[0].w < -90) S.obstacles.shift();
    while (S.shards.length && (S.shards[0].x < -30 || S.shards[0].gone)) S.shards.shift();
    S.shards = S.shards.filter((s) => !s.gone && s.x > -30);

    // --- Kollision ---
    const hb = hitbox();
    for (const o of S.obstacles) {
      if (o.type === "gap" || o.done || S.invuln > 0) continue;
      if (hb.x < o.x + o.w - 2 && hb.x + hb.w > o.x + 2 && hb.y < obstTop(o) + o.h && hb.y + hb.h > obstTop(o) + 1) { o.done = true; if (registerHit() === "dead") return; }
    }
    for (const s of S.shards) {
      if (Math.hypot(playerX - s.x, (GY - p.h - 18) - (GY - s.y)) < 17) {
        s.gone = true; S.bonus += CFG.shardM; S.threat = Math.max(0, S.threat - CFG.shardRelief);
        burst(s.x, GY - s.y, "255,255,255", 7, 160);
      }
    }

    // --- Threat: erst prüfen (ein Treffer kann auf 1.0 setzen), dann erholen ---
    if (S.threat >= 1) return die("caught");
    S.threat = Math.max(0, S.threat - CFG.threatDecay * dt);

    // --- Effekte ---
    if (p.onGround && !p.sliding) { S.dustT -= dt; if (S.dustT <= 0) { S.dustT = 0.07; dustPuff(playerX - 6, 1, -S.v * 0.12); } }
    if (p.sliding) for (let i = 0; i < 2; i++) if (vis() < 0.5) addP(1, playerX - 4 + vis() * 14, GY - 1, -S.v * 0.35 - vis() * 140, -60 - vis() * 160, 0.25, 1.1, "255,170,90", 900, 1);
    S.emberT -= dt; if (S.emberT <= 0) { S.emberT = 0.05; chaserEmbers(); }
    S.pose = computePose();
    updateScarf(dt, S.v);
    stepParticles(dt, S.v);
    if (S.score !== S.lastScore) { S.lastScore = S.score; onScore(S.score); }
    const tr = Math.round(S.threat * 100);
    if (tr !== S.lastThreat) { S.lastThreat = tr; onThreat(S.threat); }
  }

  function hitbox() {
    const p = S.p, slide = p.sliding || p.slideK > 0.6;
    return slide ? { x: playerX + p.dx - 13, w: 24, y: GY - p.h - 14, h: 14 } : { x: playerX + p.dx - 6, w: 12, y: GY - p.h - 35, h: 35 };
  }

  function registerHit() {
    S.hits++; S.threat = Math.min(1, S.threat + CFG.threatOnHit);
    S.stumble = CFG.stumble; S.invuln = 0.5; S.hitStop = 0.07; S.shake = 3.2; S.flash = 0.45; S.flashCol = "237,28,36";
    S.p.hitK = 1;
    burst(playerX + 4, GY - S.p.h - 18, "237,28,36", 14, 320);
    burst(playerX + 4, GY - S.p.h - 18, "255,255,255", 6, 200);
    onThreat(S.threat); S.lastThreat = Math.round(S.threat * 100);
    if (S.threat >= 1) { die("caught"); return "dead"; }
  }

  /* ---------------- Tod ---------------- */
  function die(reason) {
    if (S.phase === "dying" || S.over) return;
    S.phase = "dying"; S.reason = reason; S.deathT = 0; S.endMs = performance.now();
    const p = S.p; p.dead = true; p.sliding = false; p.slideT = 0;
    if (S.score !== S.lastScore) { S.lastScore = S.score; onScore(S.score); }
    if (reason === "caught") {
      S.hitStop = 0.08; S.shake = 5; S.flash = 1; S.flashCol = "255,255,255";
      p.vxd = 170; p.vyd = 330; p.spinV = 9; p.air = 1;
      burst(playerX, GY - p.h - 18, "237,28,36", 26, 420); burst(playerX, GY - p.h - 18, "255,255,255", 14, 300);
    } else {
      p.vxd = 30; p.spinV = 3.2; p.vyd = 0;
    }
  }
  function dyingStep(dt) {
    const p = S.p; S.deathT += dt;
    S.v *= Math.exp(-dt * 5); S.scroll += S.v * dt;
    for (const o of S.obstacles) o.x -= S.v * dt;
    for (const s of S.shards) s.x -= S.v * dt;
    p.rot += p.spinV * dt; p.spinV *= Math.exp(-dt * 1.4);
    p.dx += p.vxd * dt; p.vxd *= Math.exp(-dt * 1.2);
    if (S.reason === "caught") {
      S.lunge = Math.min(1, S.lunge + dt * 3.2);
      p.vyd -= 1500 * dt; p.h += p.vyd * dt;
      if (p.h < 0) { p.h = 0; if (p.vyd < -90) p.vyd = -p.vyd * 0.35; else p.vyd = 0; p.spinV *= 0.5; }
    } else {
      p.vyd -= CFG.gravity * dt; p.h += p.vyd * dt;
    }
    p.air += (1 - p.air) * Math.min(1, dt * 20); p.slideK = 0; p.readyK = 0; p.hitK = 0;
    S.pose = computePose();
    updateScarf(dt, S.v);
    stepParticles(dt, S.v);
    if (S.deathT > (S.reason === "caught" ? 0.95 : 0.8)) finish();
  }
  function finish() {
    if (S.over) return;
    S.over = true; S.phase = "over"; running = false; loopOn = false; cancelAnimationFrame(raf);
    unbindInput(); window.removeEventListener("resize", onResize);
    draw();
    onGameOver({ score: S.score, durationMs: Math.max(0, Math.round(S.endMs - S.startMs)), jumps: S.jumps, hits: S.hits, reason: S.reason });
  }

  /* ---------------- Schal & Partikel ---------------- */
  function updateScarf(dt, v) {
    const p = S.p, pose = S.pose, n = neckLocal(pose);
    let nx = n.x, ny = n.y;
    if (p.rot) { const cy = -pose.hh - 4, c = Math.cos(p.rot), s = Math.sin(p.rot), dy = ny - cy; ny = cy + dy * c - nx * s; nx = nx * c + dy * s; }
    const ax = playerX + p.dx + nx - 1.2, ay = GY - p.h + ny + 0.8;
    const sc = S.scarf;
    if (!S.scarfInit) { for (let i = 0; i < sc.length; i++) { sc[i].x = ax - i * 2.3; sc[i].y = ay + i * 0.4; } S.scarfInit = true; }
    sc[0].x = ax; sc[0].y = ay;
    for (let i = 1; i < sc.length; i++) {
      const q = sc[i];
      q.x -= (v * 0.85 + 30) * dt;
      q.y += (Math.sin(S.t * 15 + i * 0.9) * (6 + v * 0.03) + 14 - (p.vy > 0 ? p.vy * 0.05 : p.vy * 0.03)) * dt;
      const a = sc[i - 1], dx = q.x - a.x, dy = q.y - a.y, d = Math.hypot(dx, dy) || 1;
      q.x = a.x + (dx / d) * 2.3; q.y = a.y + (dy / d) * 2.3;
    }
  }
  function stepParticles(dt, v) {
    for (const q of S.parts) {
      q.life -= dt; q.vy += q.g * dt; q.x += q.vx * dt - (q.w ? v * dt : 0); q.y += q.vy * dt;
    }
    if (S.parts.length) S.parts = S.parts.filter((q) => q.life > 0);
  }
  function chaserGeo() {
    const size = 62 + 46 * S.threat, r = size / 2;
    const near = playerX - r * 0.75;
    const t = smooth(Math.pow(clamp(S.threat, 0, 1), 1.15));
    let x = lerp(-r * 0.22, near, t);
    if (S.lunge > 0) x = lerp(x, playerX + S.p.dx - r * 0.35, smooth(S.lunge));
    const y = GY - r * 1.02 - 3 + Math.sin(S.t * 3.2) * (1.5 + S.threat * 3) - S.lunge * r * 0.1;
    return { x, y, r };
  }
  function chaserEmbers() {
    const c = chaserGeo();
    if (vis() < 0.7) addP(3, c.x + (vis() - 0.5) * c.r, c.y + c.r * (0.2 + vis() * 0.9), 30 + vis() * 70, -20 - vis() * 60, 0.5 + vis() * 0.4, 1 + vis() * 1.2, "255,70,60", -40, 0);
    if (S.threat > 0.4 && vis() < 0.5) addP(1, c.x + c.r * 0.5, GY - 1, 40 + vis() * 120, -50 - vis() * 90, 0.25, 1, "255,150,80", 900, 0);
  }

  /* ---------------- Zeichnen ---------------- */
  function draw() {
    if (!scn) return;
    const k = DPR * U;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.save();
    if (S.shake > 0.05) ctx.translate((vis() - 0.5) * S.shake, (vis() - 0.5) * S.shake);

    ctx.drawImage(scn.sky, -6, -6, Wu + 12, Hu + 12);
    drawLayer(ctx, scn.far, S.scroll, 0.08, Wu, S.t);
    drawLayer(ctx, scn.mid, S.scroll, 0.2, Wu, S.t);
    drawLayer(ctx, scn.near, S.scroll, 0.42, Wu, S.t);
    drawSpeedLines(0.5);
    drawGround();
    for (const o of S.obstacles) if (o.type === "gap") drawGap(o);
    drawShadow();
    for (const o of S.obstacles) { if (o.type === "beam") drawBeam(o); else if (o.type === "block") drawBlock(o); }
    for (const s of S.shards) drawShard(s);
    const behind = S.phase !== "dying" || S.reason !== "caught";
    if (behind) drawChaser();
    drawRunner();
    if (!behind) drawChaser();
    drawParticles();
    drawSpeedLines(1);
    ctx.restore();

    // Overlays in Gerätepixeln
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(vigDark, 0, 0, canvas.width, canvas.height);
    const danger = clamp((S.threat - 0.45) / 0.55, 0, 1);
    if (danger > 0 && S.phase !== "over") {
      ctx.globalAlpha = danger * (0.45 + 0.35 * Math.sin(S.t * (6 + danger * 8)));
      ctx.drawImage(vigRed, 0, 0, canvas.width, canvas.height);
    }
    if (S.flash > 0) { ctx.globalAlpha = S.flash * 0.45; ctx.fillStyle = `rgb(${S.flashCol})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.globalAlpha = 1;
  }

  function drawSpeedLines(layer) {
    const f = clamp((S.v - CFG.speed0) / (CFG.speedMax - CFG.speed0), 0, 1);
    if (f < 0.1) return;
    ctx.save(); ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const near = i % 3 === 0;
      if ((layer === 1) !== near) continue;
      const len = (near ? 70 : 38) + f * 60, sp = near ? 1.9 : 1.35;
      const x = Wu + len - ((S.scroll * sp + i * 173) % (Wu + len * 2));
      const y = 12 + ((i * 97) % Math.max(60, GY - 30));
      ctx.strokeStyle = `rgba(255,255,255,${(near ? 0.10 : 0.05) * f})`; ctx.lineWidth = near ? 1.1 : 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawGround() {
    const off = S.scroll % 360, fh = scn.facade.h;
    for (let x = -off; x < Wu + 8; x += 360) {
      ctx.drawImage(roof, x, GY, 360.6, ROOF_H);
      ctx.drawImage(scn.facade.canvas, x, GY + ROOF_H - 0.4, 360.6, fh);
    }
  }
  function drawGap(o) {
    const x = o.x, w = o.w, bot = Hu + 10;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, GY - 1, w, bot - GY + 1); ctx.clip();
    const g = ctx.createLinearGradient(0, GY, 0, bot);
    g.addColorStop(0, "#0b0507"); g.addColorStop(0.55, "#12070a"); g.addColorStop(1, "#34090e");
    ctx.fillStyle = g; ctx.fillRect(x, GY - 1, w, bot - GY + 1);
    ctx.globalCompositeOperation = "lighter";                                   // rotes Glühen aus der Tiefe
    ctx.globalAlpha = 0.5; ctx.drawImage(glowRed, x - w * 0.3, Hu - 34, w * 1.6, 90);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    const sh = ctx.createLinearGradient(x, 0, x + w, 0);                        // Schatten an den Wänden
    sh.addColorStop(0, "rgba(0,0,0,0.65)"); sh.addColorStop(0.18, "rgba(0,0,0,0)"); sh.addColorStop(0.82, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = sh; ctx.fillRect(x, GY, w, bot - GY);
    ctx.restore();
    ctx.fillStyle = "#3b3b45"; ctx.fillRect(x - 3, GY, 3, ROOF_H + 4); ctx.fillRect(x + w, GY, 3, ROOF_H + 4);   // Randsteine
    ctx.fillStyle = "rgba(255,95,85,0.75)"; ctx.fillRect(x - 3, GY, 3, 0.9); ctx.fillRect(x + w, GY, 3, 0.9);
  }
  function drawShadow() {
    const p = S.p;
    if (p.dead && S.reason === "fall") return;
    const px = playerX + p.dx;
    if (overGap(px) || p.h < -2) return;
    const k = clamp(1 - p.h / 110, 0.3, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.38 * k})`;
    ctx.beginPath(); ctx.ellipse(px, GY + 0.6, (p.sliding ? 17 : 11) * k, 1.9 * k, 0, 0, TAU); ctx.fill();
  }

  /* --- Hindernisse --- */
  function metal(x, y, w, h, c1, c2) {
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  function crate(x, y, w, h) {
    metal(x, y, w, h, "#383842", "#1d1d23");
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 0.9; ctx.strokeRect(x + 1.4, y + 1.4, w - 2.8, h - 2.8);
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.moveTo(x + 1.4, y + 1.4); ctx.lineTo(x + w - 1.4, y + h - 1.4); ctx.moveTo(x + w - 1.4, y + 1.4); ctx.lineTo(x + 1.4, y + h - 1.4); ctx.stroke();
    ctx.fillStyle = "#ed1c24"; ctx.fillRect(x + 3.2, y + 3.2, w * 0.34, 2);                               // Etikett
    ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(x, y, w, 0.9);                                  // Oberkante
    ctx.fillStyle = "rgba(255,80,70,0.42)"; ctx.fillRect(x + w - 1.2, y, 1.2, h);                          // Sonnenlicht von vorn
  }
  function drawBlock(o) {
    const y = obstTop(o), x = o.x;
    if (o.kind === "crate") crate(x, y, o.w, o.h);
    else if (o.kind === "stack") { crate(x, y + 26, o.w, 26); crate(x + 1, y, o.w - 2, 26); }
    else {                                                                                                  // Klimagerät
      metal(x, y + 4, o.w, o.h - 4, "#30303a", "#18181d");
      metal(x - 1.5, y, o.w + 3, 4.5, "#454550", "#2a2a32");
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 0.8;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 3, y + 10 + i * 4.6); ctx.lineTo(x + o.w * 0.55, y + 10 + i * 4.6); ctx.stroke(); }
      const fx = x + o.w * 0.76, fy = y + 18;
      ctx.fillStyle = "#0c0c0f"; ctx.beginPath(); ctx.arc(fx, fy, 8.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#4a4a56"; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(S.t * 9); ctx.fillStyle = "#2a2a31";
      for (let i = 0; i < 4; i++) { ctx.rotate(TAU / 4); ctx.fillRect(0.8, -1.6, 6.8, 3.2); } ctx.restore();
      ctx.fillStyle = Math.sin(S.t * 5 + x) > 0 ? "#ff4b4b" : "#5a1418"; ctx.fillRect(x + 3, y + o.h - 5, 2.2, 2.2);
      ctx.fillStyle = "rgba(255,80,70,0.42)"; ctx.fillRect(x + o.w - 1.2, y + 4, 1.2, o.h - 4);
    }
  }
  function drawBeam(o) {
    const y = obstTop(o), x = o.x, x1 = x + 7, x2 = x + o.w - 7;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(x, GY - 0.2, o.w, 1.6);                              // Schatten am Boden
    ctx.strokeStyle = "#6a6a76"; ctx.lineWidth = 1.5; ctx.setLineDash([2.6, 1.6]);                         // Ketten
    ctx.beginPath(); ctx.moveTo(x1, -10); ctx.lineTo(x1, y + 1); ctx.moveTo(x2, -10); ctx.lineTo(x2, y + 1); ctx.stroke(); ctx.setLineDash([]);
    metal(x, y, o.w, o.h, "#34343d", "#16161b");
    ctx.beginPath(); ctx.rect(x, y + o.h - 4.6, o.w, 4.6); ctx.clip();                                     // Warnstreifen
    ctx.fillStyle = "#101013"; ctx.fillRect(x, y + o.h - 4.6, o.w, 4.6);
    ctx.fillStyle = "#ed1c24";
    for (let sx = x - 6 - ((S.scroll * 0) % 8); sx < x + o.w; sx += 8) { ctx.beginPath(); ctx.moveTo(sx, y + o.h); ctx.lineTo(sx + 4, y + o.h); ctx.lineTo(sx + 8.6, y + o.h - 4.6); ctx.lineTo(sx + 4.6, y + o.h - 4.6); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.fillRect(x, y, o.w, 0.9);
    ctx.fillStyle = "rgba(255,80,70,0.45)"; ctx.fillRect(x + o.w - 1.2, y, 1.2, o.h);
    const on = Math.sin(S.t * 7 + x) > -0.2;                                                               // Warnlicht
    ctx.fillStyle = on ? "#ff5050" : "#4a1216"; ctx.beginPath(); ctx.arc(x + o.w / 2, y + 3.4, 1.7, 0, TAU); ctx.fill();
    if (on) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.7; ctx.drawImage(glowRed, x + o.w / 2 - 9, y - 5.6, 18, 18); ctx.restore(); }
  }
  function drawShard(s) {
    const cx = s.x, cy = GY - s.y + Math.sin(S.t * 4 + s.x * 0.05) * 1.6;
    if (cx < -12 || cx > Wu + 12) return;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.85; ctx.drawImage(glowRed, cx - 11, cy - 11, 22, 22); ctx.restore();
    const sx = Math.max(0.28, Math.abs(Math.cos(S.t * 3 + s.x * 0.02)));
    const g = ctx.createLinearGradient(cx, cy - 6, cx, cy + 6); g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#ffb0b0");
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 3.7 * sx, cy); ctx.lineTo(cx, cy + 6); ctx.lineTo(cx - 3.7 * sx, cy); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(237,28,36,0.9)"; ctx.lineWidth = 0.6; ctx.stroke();
  }

  /* --- Verfolger: das EDGE --- */
  function logoTint() {
    if (tinted || !logoImg || !logoImg.naturalWidth) return tinted;
    const c = mk(256, 256), x = c.getContext("2d");
    x.drawImage(logoImg, 0, 0, 256, 256); x.globalCompositeOperation = "source-in"; x.fillStyle = "#ffffff"; x.fillRect(0, 0, 256, 256);
    return (tinted = c);
  }
  function drawChaser() {
    const c = chaserGeo(), danger = clamp(S.threat, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55 + danger * 0.4; ctx.drawImage(glowRed, c.x - c.r * 2.1, c.y - c.r * 2.1, c.r * 4.2, c.r * 4.2);
    ctx.restore();
    const img = logoTint();
    ctx.save(); ctx.translate(c.x, c.y);
    // Nachbilder (Bewegungsunschärfe nach links)
    if (img) for (let i = 3; i >= 1; i--) { ctx.save(); ctx.globalAlpha = 0.16 * (1 - i / 4); ctx.translate(-i * c.r * 0.38, 0); ctx.rotate(S.chaserAng * 0.6 - i * 0.12); ctx.drawImage(img, -c.r, -c.r, c.r * 2, c.r * 2); ctx.restore(); }
    // Energie-Ring
    ctx.strokeStyle = `rgba(237,28,36,${0.55 + 0.35 * Math.sin(S.t * 6)})`; ctx.lineWidth = 1.2 + danger * 1.2;
    ctx.beginPath(); ctx.arc(0, 0, c.r * 1.12, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(237,28,36,0.25)"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, 0, c.r * 1.28 + Math.sin(S.t * 4) * 1.5, 0, TAU); ctx.stroke();
    ctx.rotate(S.chaserAng * 0.6);
    if (img) ctx.drawImage(img, -c.r, -c.r, c.r * 2, c.r * 2);
    else { ctx.fillStyle = "#ed1c24"; ctx.fillRect(-c.r * 0.6, -c.r * 0.6, c.r * 1.2, c.r * 1.2); }
    ctx.restore();
  }

  /* --- Läufer --- */
  const COL = { hood: "#eceae4", hoodSh: "#b8b6ae", pants: "#17171c", pantsFar: "#0d0d10", skin: "#d9b49a", skinSh: "#b58f78", red: "#ed1c24", hat: "#111115", hoodFar: "#8f8d87" };
  function limb(ax, ay, bx, by, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  function drawLeg(pose, f, far) {
    const hx = pose.hx, hy = -pose.hh;
    const r = ik(hx, hy, f[0], -f[1], 11.4, 11.4, -1);
    const col = far ? COL.pantsFar : COL.pants;
    limb(hx, hy, r.kx, r.ky, 5.6, col); limb(r.kx, r.ky, r.fx, r.fy, 4.4, col);
    if (!far) { ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(hx + 1.2, hy); ctx.lineTo(r.kx + 1, r.ky); ctx.stroke(); }
    // Schuh: flach am Boden, in der Luft zeigt die Spitze entlang des Schienbeins
    let dx = r.fx - r.kx, dy = r.fy - r.ky; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const wGround = clamp(1 - (f[1] - 2.2) / 3, 0, 1);
    let tx = lerp(dy, 1, wGround), ty = lerp(-dx, 0, wGround); const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    ctx.lineCap = "round";
    limb(r.fx - tx * 1.2, r.fy - ty * 1.2 + 0.2, r.fx + tx * 5.2, r.fy + ty * 5.2 + 0.2, 3.8, far ? "#7d1015" : COL.red);
    limb(r.fx - tx * 1, r.fy - ty * 1 + 1.4, r.fx + tx * 5.4, r.fy + ty * 5.4 + 1.4, 1.2, far ? "#8a8a88" : "#f4f3ef");
  }
  function drawArm(pose, sh, a, far) {
    const ex = sh.x + Math.sin(a[0]) * 6.6, ey = sh.y + Math.cos(a[0]) * 6.6;
    const hxp = ex + Math.sin(a[0] + a[1]) * 6.4, hyp = ey + Math.cos(a[0] + a[1]) * 6.4;
    const col = far ? COL.hoodFar : COL.hood;
    limb(sh.x, sh.y, ex, ey, 3.7, col); limb(ex, ey, hxp, hyp, 3.2, col);
    ctx.fillStyle = far ? COL.skinSh : COL.skin; ctx.beginPath(); ctx.arc(hxp, hyp, 1.7, 0, TAU); ctx.fill();
  }
  function drawRunner() {
    const p = S.p, pose = S.pose;
    drawScarf();
    ctx.save(); ctx.translate(playerX + p.dx, GY - p.h);
    if (p.rot) { const cy = -pose.hh - 4; ctx.translate(0, cy); ctx.rotate(p.rot); ctx.translate(0, -cy); }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const hx = pose.hx, hy = -pose.hh, ls = Math.sin(pose.lean), lc = Math.cos(pose.lean);
    const shoulder = { x: hx + ls * 10.8, y: hy - lc * 10.8 };
    drawArm(pose, shoulder, pose.aB, true);
    drawLeg(pose, pose.fB, true);

    // Oberkörper (im gedrehten Rahmen)
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(pose.lean);
    limb(0, 0, 0, -2.4, 8.6, COL.pants);                                    // Hosenbund
    ctx.fillStyle = "#26262d"; ctx.beginPath(); ctx.roundRect(-8.8, -11.6, 5, 10, 1.8); ctx.fill();   // Rucksack
    ctx.fillStyle = COL.red; ctx.fillRect(-8.8, -9.6, 5, 1.1);
    limb(-0.8, -1.2, -0.8, -11.4, 8.8, COL.hoodSh);                           // Rückenschatten
    limb(0.4, -1.0, 0.4, -11.4, 8.6, COL.hood);                               // Hoodie
    ctx.fillStyle = COL.hoodSh; ctx.beginPath(); ctx.arc(-2.8, -12, 2.9, 0, TAU); ctx.fill();            // Kapuze im Nacken
    ctx.fillStyle = COL.red; ctx.save(); ctx.translate(2.2, -6.2); ctx.rotate(Math.PI / 4); ctx.fillRect(-1.1, -1.1, 2.2, 2.2); ctx.restore();   // Logo-Raute
    ctx.restore();

    // Kopf
    const ha = pose.lean * 0.45, hxN = hx + ls * 12.9 + Math.sin(ha) * 4.3, hyN = hy - lc * 12.9 - Math.cos(ha) * 4.3;
    ctx.save(); ctx.translate(hxN, hyN); ctx.rotate(ha);
    ctx.fillStyle = COL.skin; ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, TAU); ctx.fill();
    ctx.fillStyle = COL.skinSh; ctx.beginPath(); ctx.arc(-1.2, 1.6, 1.1, 0, TAU); ctx.fill();               // Ohr
    ctx.fillStyle = COL.hat; ctx.beginPath(); ctx.arc(0, -0.6, 5.1, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();   // Mütze
    ctx.fillStyle = COL.red; ctx.beginPath(); ctx.roundRect(-5, -1.6, 10, 1.8, 0.9); ctx.fill();
    ctx.fillStyle = "#17171c"; ctx.beginPath(); ctx.arc(2.5, 1.0, 0.65, 0, TAU); ctx.fill();               // Auge
    ctx.restore();

    drawLeg(pose, pose.fA, false);
    drawArm(pose, shoulder, pose.aA, false);
    ctx.restore();
  }
  // Der Schal liegt in Weltkoordinaten (folgt dem Läufer mit Verzögerung)
  function drawScarf() {
    const sc = S.scarf;
    ctx.save(); ctx.lineCap = "round";
    for (let i = 1; i < sc.length; i++) {
      ctx.strokeStyle = i % 2 ? "#c9151c" : COL.red; ctx.lineWidth = Math.max(1.1, 3.3 - i * 0.26);
      ctx.beginPath(); ctx.moveTo(sc[i - 1].x, sc[i - 1].y); ctx.lineTo(sc[i].x, sc[i].y); ctx.stroke();
    }
    ctx.restore();
  }
  function drawParticles() {
    for (const q of S.parts) {
      const a = clamp(q.life / q.max, 0, 1);
      if (q.k === 0) { ctx.fillStyle = `rgba(${q.color},${0.2 * a})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (1 + (1 - a) * 1.8), 0, TAU); ctx.fill(); }
      else if (q.k === 1) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(${q.color},${a})`; ctx.lineWidth = q.r * 0.7; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke(); ctx.restore(); }
      else if (q.k === 3) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a * 0.9; ctx.drawImage(glowRed, q.x - q.r * 2.5, q.y - q.r * 2.5, q.r * 5, q.r * 5); ctx.restore(); }
      else { ctx.fillStyle = `rgba(${q.color},${a})`; ctx.fillRect(q.x - q.r, q.y - q.r, q.r * 2, q.r * 2); }
    }
  }

  /* ---------------- Schleife ---------------- */
  function frame(now) {
    if (!loopOn) return;
    if (!lastT) lastT = now;
    const raw = (now - lastT) / 1000, dt = Math.min(0.05, raw); lastT = now;
    // Langsames Gerät? Dann einmalig die Renderauflösung senken (hält das Spiel flüssig)
    if (raw < 0.5) emaDt += (raw - emaDt) * 0.05;
    if (emaDt > 0.03 && dprCap > 1 && DPR > 1) { if (++slowFrames > 90) { dprCap = 1; slowFrames = 0; layout(); } } else slowFrames = 0;
    acc += dt;
    while (acc >= STEP && loopOn) { update(STEP); acc -= STEP; }
    if (!loopOn) return;
    draw();
    raf = requestAnimationFrame(frame);
  }
  function startLoop() { if (loopOn) return; loopOn = true; lastT = 0; acc = 0; raf = requestAnimationFrame(frame); }

  /* ---------------- Öffentliche API ---------------- */
  function prepare() {           // Bild schon während des Countdowns zeigen
    cancelAnimationFrame(raf); loopOn = false; running = false;
    layout(); reset(); window.addEventListener("resize", onResize);
    draw(); startLoop();
  }
  function start() {
    if (!S || S.phase === "over" || !scn) { layout(); reset(); window.addEventListener("resize", onResize); }
    S.phase = "run"; S.startMs = performance.now(); running = true;
    input.jumpBuf = 0; input.jumpHeld = false; input.slideHeld = false; input.slideReq = false;
    onScore(0); onThreat(S.threat); S.lastScore = 0; S.lastThreat = Math.round(S.threat * 100);
    bindInput(); startLoop();
  }
  function stop() { running = false; loopOn = false; cancelAnimationFrame(raf); unbindInput(); window.removeEventListener("resize", onResize); }

  return {
    prepare, start, stop,
    get score() { return S ? S.score : 0; },
    _test: { state: () => S, update, draw, layout, reset, press: { jump: pressJump, release: releaseJump, slide: pressSlide, unslide: releaseSlide }, geo: () => ({ Wu, Hu, GY, U, playerX }), hitbox, obstTop, setRunning: (v) => { running = v; } },
  };
}
