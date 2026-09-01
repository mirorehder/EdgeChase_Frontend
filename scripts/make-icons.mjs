/**
 * Erzeugt die App-Icons unter public/.
 *
 * Warum ein Skript und keine abgelegten Bilder: die Icons sollen sich mit der
 * Leitfarbe ändern lassen, ohne dass jemand ein Bildbearbeitungsprogramm
 * öffnet. Ein Aufruf von "node scripts/make-icons.mjs" baut alle drei neu.
 *
 * Ohne Abhängigkeiten - PNG ist einfach genug, um es hier zu schreiben:
 * Signatur, IHDR, ein per zlib gepacktes IDAT, IEND.
 *
 * Alle drei Bilder sind randlos und vollständig deckend. Das ist Absicht:
 * Android beschneidet "maskable"-Icons zu einem Kreis, und iOS legt seine
 * eigene runde Maske darüber. Ein Bild mit eigenen runden Ecken bekäme dabei
 * schwarze Zipfel. Das Motiv sitzt deshalb in der mittleren Hälfte, weit
 * innerhalb der 80%, die beim Beschneiden garantiert erhalten bleiben.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const ZIEL = join(HIER, "..", "public");

// --- Farben (identisch zu src/app/globals.css) ------------------------------

const BG_OBEN = [0x16, 0x1b, 0x28];
const BG_UNTEN = [0x0b, 0x0d, 0x12];
// Drei Stufen, nicht zwei: Blau und Orange liegen im Farbkreis fast
// gegenüber, ihre direkte Mischung ist ein stumpfes Graubraun. Die violette
// Zwischenstufe ist genau der Weg aussen herum und hält den Verlauf kräftig -
// nebenbei sind es die Leitfarben dreier Sparten.
const GLYPH_STUFEN = [
  [0x4f, 0x7c, 0xff], // --accent, Promo
  [0xb0, 0x6a, 0xd0], // zwischen --clothing und --viral
  [0xf5, 0x64, 0x3c], // --viral, Doc Meiro
];

// --- Geometrie des Motivs (Einheitsquadrat 0..1) ---------------------------

// Ein nach rechts zeigendes Dreieck, leicht nach rechts versetzt: der
// Schwerpunkt eines Dreiecks liegt nicht dort, wo das Auge die Mitte sieht.
const ECKEN = [
  [0.365, 0.275],
  [0.365, 0.725],
  [0.725, 0.5],
];
const ECKRADIUS = 0.055;
const UEBERABTASTUNG = 4;

// --- Kleine Helfer ---------------------------------------------------------

const mische = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const klemme = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);

/** Verlauf über beliebig viele Stufen, t von 0 bis 1. */
function stufenfarbe(stufen, t) {
  const s = klemme(t) * (stufen.length - 1);
  const i = Math.min(Math.floor(s), stufen.length - 2);
  return mische(stufen[i], stufen[i + 1], s - i);
}

/**
 * Das um ECKRADIUS nach innen versetzte Dreieck.
 *
 * Ein Dreieck um seinen Inkreismittelpunkt zu stauchen versetzt alle drei
 * Kanten um denselben Betrag nach innen - genau das, was ein Versatz braucht.
 * Wird dieses kleinere Dreieck anschliessend wieder um ECKRADIUS aufgedickt,
 * entsteht die ursprüngliche Aussenkante mit runden Ecken.
 */
const KLEINERES_DREIECK = (() => {
  const seite = (i) => {
    const [ax, ay] = ECKEN[(i + 1) % 3];
    const [bx, by] = ECKEN[(i + 2) % 3];
    return Math.hypot(bx - ax, by - ay);
  };
  const laengen = [seite(0), seite(1), seite(2)];
  const umfang = laengen[0] + laengen[1] + laengen[2];

  // Inkreismittelpunkt: die Ecken, gewichtet mit der Länge der Gegenseite.
  const mx = ECKEN.reduce((s, e, i) => s + e[0] * laengen[i], 0) / umfang;
  const my = ECKEN.reduce((s, e, i) => s + e[1] * laengen[i], 0) / umfang;

  // Fläche über das Kreuzprodukt, daraus der Inkreisradius.
  const flaeche =
    Math.abs(
      (ECKEN[1][0] - ECKEN[0][0]) * (ECKEN[2][1] - ECKEN[0][1]) -
        (ECKEN[2][0] - ECKEN[0][0]) * (ECKEN[1][1] - ECKEN[0][1]),
    ) / 2;
  const inkreis = (2 * flaeche) / umfang;

  const k = (inkreis - ECKRADIUS) / inkreis;
  return ECKEN.map(([x, y]) => [mx + (x - mx) * k, my + (y - my) * k]);
})();

/** Abstand eines Punktes zur Strecke a-b. */
function abstandZurStrecke(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = klemme(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Abstand zum Dreieck mit abgerundeten Ecken, negativ innen. */
function abstandZumDreieck(x, y) {
  let naechste = Infinity;
  let innen = true;

  for (let i = 0; i < 3; i++) {
    const a = KLEINERES_DREIECK[i];
    const b = KLEINERES_DREIECK[(i + 1) % 3];
    naechste = Math.min(naechste, abstandZurStrecke(x, y, a, b));
    // Bei einem im Uhrzeigersinn angegebenen Dreieck liegt ein innerer Punkt
    // zu jeder Kante auf derselben Seite.
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0) innen = false;
  }

  return (innen ? -naechste : naechste) - ECKRADIUS;
}

/** Deckungsgrad des Motivs an einem Bildpunkt, mit Überabtastung geglättet. */
function deckung(px, py, groesse) {
  let treffer = 0;
  for (let sy = 0; sy < UEBERABTASTUNG; sy++) {
    for (let sx = 0; sx < UEBERABTASTUNG; sx++) {
      const x = (px + (sx + 0.5) / UEBERABTASTUNG) / groesse;
      const y = (py + (sy + 0.5) / UEBERABTASTUNG) / groesse;
      if (abstandZumDreieck(x, y) <= 0) treffer++;
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

/** @param {number} groesse @param {Buffer} rgb  Bildpunkte ohne Alpha. */
function alsPng(groesse, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(groesse, 0);
  ihdr.writeUInt32BE(groesse, 4);
  ihdr[8] = 8; // 8 Bit je Kanal
  ihdr[9] = 2; // Farbtyp 2 = RGB, deckend
  // 10..12 bleiben 0: Deflate, Standardfilter, kein Zeilensprung.

  // Jede Zeile bekommt ein führendes Filterbyte. 0 heisst "kein Filter" - bei
  // grossen Flächen mit weichem Verlauf bringt ein Filter kaum etwas, und die
  // Dateien bleiben so oder so klein.
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

// --- Bild ------------------------------------------------------------------

function zeichne(groesse) {
  const rgb = Buffer.alloc(groesse * groesse * 3);

  for (let py = 0; py < groesse; py++) {
    for (let px = 0; px < groesse; px++) {
      const x = (px + 0.5) / groesse;
      const y = (py + 0.5) / groesse;

      // Untergrund: senkrechter Verlauf, dazu ein weicher Schein hinter dem
      // Motiv, damit das Icon in kleinen Grössen nicht flach wirkt.
      let farbe = mische(BG_OBEN, BG_UNTEN, y);
      const schein = klemme(1 - Math.hypot(x - 0.5, y - 0.5) / 0.62);
      farbe = mische(farbe, GLYPH_STUFEN[0], schein * schein * 0.1);

      const a = deckung(px, py, groesse);
      if (a > 0) {
        const t = klemme((x - 0.365) / 0.36) * 0.72 + klemme((y - 0.275) / 0.45) * 0.28;
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
  // iOS nimmt die Manifest-Icons nicht, sondern ausschliesslich diese Datei.
  ["apple-touch-icon.png", 180],
]) {
  const daten = zeichne(groesse);
  writeFileSync(join(ZIEL, name), daten);
  console.log(`${name.padEnd(22)} ${groesse}x${groesse}  ${(daten.length / 1024).toFixed(1)} kB`);
}
