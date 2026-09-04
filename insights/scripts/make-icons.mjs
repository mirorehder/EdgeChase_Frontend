/**
 * Erzeugt die App-Icons unter public/ - als aufsteigendes Balkendiagramm.
 *
 * Analog zum Skript des Generators (scripts/make-icons.mjs) ohne
 * Abhaengigkeiten: PNG-Signatur, IHDR, ein per zlib gepacktes IDAT, IEND.
 *
 * Das Motiv ist absichtlich das eines Diagramms - so ist auf einen Blick
 * klar, dass dies die Auswertungs-App ist und nicht der Generator. Die
 * Balken steigen von links nach rechts an (Wachstum) und tragen einen
 * Verlauf ueber die vier Sparten-Farben, so bleibt die Zugehoerigkeit
 * sichtbar. Alles innerhalb der 80%-Sichtzone, damit Android/iOS beim
 * runden Beschneiden nichts vom Motiv abschneiden.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const ZIEL = join(HIER, "..", "public");

// Hintergrund: dunkler Verlauf, so wie in der App im Dunkelmodus.
const BG_OBEN = [0x17, 0x1a, 0x21];
const BG_UNTEN = [0x0b, 0x0d, 0x12];

// Vier Balken, links -> rechts steigend, ihre Farben aus SPARTEN.farbeHex.
const BALKEN_FARBEN = [
  [0x4f, 0x7c, 0xff], // promo
  [0xf5, 0x64, 0x3c], // viral
  [0x3e, 0xcf, 0x8e], // sports
  [0xc0, 0x84, 0xfc], // clothing
];
// Balkenhoehen als Anteil der Bildhoehe (untere Kante der Balkenzone).
// Die Werte formen eine sanft ansteigende Kurve und laufen aufeinander zu -
// weil eine aufsteigende Reihe genau die Botschaft ist.
const BALKEN_HOEHEN = [0.32, 0.48, 0.66, 0.86];

// Motivrahmen im Einheitsquadrat (0..1). 0.18 Rand innen laesst dem
// Beschneiden auf einen Kreis genug Luft - iOS und Android beide.
const RAND = 0.18;
const BALKEN_UNTEN = 0.86;
const BALKEN_LUECKE = 0.02;
const BALKEN_ECKRADIUS = 0.02;

// Antialiasing: pro Ausgabepixel n x n Abtastpunkte, danach gemittelt.
const UEBERABTASTUNG = 4;

function mische(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}
function klemme(v, min = 0, max = 1) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Ist Punkt (x, y) innerhalb eines abgerundeten Rechtecks (in
 * Einheitskoordinaten)?
 */
function inAbgerundetemRechteck(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  // Nah an einer Ecke?
  for (const [ex, ey] of [
    [x0 + r, y0 + r],
    [x1 - r, y0 + r],
    [x0 + r, y1 - r],
    [x1 - r, y1 - r],
  ]) {
    const dx = ex - x;
    const dy = ey - y;
    const inEcke =
      ((ex === x0 + r && x < x0 + r) || (ex === x1 - r && x > x1 - r)) &&
      ((ey === y0 + r && y < y0 + r) || (ey === y1 - r && y > y1 - r));
    if (inEcke) return dx * dx + dy * dy <= r * r;
  }
  return true;
}

function farbeFuer(u, v) {
  // u,v in 0..1 - u nach rechts, v nach unten.
  // Erst der Hintergrund als vertikaler Verlauf.
  const hg = mische(BG_OBEN, BG_UNTEN, v);

  const nutzBreite = 1 - 2 * RAND;
  const balkenBreite =
    (nutzBreite - BALKEN_LUECKE * (BALKEN_FARBEN.length - 1)) /
    BALKEN_FARBEN.length;

  for (let i = 0; i < BALKEN_FARBEN.length; i += 1) {
    const x0 = RAND + i * (balkenBreite + BALKEN_LUECKE);
    const x1 = x0 + balkenBreite;
    const y1 = BALKEN_UNTEN;
    const y0 = BALKEN_UNTEN - BALKEN_HOEHEN[i] * (BALKEN_UNTEN - RAND);
    if (
      inAbgerundetemRechteck(u, v, x0, y0, x1, y1, BALKEN_ECKRADIUS)
    ) {
      // Leichter vertikaler Verlauf auf dem Balken - oben etwas heller.
      const t = klemme((v - y0) / Math.max(1e-6, y1 - y0));
      const grund = BALKEN_FARBEN[i];
      const hell = grund.map((c) => Math.min(255, c + 30));
      return mische(hell, grund, t);
    }
  }
  return hg;
}

function zeichneBild(groesse) {
  const puffer = Buffer.alloc(groesse * groesse * 4);
  for (let y = 0; y < groesse; y += 1) {
    for (let x = 0; x < groesse; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < UEBERABTASTUNG; sy += 1) {
        for (let sx = 0; sx < UEBERABTASTUNG; sx += 1) {
          const u = (x + (sx + 0.5) / UEBERABTASTUNG) / groesse;
          const v = (y + (sy + 0.5) / UEBERABTASTUNG) / groesse;
          const [rr, gg, bb] = farbeFuer(u, v);
          r += rr;
          g += gg;
          b += bb;
        }
      }
      const n = UEBERABTASTUNG * UEBERABTASTUNG;
      const idx = (y * groesse + x) * 4;
      puffer[idx] = Math.round(r / n);
      puffer[idx + 1] = Math.round(g / n);
      puffer[idx + 2] = Math.round(b / n);
      puffer[idx + 3] = 255;
    }
  }
  return puffer;
}

// --- PNG-Kodierung ohne Abhaengigkeiten ------------------------------------

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TAB[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length, 0);
  const typBuf = Buffer.from(typ, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typBuf, daten])), 0);
  return Buffer.concat([laenge, typBuf, daten, crcBuf]);
}

function schreibePng(groesse, rgba) {
  const signatur = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(groesse, 0);
  ihdr.writeUInt32BE(groesse, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Filter-Byte 0 (None) je Zeile.
  const zeilen = Buffer.alloc(groesse * (groesse * 4 + 1));
  for (let y = 0; y < groesse; y += 1) {
    zeilen[y * (groesse * 4 + 1)] = 0;
    rgba.copy(
      zeilen,
      y * (groesse * 4 + 1) + 1,
      y * groesse * 4,
      (y + 1) * groesse * 4,
    );
  }
  const idat = deflateSync(zeilen, { level: 9 });

  return Buffer.concat([
    signatur,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function bau(name, groesse) {
  const rgba = zeichneBild(groesse);
  const png = schreibePng(groesse, rgba);
  const pfad = join(ZIEL, name);
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, png);
  console.log(`geschrieben: ${name} (${groesse}x${groesse}, ${png.length} B)`);
}

bau("icon-192.png", 192);
bau("icon-512.png", 512);
bau("apple-touch-icon.png", 180);
