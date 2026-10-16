/* =========================================================================
   EdgeChase Game – Szenerie (Himmel, Skyline-Schichten, Fassade)

   Alles wird einmal in kleine Zeichenflächen vorgerendert (und bei Größenänderung neu),
   damit pro Bild nur wenige drawImage-Aufrufe nötig sind – das hält auch Handys flüssig.
   Maße sind "Welt-Einheiten" (u); U = Pixel pro Einheit.
   ========================================================================= */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
};
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- Himmel: Verlauf, Sterne, rotes Glühen am Horizont (bildschirmfüllend, einmalig) ---------- */
export function buildSky(W, H, GY, U) {
  const c = canvas(W, H), x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, GY * U);
  g.addColorStop(0, "#050507");
  g.addColorStop(0.45, "#0b080c");
  g.addColorStop(0.78, "#220b0f");
  g.addColorStop(1, "#4a1015");
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  const r = mulberry32(7);
  for (let i = 0; i < 70; i++) {                       // ein paar Sterne, nach oben dichter
    const sx = r() * W, sy = Math.pow(r(), 1.7) * GY * U * 0.7, a = 0.15 + r() * 0.5;
    x.fillStyle = `rgba(255,255,255,${a})`; x.fillRect(sx, sy, r() < 0.15 ? 2 : 1, r() < 0.15 ? 2 : 1);
  }
  // Sonne / Glühen hinter der Skyline
  const cx = W * 0.72, cy = GY * U - GY * U * 0.12, R = Math.max(W, GY * U) * 0.62;
  const glow = x.createRadialGradient(cx, cy, 0, cx, cy, R);
  glow.addColorStop(0, "rgba(237,28,36,0.55)");
  glow.addColorStop(0.22, "rgba(237,28,36,0.28)");
  glow.addColorStop(0.6, "rgba(120,14,20,0.10)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = glow; x.fillRect(0, 0, W, H);
  const sun = x.createRadialGradient(cx, cy, 0, cx, cy, W * 0.13);   // heller Kern
  sun.addColorStop(0, "rgba(255,120,110,0.85)"); sun.addColorStop(0.5, "rgba(237,28,36,0.55)"); sun.addColorStop(1, "rgba(237,28,36,0)");
  x.fillStyle = sun; x.beginPath(); x.arc(cx, cy, W * 0.13, 0, Math.PI * 2); x.fill();
  // Unterhalb der Dächer: tiefes Dunkel (Straßenschlucht)
  const g2 = x.createLinearGradient(0, GY * U, 0, H);
  g2.addColorStop(0, "#0c0709"); g2.addColorStop(1, "#050506");
  x.fillStyle = g2; x.fillRect(0, GY * U, W, H - GY * U);
  return c;
}

/* ---------- eine Skyline-Schicht (nahtlos wiederholbar) ---------- */
function buildLayer(o) {
  const { Tu, Hu, GY, U } = o;
  const topY = Math.max(0, GY - o.maxH - 70);
  const c = canvas(Tu * U, (Hu - topY) * U), x = c.getContext("2d");
  x.scale(U, U); x.translate(0, -topY);
  const r = mulberry32(o.seed);
  const lights = [];
  const buildings = [];
  let cx = 0;
  while (cx < Tu - 2) {
    let w = o.minW + r() * (o.maxW - o.minW);
    if (Tu - (cx + w) < o.minW) w = Tu - cx;            // letzte Lücke schließen -> nahtlose Kachel
    const h = o.minH + r() * (o.maxH - o.minH);
    buildings.push({ x: cx, w, h });
    cx += w + (o.gapMax ? r() * o.gapMax : 0);
  }
  buildings.forEach((b, bi) => {
    const top = GY - b.h;
    const g = x.createLinearGradient(0, top, 0, Hu);
    g.addColorStop(0, o.fillTop); g.addColorStop(1, o.fillBot);
    x.fillStyle = g; x.fillRect(b.x, top, b.w, Hu - top);
    // Kantenlicht oben (rote Reflexion der Sonne)
    x.fillStyle = o.rim; x.fillRect(b.x, top, b.w, 1.4);
    // Fenster
    if (o.winProb > 0) {
      const cw = o.cell[0], ch = o.cell[1];
      for (let wy = top + 8; wy < GY + (Hu - GY) * 0.4; wy += ch) {
        for (let wx = b.x + 5; wx < b.x + b.w - 5 - o.win[0]; wx += cw) {
          const q = r();
          if (q < o.winProb) {
            x.fillStyle = o.winColors[(r() * o.winColors.length) | 0];
            x.fillRect(wx, wy, o.win[0], o.win[1]);
          } else if (q < o.winProb + 0.3) {
            x.fillStyle = "rgba(255,255,255,0.04)"; x.fillRect(wx, wy, o.win[0], o.win[1]);
          }
        }
      }
    }
    // Dach-Aufbauten
    if (o.details && b.w > 46) {
      const k = r();
      x.fillStyle = o.fillTop;
      if (k < 0.3) {                                      // Wassertank auf Stelzen
        const tx = b.x + 8 + r() * (b.w - 40);
        x.fillRect(tx + 2, top - 12, 1.6, 12); x.fillRect(tx + 16, top - 12, 1.6, 12);
        x.beginPath(); x.ellipse(tx + 10, top - 20, 11, 9, 0, 0, Math.PI * 2); x.fill();
        x.fillRect(tx - 1, top - 20, 22, 8);
      } else if (k < 0.62) {                              // Antenne mit Blinklicht
        const ax = b.x + 10 + r() * (b.w - 20), ah = 26 + r() * 40;
        x.fillRect(ax, top - ah, 1.5, ah); x.fillRect(ax - 5, top - ah * 0.7, 11, 1.2); x.fillRect(ax - 3, top - ah * 0.45, 7, 1.2);
        lights.push({ x: ax + 0.7, y: top - ah, ph: r() * 6.28 });
      } else if (k < 0.85) {                              // Klimageräte
        const bx = b.x + 6 + r() * (b.w - 40);
        x.fillRect(bx, top - 7, 15, 7); x.fillRect(bx + 19, top - 5, 11, 5);
        x.fillStyle = "rgba(255,255,255,0.05)"; x.fillRect(bx + 2, top - 5, 11, 1);
      }
    }
  });
  // Neon-Schriftzug (Wort-Bild-Logo in Rot) auf einem Dach
  if (o.sign && o.wordmark) {
    const b = buildings.reduce((m, q) => (q.w > m.w ? q : m), buildings[0]);
    const sw = Math.min(150, b.w - 16), sh = sw * (o.wordmark.height / o.wordmark.width);
    const sx = b.x + (b.w - sw) / 2, sy = GY - b.h - sh - 26;
    x.fillStyle = "#0a0a0c"; x.fillRect(sx - 6, sy - 6, sw + 12, sh + 12);           // Tafel
    x.fillRect(sx + 8, sy + sh + 6, 3, 26); x.fillRect(sx + sw - 11, sy + sh + 6, 3, 26);  // Pfosten
    x.strokeStyle = "rgba(237,28,36,0.55)"; x.lineWidth = 1; x.strokeRect(sx - 6, sy - 6, sw + 12, sh + 12);
    const tint = canvas(sw * 3, sh * 3), t = tint.getContext("2d");
    t.drawImage(o.wordmark, 0, 0, sw * 3, sh * 3); t.globalCompositeOperation = "source-in"; t.fillStyle = "#ff3a40"; t.fillRect(0, 0, sw * 3, sh * 3);
    x.save(); x.shadowColor = "rgba(237,28,36,0.95)"; x.shadowBlur = 14; x.drawImage(tint, sx, sy, sw, sh); x.drawImage(tint, sx, sy, sw, sh); x.restore();
  }
  // Dunst: unten heller und rötlich (Luftperspektive + Sonnenlicht)
  if (o.haze) {
    x.globalCompositeOperation = "source-atop";
    const hz = x.createLinearGradient(0, GY - o.maxH, 0, Hu);
    hz.addColorStop(0, "rgba(237,28,36,0)"); hz.addColorStop(0.7, `rgba(237,28,36,${o.haze})`); hz.addColorStop(1, `rgba(60,10,14,${o.haze * 0.4})`);
    x.fillStyle = hz; x.fillRect(0, topY, Tu, Hu - topY);
    x.globalCompositeOperation = "source-over";
  }
  return { canvas: c, topY, Tu, lights };
}

/* ---------- Fassade unter der Dachkante (Fenster, Fallrohre, Klimageräte) ---------- */
function buildFacade(Hu, GY, U) {
  const Tu = 360, h = Math.max(40, Hu - GY + 12);
  const c = canvas(Tu * U, h * U), x = c.getContext("2d");
  x.scale(U, U);
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#17171c"); g.addColorStop(1, "#08080a");
  x.fillStyle = g; x.fillRect(0, 0, Tu, h);
  const r = mulberry32(21);
  x.fillStyle = "rgba(255,255,255,0.035)";                       // Plattennähte
  for (let px = 0; px < Tu; px += 90) x.fillRect(px, 0, 1, h);
  for (let py = 14; py < h; py += 52) x.fillRect(0, py, Tu, 1);
  for (let col = 0; col < Tu / 44; col++) {                       // Fenster
    for (let row = 0; row < 4; row++) {
      const wx = col * 44 + 10, wy = 24 + row * 36;
      if (wy > h - 12) continue;
      const lit = r() < 0.22;
      if (lit) {
        const gg = x.createLinearGradient(0, wy, 0, wy + 16); gg.addColorStop(0, "rgba(255,206,140,0.85)"); gg.addColorStop(1, "rgba(255,150,90,0.6)");
        x.fillStyle = gg; x.fillRect(wx, wy, 22, 16);
        x.fillStyle = "rgba(255,190,120,0.07)"; x.fillRect(wx - 4, wy - 4, 30, 24);
      } else { x.fillStyle = "rgba(255,255,255,0.045)"; x.fillRect(wx, wy, 22, 16); }
      x.fillStyle = "rgba(0,0,0,0.5)"; x.fillRect(wx, wy + 16, 22, 1.5);                 // Fensterbank-Schatten
    }
  }
  x.fillStyle = "#26262d";                                       // Fallrohre
  [57, 213, 318].forEach((px) => { x.fillRect(px, 0, 5, h); x.fillStyle = "#3a3a44"; x.fillRect(px, 0, 1.2, h); x.fillStyle = "#26262d"; });
  return { canvas: c, Tu, h };
}

export function buildScenery({ Wu, Hu, GY, U, W, H, wordmarkImg, skyH: skyHOpt }) {
  const Tu = Math.ceil(Math.max(Wu * 1.3, 800));
  const skyH = skyHOpt || Math.min(GY, 300);
  const far = buildLayer({
    seed: 11, Tu, Hu, GY, U, minW: 46, maxW: 110, minH: skyH * 0.30, maxH: skyH * 0.66,
    fillTop: "#24090d", fillBot: "#150709", rim: "rgba(255,90,80,0.35)", gapMax: 4,
    winProb: 0.10, cell: [9, 12], win: [2.4, 3.2], winColors: ["rgba(255,214,160,0.45)", "rgba(255,255,255,0.28)"],
    details: false, haze: 0.0,
  });
  const mid = buildLayer({
    seed: 29, Tu, Hu, GY, U, minW: 70, maxW: 150, minH: skyH * 0.16, maxH: skyH * 0.38,
    fillTop: "#121217", fillBot: "#09090c", rim: "rgba(255,70,64,0.28)", gapMax: 8,
    winProb: 0.22, cell: [8, 11], win: [3.2, 4.4], winColors: ["rgba(255,214,150,0.7)", "rgba(190,215,255,0.5)", "rgba(255,170,120,0.6)"],
    details: true, sign: true, wordmark: wordmarkImg, haze: 0.0,
  });
  const near = buildLayer({
    seed: 53, Tu, Hu, GY, U, minW: 90, maxW: 190, minH: skyH * 0.05, maxH: skyH * 0.17,
    fillTop: "#0b0b0e", fillBot: "#050506", rim: "rgba(255,60,55,0.18)", gapMax: 14,
    winProb: 0.12, cell: [10, 13], win: [3.6, 4.8], winColors: ["rgba(255,200,140,0.6)"],
    details: true, haze: 0.0,
  });
  return { Tu, sky: buildSky(W, H, GY, U), far, mid, near, facade: buildFacade(Hu, GY, U) };
}

/* ---------- eine Schicht gekachelt zeichnen ---------- */
export function drawLayer(ctx, L, scroll, par, Wu, blink) {
  const off = (scroll * par) % L.Tu;
  for (let x = -off; x < Wu; x += L.Tu) ctx.drawImage(L.canvas, x, L.topY, L.Tu, L.canvas.height / (L.canvas.width / L.Tu));
  if (blink && L.lights.length) {
    ctx.fillStyle = "#ff3037";
    for (let x = -off; x < Wu; x += L.Tu) {
      for (const l of L.lights) {
        const a = 0.25 + 0.75 * Math.max(0, Math.sin(blink * 3 + l.ph));
        if (x + l.x < -4 || x + l.x > Wu + 4) continue;
        ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x + l.x, l.y, 1.5, 0, 6.283); ctx.fill();
        ctx.globalAlpha = a * 0.25; ctx.beginPath(); ctx.arc(x + l.x, l.y, 5, 0, 6.283); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
