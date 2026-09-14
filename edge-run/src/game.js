/* =========================================================================
   EDGE RUN — Endless Runner Engine (Vanilla Canvas, kein Build nötig)

   Spielgefühl: Du sprintest über Dächer, das EDGE (Logo) jagt dich von hinten.
   Fehler lassen es näher kommen (Threat-Meter). Läuft es voll oder stürzt du
   in eine Lücke, hat es dich. Distanz = Score. Tempo steigt = "Madness".

   Der Score ist bewusst NUR das Ticket in die serverseitige Gewinn-Lotterie
   (siehe /api/reward). Cheaten am Score bringt fast nichts, weil der Server
   entscheidet und plausibilisiert.
   ========================================================================= */

const CFG = {
  // Tempo (px pro Sekunde), skaliert zusätzlich mit der Bildschirmbreite.
  baseSpeed: 430,
  maxSpeed: 1050,
  accel: 10.5,          // Zuwachs pro Sekunde
  // Sprung / Schwerkraft
  gravity: 3050,
  jumpV: 1180,
  jumpCutoff: 520,      // frühes Loslassen -> kürzerer Sprung
  maxAirJumps: 1,       // Doppelsprung
  // Threat (EDGE holt auf)
  threatOnHit: 0.42,    // ~2-3 Treffer = erwischt
  threatDecay: 0.05,    // pro Sekunde (Erholung zwischen Fehlern)
  threatShardRelief: 0.12,
  stumbleTime: 0.42,    // Sekunden Tempoverlust nach Treffer
  // Score
  metersPerPx: 0.06,
  // Hindernis-Abstände in Metern (skaliert mit Tempo -> fair)
  gapMinM: 20, gapMaxM: 34,
};

const PALETTE = {
  bg0: "#0a0a0b", bg1: "#131317", city0: "#171720", city1: "#20202b",
  ground: "#1c1c22", groundEdge: "#2b2b34", ink: "#f4f4f5",
  accent: "#ff2b2b", gold: "#ffcf4a", shard: "#ffffff",
};

export function createGame(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const logoImg = opts.logoImg || null;      // vorab geladenes HTMLImageElement
  const onScore = opts.onScore || (() => {});
  const onThreat = opts.onThreat || (() => {});
  const onGameOver = opts.onGameOver || (() => {});

  let W = 0, H = 0, DPR = 1;
  let raf = 0, running = false, lastT = 0;
  let shake = 0;

  const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

  // Spielzustand
  let S;
  function reset() {
    S = {
      t: 0, startMs: 0, speed: CFG.baseSpeed, distPx: 0, score: 0,
      threat: 0.12, stumble: 0,
      player: { y: 0, vy: 0, airJumps: 0, onGround: true, sliding: false, slideT: 0, runPhase: 0 },
      obstacles: [], shards: [], particles: [],
      nextSpawnM: 14, spawnAcc: 0,
      hits: 0, jumps: 0, over: false, reason: null,
      bg: { far: 0, near: 0 },
      logoSpin: 0,
    };
  }
  reset();

  /* ---------------- Layout & Skalierung ---------------- */
  function layout() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  const groundY = () => H * 0.80;
  const playerX = () => Math.min(W * 0.26, 230);
  const speedScale = () => Math.max(0.72, Math.min(1.35, W / 900)); // gleiche Fairness auf allen Größen
  const px = (m) => m / CFG.metersPerPx;

  /* ---------------- Eingabe ---------------- */
  const input = { jumpQueued: false, jumpHeld: false, slideHeld: false };
  function pressJump() { if (running) { input.jumpQueued = true; input.jumpHeld = true; } }
  function releaseJump() { input.jumpHeld = false; }
  function pressSlide() { if (running) input.slideHeld = true; }
  function releaseSlide() { input.slideHeld = false; }

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); pressJump(); }
    else if (e.code === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); pressSlide(); }
  }
  function onKeyUp(e) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") releaseJump();
    else if (e.code === "ArrowDown" || e.code === "KeyS") releaseSlide();
  }
  // Touch: Tippen = Sprung, nach unten wischen = Rutschen
  let touchStartY = 0, touchId = null, swiped = false;
  function onTouchStart(e) {
    const t = e.changedTouches[0]; touchId = t.identifier; touchStartY = t.clientY; swiped = false;
    pressJump();
    e.preventDefault();
  }
  function onTouchMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId) continue;
      if (!swiped && t.clientY - touchStartY > 34) { swiped = true; releaseJump(); pressSlide(); }
    }
    e.preventDefault();
  }
  function onTouchEnd(e) { releaseJump(); releaseSlide(); touchId = null; e.preventDefault(); }
  function onMouseDown() { pressJump(); }
  function onMouseUp() { releaseJump(); }

  function bindInput() {
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", layout);
  }
  function unbindInput() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("resize", layout);
  }

  /* ---------------- Hindernisse ---------------- */
  // type: "block" (drüber springen), "beam" (drunter rutschen), "gap" (Lücke)
  function spawnObstacle() {
    const r = rng();
    let type = r < 0.5 ? "block" : r < 0.8 ? "beam" : "gap";
    // Kein Gap direkt nach schnellem Tempo-Peak, wenn threat hoch (Fairness)
    const gY = groundY();
    let o;
    if (type === "block") {
      const h = 42 + rng() * 46;
      o = { type, x: W + 40, w: 30 + rng() * 26, h, top: gY - h };
    } else if (type === "beam") {
      const gapUnder = 66;                 // Durchrutsch-Höhe
      o = { type, x: W + 40, w: 34 + rng() * 30, h: 26, top: gY - gapUnder - 26 };
    } else {
      o = { type, x: W + 40, w: px(6) + rng() * px(5), h: 0, top: gY };
    }
    S.obstacles.push(o);
    // Gelegentlich eine Scherbe (Bonus) in Sprunghöhe kurz danach
    if (rng() < 0.5) {
      const bonusX = o.x + o.w + 120 + rng() * 160;
      S.shards.push({ x: bonusX, y: gY - (70 + rng() * 120), r: 9, got: false });
    }
  }

  /* ---------------- Update ---------------- */
  function step(dt) {
    const p = S.player, gY = groundY(), sc = speedScale();

    // Tempo hochfahren (mit Stolper-Malus)
    const target = Math.min(CFG.maxSpeed, CFG.baseSpeed + S.t * CFG.accel * 6);
    S.speed += (target - S.speed) * Math.min(1, dt * 2);
    let effSpeed = S.speed * sc;
    if (S.stumble > 0) { effSpeed *= 0.45; S.stumble -= dt; }

    S.t += dt;
    S.distPx += effSpeed * dt;
    S.score = Math.floor(S.distPx * CFG.metersPerPx);
    onScore(S.score);

    // Parallax
    S.bg.far += effSpeed * dt * 0.18;
    S.bg.near += effSpeed * dt * 0.42;
    S.logoSpin += dt * (1.2 + S.threat * 3);

    // --- Spieler-Physik ---
    // Slide
    p.sliding = input.slideHeld && p.onGround;
    // Sprung
    if (input.jumpQueued) {
      if (p.onGround) { p.vy = -CFG.jumpV; p.onGround = false; p.airJumps = 0; S.jumps++; p.sliding = false; }
      else if (p.airJumps < CFG.maxAirJumps) { p.vy = -CFG.jumpV * 0.86; p.airJumps++; S.jumps++; puff(playerX(), gY + p.y, 6); }
      input.jumpQueued = false;
    }
    if (!input.jumpHeld && p.vy < -CFG.jumpCutoff) p.vy = -CFG.jumpCutoff; // variable Höhe
    p.vy += CFG.gravity * dt;
    p.y += p.vy * dt;
    if (p.y >= 0) {                    // p.y ist Offset über Boden (negativ = Luft)
      // steht auf Boden? nur wenn nicht über einer Lücke
      if (!overGap(playerX())) {
        if (!p.onGround) puff(playerX(), gY, 5);
        p.y = 0; p.vy = 0; p.onGround = true; p.airJumps = 0;
      } else {
        p.onGround = false;
        if (p.y > 120) { return gameOver("fall"); }  // in die Tiefe gestürzt
      }
    } else {
      p.onGround = false;
    }
    p.runPhase += effSpeed * dt * 0.020;

    // --- Hindernisse bewegen / spawnen ---
    S.spawnAcc += effSpeed * dt * CFG.metersPerPx;
    if (S.spawnAcc >= S.nextSpawnM) {
      S.spawnAcc = 0;
      const gapM = CFG.gapMinM + rng() * (CFG.gapMaxM - CFG.gapMinM);
      // bei hohem Tempo etwas mehr Luft lassen
      S.nextSpawnM = gapM * (0.8 + effSpeed / CFG.maxSpeed * 0.6);
      spawnObstacle();
    }
    for (const o of S.obstacles) o.x -= effSpeed * dt;
    S.obstacles = S.obstacles.filter((o) => o.x + o.w > -60);

    for (const s of S.shards) s.x -= effSpeed * dt;
    S.shards = S.shards.filter((s) => s.x > -40 && !s.gone);

    // --- Kollisionen ---
    const hb = playerHitbox(gY);
    for (const o of S.obstacles) {
      if (o.type === "gap") continue;
      if (o.hitDone) continue;
      if (rectsOverlap(hb, { x: o.x, y: o.top, w: o.w, h: o.h })) {
        o.hitDone = true;
        registerHit();
      }
    }
    // Scherben einsammeln
    for (const s of S.shards) {
      if (s.got) continue;
      if (Math.hypot((hb.x + hb.w / 2) - s.x, (hb.y + hb.h / 2) - s.y) < s.r + 26) {
        s.got = true; s.gone = true;
        S.threat = Math.max(0, S.threat - CFG.threatShardRelief);
        S.distPx += px(3);          // kleiner Score-Bonus
        burst(s.x, s.y, PALETTE.shard, 10);
      }
    }

    // --- Threat / EDGE ---
    // ERST prüfen: ein Treffer in diesem Frame kann das Meter auf 1.0 setzen.
    // Würde man vorher den Decay abziehen, läge der Wert stets knapp unter 1
    // und der Tod löste nie aus (der ursprüngliche Bug).
    if (S.threat >= 1) return gameOver("caught");
    S.threat = Math.max(0, S.threat - CFG.threatDecay * dt);
    onThreat(S.threat);

    // Partikel
    for (const pt of S.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 900 * dt; pt.life -= dt; }
    S.particles = S.particles.filter((pt) => pt.life > 0);

    if (shake > 0) shake = Math.max(0, shake - dt * 60);
  }

  function registerHit() {
    S.hits++;
    S.threat = Math.min(1, S.threat + CFG.threatOnHit);
    S.stumble = CFG.stumbleTime;
    shake = 14;
    burst(playerX(), groundY() - 40, PALETTE.accent, 16);
    onThreat(S.threat);
  }

  function overGap(x) {
    for (const o of S.obstacles) if (o.type === "gap" && x > o.x + 6 && x < o.x + o.w - 6) return true;
    return false;
  }
  function playerHitbox(gY) {
    const w = 34, fullH = 74, slideH = 38;
    const h = S.player.sliding ? slideH : fullH;
    return { x: playerX() - w / 2, y: gY + S.player.y - h, w, h };
  }

  /* ---------------- Partikel-Helfer ---------------- */
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, sp = 80 + rng() * 320;
      S.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: 0.4 + rng() * 0.4, color, r: 2 + rng() * 3 });
    }
  }
  function puff(x, y, n) { for (let i = 0; i < n; i++) S.particles.push({ x: x + (rng() - 0.5) * 30, y, vx: (rng() - 0.5) * 120, vy: -rng() * 120, life: 0.3, color: "#3a3a44", r: 2 + rng() * 2 }); }

  /* ---------------- Rendering ---------------- */
  function draw() {
    const gY = groundY();
    ctx.save();
    if (shake > 0) ctx.translate((rng() - 0.5) * shake, (rng() - 0.5) * shake);

    // Himmel
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, PALETTE.bg1); sky.addColorStop(1, PALETTE.bg0);
    ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, H + 40);

    drawSkyline(S.bg.far * 1, gY, 0.55, PALETTE.city0, 150, 46);
    drawSkyline(S.bg.near, gY, 0.9, PALETTE.city1, 92, 26);

    // Speed-Lines bei hohem Tempo
    const spd = (S.speed - CFG.baseSpeed) / (CFG.maxSpeed - CFG.baseSpeed);
    if (spd > 0.15) {
      ctx.strokeStyle = `rgba(255,255,255,${0.05 + spd * 0.06})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const y = 60 + ((S.bg.near * 2 + i * 130) % (H - 120));
        ctx.beginPath(); ctx.moveTo(W, y); ctx.lineTo(W - 60 - spd * 120, y); ctx.stroke();
      }
    }

    drawGround(gY);
    for (const o of S.obstacles) drawObstacle(o, gY);
    for (const s of S.shards) if (!s.got) drawShard(s);
    drawChaser(gY);
    drawPlayer(gY);
    drawParticles();

    ctx.restore();
  }

  function drawSkyline(scroll, gY, k, color, maxH, step) {
    ctx.fillStyle = color;
    const off = -(scroll % (step * 6));
    for (let x = off - step; x < W + step; x += step) {
      const seed = Math.floor((x - off) / step) * 928371;
      const h = (Math.abs(Math.sin(seed)) * maxH) + 30;
      const w = step - 6;
      ctx.fillRect(x, gY - h * k - (1 - k) * 40, w, h);
    }
  }

  function drawGround(gY) {
    // Boden mit Lücken
    ctx.fillStyle = PALETTE.ground;
    let cursor = -40;
    const segs = [];
    const gaps = S.obstacles.filter((o) => o.type === "gap").sort((a, b) => a.x - b.x);
    for (const g of gaps) { segs.push([cursor, g.x]); cursor = g.x + g.w; }
    segs.push([cursor, W + 40]);
    for (const [a, b] of segs) {
      if (b <= a) continue;
      ctx.fillRect(a, gY, b - a, H - gY + 40);
      ctx.fillStyle = PALETTE.groundEdge; ctx.fillRect(a, gY, b - a, 3);
      ctx.fillStyle = PALETTE.ground;
    }
    // Dach-Textur (bewegte Linien)
    ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 2;
    const off = -(S.bg.near % 60);
    for (const [a, b] of segs) {
      for (let x = a + (off % 60); x < b; x += 60) {
        if (x < a + 8) continue;
        ctx.beginPath(); ctx.moveTo(x, gY + 12); ctx.lineTo(x - 14, H); ctx.stroke();
      }
    }
  }

  function drawObstacle(o, gY) {
    if (o.type === "gap") {
      // dunkler Schlund + Kanten
      ctx.fillStyle = "#050506"; ctx.fillRect(o.x, gY, o.w, H - gY + 40);
      ctx.fillStyle = PALETTE.accent;
      ctx.fillRect(o.x - 3, gY, 3, 46); ctx.fillRect(o.x + o.w, gY, 3, 46);
      return;
    }
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(o.x, o.top, o.w, o.h);
    // Akzentkante
    ctx.fillStyle = PALETTE.accent;
    if (o.type === "beam") ctx.fillRect(o.x, o.top + o.h - 4, o.w, 4);
    else ctx.fillRect(o.x, o.top, o.w, 4);
    ctx.restore();
  }

  function drawShard(s) {
    ctx.save();
    ctx.translate(s.x, s.y + Math.sin(S.t * 4 + s.x) * 4);
    ctx.rotate(Math.PI / 4 + S.t);
    ctx.fillStyle = PALETTE.shard;
    ctx.shadowColor = "rgba(255,255,255,.6)"; ctx.shadowBlur = 12;
    ctx.fillRect(-s.r, -s.r, s.r * 2, s.r * 2);
    ctx.restore();
  }

  function drawChaser(gY) {
    // EDGE = Logo, kommt mit steigendem Threat näher
    const nearX = playerX() - 70;
    const farX = -140;
    const x = farX + (nearX - farX) * easeIn(S.threat);
    const size = 84 + S.threat * 70;
    const y = gY - size * 0.52 + Math.sin(S.t * 6) * (2 + S.threat * 6);

    // roter Glow / Bedrohung
    const glow = ctx.createRadialGradient(x, y, 4, x, y, size * 1.3);
    glow.addColorStop(0, `rgba(255,43,43,${0.28 + S.threat * 0.4})`);
    glow.addColorStop(1, "rgba(255,43,43,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, size * 1.3, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(S.logoSpin * 0.6);
    if (logoImg && logoImg.complete && logoImg.naturalWidth) {
      // Logo weiß einfärben: als Maske via 'lighter' nicht ideal -> wir zeichnen
      // das (dunkle) Logo auf einem hellen Chip, damit es klar lesbar bleibt.
      const s = size;
      ctx.drawImage(tintedLogo(size), -s / 2, -s / 2, s, s);
    } else {
      // Fallback-Diamant
      ctx.fillStyle = PALETTE.accent;
      ctx.fillRect(-size / 3, -size / 3, size * 0.66, size * 0.66);
    }
    ctx.restore();
  }

  // Logo einmalig weiß eingefärbt cachen (schwarzes SVG -> weiß)
  let _tint = null, _tintSize = 0;
  function tintedLogo(size) {
    const s = Math.ceil(size);
    if (_tint && _tintSize === s) return _tint;
    const c = document.createElement("canvas"); c.width = c.height = s;
    const cx = c.getContext("2d");
    cx.drawImage(logoImg, 0, 0, s, s);
    cx.globalCompositeOperation = "source-in";
    cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, s, s);
    _tint = c; _tintSize = s; return c;
  }

  function drawPlayer(gY) {
    const p = S.player, x = playerX(), baseY = gY + p.y;
    const danger = Math.min(1, Math.max(0, (S.threat - 0.55) / 0.45));
    ctx.save();
    ctx.translate(x, baseY);

    // Schatten
    ctx.fillStyle = "rgba(0,0,0,.4)";
    const sh = p.onGround ? 1 : Math.max(0.3, 1 + p.y / 260);
    ctx.beginPath(); ctx.ellipse(0, 2, 22 * sh, 6 * sh, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = PALETTE.ink;
    if (danger > 0) { ctx.shadowColor = PALETTE.accent; ctx.shadowBlur = 18 * danger; }

    if (p.sliding) {
      // geduckte, gestreckte Form
      ctx.fillRect(-24, -30, 46, 26);
      ctx.beginPath(); ctx.moveTo(22, -30); ctx.lineTo(34, -30); ctx.lineTo(22, -10); ctx.closePath(); ctx.fill();
      ctx.restore(); return;
    }

    const run = p.onGround ? Math.sin(p.runPhase * Math.PI * 2) : 0.4;
    const run2 = p.onGround ? Math.sin(p.runPhase * Math.PI * 2 + Math.PI) : -0.4;
    // Torso (nach vorn geneigtes Parallelogramm)
    ctx.beginPath();
    ctx.moveTo(-8, -70); ctx.lineTo(12, -66); ctx.lineTo(8, -26); ctx.lineTo(-12, -30); ctx.closePath(); ctx.fill();
    // Kopf
    ctx.fillRect(2, -84, 16, 16);
    // Arme
    leg(ctx, 4, -60, 18 * run, 20, 5);
    // Beine
    leg(ctx, -4, -28, 20 * run, 30, 7);
    leg(ctx, 0, -28, 20 * run2, 30, 7);
    ctx.restore();
  }
  function leg(c, x, y, swing, len, w) {
    c.save(); c.translate(x, y); c.rotate(swing * 0.03);
    c.fillRect(-w / 2, 0, w, len);
    c.restore();
  }

  function drawParticles() {
    for (const pt of S.particles) {
      ctx.globalAlpha = Math.max(0, pt.life * 2);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.r, pt.y - pt.r, pt.r * 2, pt.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- Loop ---------------- */
  function frame(now) {
    if (!running) return;
    if (!lastT) lastT = now;
    let dt = (now - lastT) / 1000; lastT = now;
    dt = Math.min(dt, 0.05);       // Tab-Wechsel abfedern
    const res = step(dt);
    draw();
    if (res === "OVER") return;
    raf = requestAnimationFrame(frame);
  }

  function gameOver(reason) {
    if (S.over) return "OVER";
    S.over = true; S.reason = reason; running = false;
    cancelAnimationFrame(raf);
    const durationMs = Math.max(0, Math.round(performance.now() - S.startMs));
    onGameOver({ score: S.score, durationMs, jumps: S.jumps, hits: S.hits, reason });
    return "OVER";
  }

  /* ---------------- Public API ---------------- */
  function start() {
    layout(); reset();
    running = true; lastT = 0; S.startMs = performance.now();
    onScore(0); onThreat(S.threat);
    bindInput();
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); unbindInput(); }

  return { start, stop, get score() { return S.score; } };
}

/* ---------------- Utils ---------------- */
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function easeIn(t) { return t * t; }
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
