/**
 * Erzeugt die App-Icons des Partner-Programms unter public/.
 *
 * Gleiche Machart und Farbwelt wie der Content-Generator (Verlauf blau ->
 * violett -> orange, randlos, vollständig deckend, Motiv in der inneren Hälfte,
 * damit die runde Maske von iOS/Android nichts abschneidet) - aber ein eigenes
 * Motiv: zwei ineinandergreifende Ringe. Sie stehen für Verbindung und
 * Partnerschaft und unterscheiden das Partner-Programm auf einen Blick vom
 * Video-Generator (dort ein Play-Dreieck).
 *
 * Ohne Abhängigkeiten - PNG von Hand: Signatur, IHDR, ein per zlib gepacktes
 * IDAT, IEND. "node scripts/make-icons.mjs" baut alle drei neu.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const ZIEL = join(HIER, "..", "public");

// --- Farben (identisch zum Content-Generator) ------------------------------

const BG_OBEN = [0x16, 0x1b, 0x28];
const BG_UNTEN = [0x0b, 0x0d, 0x12];
const GLYPH_STUFEN = [
  [0x4f, 0x7c, 0xff], // --accent
  [0xb0, 0x6a, 0xd0], // violette Zwischenstufe
  [0xf5, 0x64, 0x3c], // --viral
];

// --- Geometrie: zwei ineinandergreifende Ringe (Einheitsquadrat 0..1) ------

const RING_R = 0.17; // Radius der Ringmitte
const RING_DICKE = 0.055; // halbe Strichstärke
const LINKS = [0.42, 0.5];
const RECHTS = [0.58, 0.5];
const UEBERABTASTUNG = 4;

// Waagerechte Ausdehnung des Motivs - für den Farbverlauf über die Ringe.
const MOTIV_LINKS = LINKS[0] - RING_R - RING_DICKE;
const MOTIV_RECHTS = RECHTS[0] + RING_R + RING_DICKE;

const mische = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const klemme = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);

function stufenfarbe(stufen, t) {
  const s = klemme(t) * (stufen.length - 1);
  const i = Math.min(Math.floor(s), stufen.length - 2);
  return mische(stufen[i], stufen[i + 1], s - i);
}

/** Vorzeichenloser Abstand zum Ringband (<= 0 heisst: auf dem Ring). */
function ringAbstand(x, y, [cx, cy]) {
  return Math.abs(Math.hypot(x - cx, y - cy) - RING_R) - RING_DICKE;
}

/** Deckungsgrad an einem Bildpunkt (auf einem der beiden Ringe), geglättet. */
function deckung(px, py, groesse) {
  let treffer = 0;
  for (let sy = 0; sy < UEBERABTASTUNG; sy++) {
    for (let sx = 0; sx < UEBERABTASTUNG; sx++) {
      const x = (px + (sx + 0.5) / UEBERABTASTUNG) / groesse;
      const y = (py + (sy + 0.5) / UEBERABTASTUNG) / groesse;
      if (Math.min(ringAbstand(x, y, LINKS), ringAbstand(x, y, RECHTS)) <= 0) treffer++;
    }
  }
  return treffer / (UEBERABTASTUNG * UEBERABTASTUNG);
}

// --- PNG -------------------------------------------------------------------

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function abschnitt(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const koerper = Buffer.concat([Buffer.from(typ, "ascii"), daten]);
  const pruefsumme = Buffer.alloc(4);
  pruefsumme.writeUInt32BE(crc32(koerper));
  return Buffer.concat([laenge, koerper, pruefsumme]);
}

function alsPng(groesse, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(groesse, 0);
  ihdr.writeUInt32BE(groesse, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const roh = Buffer.alloc(groesse * (1 + groesse * 3));
  for (let y = 0; y < groesse; y++) {
    const ziel = y * (1 + groesse * 3);
    roh[ziel] = 0;
    rgb.copy(roh, ziel + 1, y * groesse * 3, (y + 1) * groesse * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    abschnitt("IHDR", ihdr),
    abschnitt("IDAT", deflateSync(roh, { level: 9 })),
    abschnitt("IEND", Buffer.alloc(0)),
  ]);
}

function zeichne(groesse) {
  const rgb = Buffer.alloc(groesse * groesse * 3);

  for (let py = 0; py < groesse; py++) {
    for (let px = 0; px < groesse; px++) {
      const x = (px + 0.5) / groesse;
      const y = (py + 0.5) / groesse;

      let farbe = mische(BG_OBEN, BG_UNTEN, y);
      const schein = klemme(1 - Math.hypot(x - 0.5, y - 0.5) / 0.62);
      farbe = mische(farbe, GLYPH_STUFEN[0], schein * schein * 0.1);

      const a = deckung(px, py, groesse);
      if (a > 0) {
        const t = (x - MOTIV_LINKS) / (MOTIV_RECHTS - MOTIV_LINKS);
        farbe = mische(farbe, stufenfarbe(GLYPH_STUFEN, t), a);
      }

      const ziel = (py * groesse + px) * 3;
      rgb[ziel] = Math.round(klemme(farbe[0], 0, 255));
      rgb[ziel + 1] = Math.round(klemme(farbe[1], 0, 255));
      rgb[ziel + 2] = Math.round(klemme(farbe[2], 0, 255));
    }
  }

  return alsPng(groesse, rgb);
}

mkdirSync(ZIEL, { recursive: true });

for (const [name, groesse] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const daten = zeichne(groesse);
  writeFileSync(join(ZIEL, name), daten);
  console.log(`${name.padEnd(22)} ${groesse}x${groesse}  ${(daten.length / 1024).toFixed(1)} kB`);
}
