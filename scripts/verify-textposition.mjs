/**
 * Misst nach, wo der eingeblendete Text wirklich steht.
 *
 * Befund aus dem Abgleich: die Stile "banner" und "reference" setzten die
 * Oberkante über prozentuales paddingTop. CSS rechnet prozentuales Padding
 * gegen die BREITE des Elternelements - bei 1080x1920 ergaben die gemeinten
 * 22 % der Höhe also 238 px, was 12 % der Höhe sind. Der Text stand ein gutes
 * Stück zu hoch, und die Zahl im Code log.
 *
 * Geprüft wird nicht die Behauptung, sondern die echte Komponente: sie wird in
 * denselben Browser geladen, den Remotion beim Rendern verwendet, und die Lage
 * der Textzeilen wird in Pixeln ausgemessen. Zum Vergleich steht daneben ein
 * Kasten mit der alten Regel.
 *
 * Braucht weder Datenbank noch AWS. Aufruf: node scripts/verify-textposition.mjs
 */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { chromium } = require_("/opt/node22/lib/node_modules/playwright");

const BREITE = 1080;
const HOEHE = 1920;

let fehler = 0;
function pruefe(frage, ist, soll) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

/** Ein Wert gilt als getroffen, wenn er höchstens ein Prozent daneben liegt. */
function nahe(ist, soll, toleranz = HOEHE * 0.01) {
  return Math.abs(ist - soll) <= toleranz;
}

const EINTRAG = `
import React from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@remotion/player";
import { PromoVideo } from "./src/remotion/PromoVideo";
import { NUNITO_BLACK_WOFF2 } from "./src/remotion/assets/nunito";
import { BALOO_700 } from "./src/remotion/assets/rundschriften";

const TEXT = "When mom tells me to stay away\\nfrom the idiots out there but the\\nenemy is closer than she thinks";

function Buehne({ stil, id }) {
  return (
    <div id={id} style={{ position: "relative", width: ${BREITE}, height: ${HOEHE} }}>
      <Player
        component={PromoVideo}
        durationInFrames={90}
        fps={30}
        compositionWidth={${BREITE}}
        compositionHeight={${HOEHE}}
        style={{ width: ${BREITE}, height: ${HOEHE} }}
        inputProps={{
          hookText: TEXT,
          textStyle: stil,
          videoVolume: 0,
          // Ein Videobild wird hier nicht gebraucht - gemessen wird der Text.
          scenes: [{ src: "about:blank", startMs: 0, durationMs: 3000 }],
        }}
      />
    </div>
  );
}

/** Die alte Regel, im selben Browser: prozentuales paddingTop. */
function AlteRegel() {
  return (
    <div
      id="alt"
      style={{
        position: "relative",
        width: ${BREITE},
        height: ${HOEHE},
        display: "flex",
        // Wie AbsoluteFill: senkrechte Achse, sonst steuert justifyContent die
        // waagerechte und der Kasten sitzt in der Mitte.
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: "22%",
        boxSizing: "border-box",
      }}
    >
      <div id="alt-text" style={{ width: 100, height: 10, background: "red" }} />
    </div>
  );
}

/**
 * Beim Rendern haelt Remotion das Bild an, bis die eingebettete Schrift da ist
 * (delayRender). Im Player tut es das nicht: dort wird zuerst mit der
 * Ersatzschrift gemessen und umbrochen, und die echte Schrift kommt hinterher.
 * Gemessen waere dann ein Umbruch, den es im fertigen Video nicht gibt.
 *
 * Deshalb hier von Hand: sobald die Schriften geladen sind, alles neu
 * aufbauen - der Schluessel wechselt, also wird wirklich neu gemessen.
 */
function App() {
  return (
    <div id="huelle">
      <Buehne stil="reference" id="reference" />
      <Buehne stil="banner" id="banner" />
      <Buehne stil="rund-baloo" id="rund" />
      <AlteRegel />
    </div>
  );
}

/**
 * Die Schriften anmelden, BEVOR zum ersten Mal gezeichnet wird.
 *
 * Beim echten Rendern hält Remotion das erste Bild an, bis die eingebettete
 * Schrift da ist (delayRender) - gemessen wird also immer mit der richtigen.
 * Im Player gibt es das nicht: dort zeichnet React sofort, misst mit der
 * Ersatzschrift, und measureText MERKT SICH dieses Ergebnis. Ein späteres
 * Neuzeichnen hilft dann nicht mehr, es bekäme den gemerkten Wert. Der Umbruch
 * im Bild wäre ein anderer als im fertigen Video.
 */
async function schriftenLaden() {
  const faces = [
    new FontFace("Nunito", \`url(\${NUNITO_BLACK_WOFF2})\`, { weight: "900" }),
    new FontFace("Baloo2", \`url(\${BALOO_700})\`, { weight: "700" }),
  ];
  for (const face of faces) {
    document.fonts.add(await face.load());
  }
}

schriftenLaden().then(() => {
  createRoot(document.getElementById("wurzel")).render(<App />);
  document.body.dataset.bereit = "ja";
});
`;

const verzeichnis = mkdtempSync(join(tmpdir(), "textposition-"));
const bundle = join(verzeichnis, "bundle.js");

await build({
  stdin: { contents: EINTRAG, resolveDir: process.cwd(), loader: "tsx", sourcefile: "entry.tsx" },
  bundle: true,
  format: "iife",
  outfile: bundle,
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "error",
});

const seite = join(verzeichnis, "seite.html");
writeFileSync(
  seite,
  `<!doctype html><html><head><meta charset="utf8"><style>body{margin:0}</style></head>
   <body><div id="wurzel"></div><script src="./bundle.js"></script></body></html>`,
);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const seiteObj = await browser.newPage({ viewport: { width: BREITE, height: 600 } });
await seiteObj.goto(`file://${seite}`);
// Die eingebettete Schrift wird erst nachgeladen; vorher misst man die
// Ersatzschrift und damit die falsche Zeilenhöhe.
// Gezeichnet wird erst, wenn die Schriften angemeldet sind - siehe die
// Begründung im Eintrag.
await seiteObj.waitForSelector('body[data-bereit="ja"]', { timeout: 20_000 });
await seiteObj.waitForTimeout(500);

/** Oberkante und Mitte des Textblocks, relativ zum Bildanfang. */
async function messen(id) {
  return seiteObj.evaluate((buehneId) => {
    const buehne = document.getElementById(buehneId);
    const bezug = buehne.getBoundingClientRect();
    // Die Textzeilen sind die einzigen Elemente mit WebkitTextStroke.
    const zeilen = [...buehne.querySelectorAll("div")].filter(
      (el) => getComputedStyle(el).webkitTextStrokeWidth !== "0px" && el.textContent.trim(),
    );
    if (!zeilen.length) return null;
    const kaesten = zeilen.map((el) => el.getBoundingClientRect());
    const oben = Math.min(...kaesten.map((k) => k.top)) - bezug.top;
    const unten = Math.max(...kaesten.map((k) => k.bottom)) - bezug.top;
    return { oben, unten, mitte: (oben + unten) / 2, zeilen: zeilen.length };
  }, id);
}

const reference = await messen("reference");
const banner = await messen("banner");
const rund = await messen("rund");
const alt = await seiteObj.evaluate(() => {
  const b = document.getElementById("alt").getBoundingClientRect();
  return document.getElementById("alt-text").getBoundingClientRect().top - b.top;
});

console.log(`Bildgrösse ${BREITE}x${HOEHE}\n`);

console.log("1. Die alte Regel, im selben Browser nachgemessen");
console.log(`      paddingTop: "22%" ergibt ${alt.toFixed(0)} px`);
pruefe("prozentuales Padding rechnet gegen die Breite", nahe(alt, BREITE * 0.22, 5), true);
pruefe("und nicht gegen die Höhe", nahe(alt, HOEHE * 0.22, 5), false);

console.log('\n2. Stil "reference" - gemeint sind 22 % der Höhe');
console.log(
  `      Textblock: oben ${reference.oben.toFixed(0)} px, unten ${reference.unten.toFixed(0)} px, ${reference.zeilen} Zeilen`,
);
console.log(`      vorher stand er bei ${(BREITE * 0.22).toFixed(0)} px`);
pruefe("die Oberkante liegt bei 22 % der Höhe", nahe(reference.oben, HOEHE * 0.22), true);

console.log('\n3. Stil "banner" - gemeint sind 12 % der Höhe');
console.log(`      Textblock: oben ${banner.oben.toFixed(0)} px, ${banner.zeilen} Zeilen`);
console.log(`      vorher stand er bei ${(BREITE * 0.12).toFixed(0)} px`);
pruefe("die Oberkante liegt bei 12 % der Höhe", nahe(banner.oben, HOEHE * 0.12), true);

console.log("\n4. Die Reels-Stile bleiben, wo sie waren");
console.log(`      Textblock: Mitte ${rund.mitte.toFixed(0)} px, ${rund.zeilen} Zeilen`);
pruefe("die Mitte liegt weiterhin bei 42 % der Höhe", nahe(rund.mitte, HOEHE * 0.42), true);

// Zum Ansehen: so sieht der korrigierte Stand aus.
const bild = process.env.BILD_PFAD ?? join(verzeichnis, "reference.png");
await seiteObj.locator("#reference").screenshot({ path: bild });
console.log(`\nBild des korrigierten Stands: ${bild}`);

await browser.close();
console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
