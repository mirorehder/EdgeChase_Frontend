/**
 * Rechnet nach, was der Höhepunkt und die Fenster-Beschreibung ändern.
 *
 * Zwei Befunde aus dem Abgleich mit dem Vorgängersystem:
 *
 * 1. Geschnitten wurde ab dem Absprung. Bei einem langen Trick - Anlauf,
 *    Klettern, dann der Salto - passt das Trickfenster nicht in eine
 *    Einstellung, und die Landung fällt hinten heraus: gezeigt wird der
 *    Anlauf, die Pointe fehlt.
 *
 * 2. Ausgewählt wurde auf die Beschreibung des GANZEN Clips. Der dauert oft
 *    eine halbe Minute, davon kommt rund eine Sekunde ins Video - ein Clip
 *    konnte also wegen einer Stelle gewählt werden, die nie zu sehen ist.
 *
 * Braucht weder Datenbank noch Gemini: geprüft wird die Schnittrechnung und
 * die Zeile, die die Auswahl zu lesen bekommt.
 */
import { kandidatenZeile } from "../src/lib/gemini";
import {
  CURRENT_ANALYSIS_VERSION,
  MIN_USABLE_ANALYSIS_VERSION,
  viralSceneWindow,
} from "../src/lib/pipeline";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

/**
 * Die alte Rechnung, nachgebildet: immer ab dem Absprung, ein Fünftel der
 * Szene als Vorlauf. Nachgebildet und nicht aufgerufen, weil es sie im Code
 * nicht mehr gibt - sie ist kurz genug, dass der Vergleich nachvollziehbar
 * bleibt.
 */
function altesFenster(takeoffMs: number, landingMs: number, durationMs: number) {
  const wanted = (landingMs - takeoffMs) / 1000 + 0.55;
  const seconds = Math.min(1.8, Math.max(0.7, wanted));
  let startMs = takeoffMs - seconds * 1000 * 0.2;
  startMs = Math.max(0, Math.min(startMs, durationMs - seconds * 1000));
  return { startMs: Math.round(Math.max(0, startMs)), seconds: Math.round(seconds * 100) / 100 };
}

function zeige(titel: string, f: { startMs: number; seconds: number }) {
  const ende = f.startMs + Math.round(f.seconds * 1000);
  console.log(`      ${titel}: ${f.startMs}-${ende} ms (${f.seconds}s)`);
}

console.log("1. Der lange Trick - Anlauf, Klettern, dann der Salto");
// Ein Clip, wie er wirklich vorkommt: 12 s lang, die Bewegung beginnt nach
// 2 s, dauert 3,2 s, und der Salto selbst liegt kurz vor der Landung.
const LANG = { takeoff: 2000, landing: 5200, peak: 4800, dauer: 12_000 };

const alt = altesFenster(LANG.takeoff, LANG.landing, LANG.dauer);
const neu = viralSceneWindow({
  highlightStartMs: LANG.takeoff,
  highlightEndMs: LANG.landing,
  peakMs: LANG.peak,
  startMs: null,
  endMs: null,
  durationMs: LANG.dauer,
});
zeige("alt (ab Absprung)   ", alt);
zeige("neu (um den Höhepunkt)", neu);
console.log(`      Höhepunkt liegt bei ${LANG.peak} ms`);

const altEnde = alt.startMs + Math.round(alt.seconds * 1000);
const neuEnde = neu.startMs + Math.round(neu.seconds * 1000);

pruefe("alt: der Höhepunkt fehlte im Schnitt", altEnde >= LANG.peak, false);
pruefe("neu: der Höhepunkt ist drin", neu.startMs <= LANG.peak && neuEnde >= LANG.peak, true);
pruefe("neu: die Landung ist drin", neuEnde >= LANG.landing, true);
pruefe("neu: die Szene bleibt gleich lang", neu.seconds, alt.seconds);

console.log("\n2. Der kurze Trick ändert sich nicht");
// Passt der ganze Trick in eine Einstellung, gibt es nichts zu entscheiden -
// und das bisherige Verhalten ist an echten Clips geprüft. Es bleibt.
const KURZ = { takeoff: 2400, landing: 3100, peak: 2800, dauer: 4900 };
const kurzAlt = altesFenster(KURZ.takeoff, KURZ.landing, KURZ.dauer);
const kurzNeu = viralSceneWindow({
  highlightStartMs: KURZ.takeoff,
  highlightEndMs: KURZ.landing,
  peakMs: KURZ.peak,
  startMs: null,
  endMs: null,
  durationMs: KURZ.dauer,
});
zeige("alt", kurzAlt);
zeige("neu", kurzNeu);
pruefe("Schnitt unverändert", kurzNeu, kurzAlt);

console.log("\n3. Ohne Höhepunkt bleibt alles beim Alten");
// Das ist der Zustand der ganzen Bibliothek, bis die Neuanalyse durch ist.
const ohnePeak = viralSceneWindow({
  highlightStartMs: LANG.takeoff,
  highlightEndMs: LANG.landing,
  peakMs: null,
  startMs: null,
  endMs: null,
  durationMs: LANG.dauer,
});
pruefe("alte Clips schneiden wie bisher", ohnePeak, alt);

// Ein Höhepunkt ausserhalb des Trickfensters ist keiner - dann lieber die
// bewährte Rechnung als ein Schnitt an einer beliebigen Stelle.
const unsinnigerPeak = viralSceneWindow({
  highlightStartMs: LANG.takeoff,
  highlightEndMs: LANG.landing,
  peakMs: 9000,
  startMs: null,
  endMs: null,
  durationMs: LANG.dauer,
});
pruefe("unplausibler Höhepunkt wird verworfen", unsinnigerPeak, alt);

console.log("\n4. Der Schnitt bleibt im Clip");
// Höhepunkt ganz am Ende eines kurzen Clips: das Fenster darf nicht über das
// Dateiende hinauslaufen.
const amRand = viralSceneWindow({
  highlightStartMs: 1000,
  highlightEndMs: 4500,
  peakMs: 4400,
  startMs: null,
  endMs: null,
  durationMs: 4600,
});
zeige("Höhepunkt kurz vor Schluss", amRand);
pruefe(
  "Ende innerhalb des Clips",
  amRand.startMs + Math.round(amRand.seconds * 1000) <= 4600,
  true,
);
pruefe("Anfang nicht negativ", amRand.startMs >= 0, true);

console.log("\n5. Die Auswahl liest, was zu sehen ist");
const basis = { id: "c1", stuntScore: 0.8, trickMs: 900 };
const mitFenster = kandidatenZeile({
  ...basis,
  description:
    "A group warms up in a gym, someone films with a phone, later a person vaults a box.",
  momentDescription: "A backflip off a concrete wall, landing cleanly on grass.",
});
const ohneFenster = kandidatenZeile({
  ...basis,
  description:
    "A group warms up in a gym, someone films with a phone, later a person vaults a box.",
});
console.log(`      mit Fenster:  ${mitFenster}`);
console.log(`      ohne Fenster: ${ohneFenster}`);
pruefe("das gezeigte Fenster steht in der Zeile", mitFenster.includes("backflip off a concrete wall"), true);
pruefe("das Aufwärmen steht nicht mehr drin", mitFenster.includes("warms up in a gym"), false);
pruefe(
  "ohne Fenster bleibt die lange Beschreibung",
  ohneFenster.includes("warms up in a gym"),
  true,
);

console.log("\n6. Der zweite Versionssprung hält die Videoerzeugung ebenfalls nicht an");
pruefe("Analyse-Version ist gestiegen", CURRENT_ANALYSIS_VERSION, 3);
pruefe("verwendbar bleibt schon Version 1", MIN_USABLE_ANALYSIS_VERSION, 1);
pruefe(
  "die Bibliothek von gestern bleibt wählbar",
  MIN_USABLE_ANALYSIS_VERSION < CURRENT_ANALYSIS_VERSION,
  true,
);

console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
