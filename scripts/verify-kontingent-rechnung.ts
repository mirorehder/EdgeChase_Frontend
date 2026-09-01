/**
 * Rechnet nach, dass ein Render unter das AWS-Kontingent passt.
 *
 * Der Fehler aus dem Betrieb - "AWS Concurrency limit reached (Original
 * Error: Rate Exceeded.)" - kam nicht von einem Zufall, sondern von der
 * Arithmetik: acht Teilstücke plus die steuernde Funktion plus die
 * Fortschrittsabfrage sind genau die zehn gleichzeitigen Ausführungen, die
 * ein frisches AWS-Konto erlaubt. Ein Render lief damit ununterbrochen an der
 * Kante.
 *
 * Geprüft wird beides zugleich, weil die beiden Grenzen gegeneinander laufen:
 * wenige Teilstücke schonen das Kontingent, treiben aber die Bilder je Lambda
 * hoch - und ab etwa zwei 4K-Szenen bricht eine Lambda mit
 * "Runtime.TruncatedResponse" ab.
 *
 * Braucht weder Datenbank noch AWS: gerechnet wird die reine Aufteilung.
 */
import { framesPerLambdaFor, MAX_CHUNKS, SICHER_BIS_SEKUNDEN } from "../src/lib/render";

/**
 * Kontingent gleichzeitiger Lambda-Ausführungen.
 *
 * Nicht mehr die 10 eines frischen Kontos: das Kontingent ist inzwischen auf
 * den regulären AWS-Wert angehoben (Service Quotas -> AWS Lambda ->
 * "Concurrent executions", L-B99A9384, in eu-central-1).
 *
 * Absichtlich vorsichtig angesetzt: geprüft wird gegen 100, nicht gegen den
 * tatsächlichen Wert. Was gegen 100 hält, hält auch gegen 1000 - und sollte
 * das Kontingent je auf eine kleinere Erhöhung zurückfallen, schlägt dieser
 * Test an, statt dass es der Betrieb tut.
 */
const KONTINGENT = 100;

/** Die steuernde Funktion und die Fortschrittsabfrage laufen mit. */
const OVERHEAD = 2;

/** Ab so vielen Bildern je Lambda wurde "Runtime.TruncatedResponse" gemessen. */
const TRUNCATED_AB_BILDERN = 80;

const FPS = 30;

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)} (erwartet ${JSON.stringify(soll)})`,
  );
}

/**
 * Videolängen, wie sie im Betrieb wirklich vorkommen - dazu 40 und 60, um die
 * neue Obergrenze von beiden Seiten einzuklammern.
 */
const LAENGEN_SEKUNDEN = [8, 11, 13, 15, 18, 25, 40, 60];

console.log(
  `Deckel: ${MAX_CHUNKS} Teilstücke, Kontingent ${KONTINGENT}, Overhead ${OVERHEAD}, ` +
    `beide Grenzen zugleich bis ${SICHER_BIS_SEKUNDEN}s\n`,
);

for (const sekunden of LAENGEN_SEKUNDEN) {
  const bilder = Math.round(sekunden * FPS);
  const jeLambda = framesPerLambdaFor(bilder);
  const teilstuecke = Math.ceil(bilder / jeLambda);
  const gleichzeitig = teilstuecke + OVERHEAD;
  const szenen = jeLambda / FPS;

  console.log(
    `${String(sekunden).padStart(2)}s = ${String(bilder).padStart(3)} Bilder -> ` +
      `${teilstuecke} Teilstücke à ${jeLambda} Bilder (~${szenen.toFixed(1)} Sekunden Material), ` +
      `${gleichzeitig} gleichzeitige Aufrufe`,
  );

  // Das Kontingent ist die harte Grenze: wer sie sprengt, scheitert sofort
  // und immer. Sie muss deshalb bei JEDER Laenge halten.
  pruefe(`  ${sekunden}s passt ins Kontingent`, gleichzeitig <= KONTINGENT, true);

  // Die Speichergrenze gilt nur bis zur angesagten Laenge - darueber warnt
  // die Anwendung im Protokoll, statt still zu scheitern.
  if (sekunden <= SICHER_BIS_SEKUNDEN) {
    pruefe(`  ${sekunden}s bleibt unter der Speichergrenze`, jeLambda < TRUNCATED_AB_BILDERN, true);
  } else {
    console.log(`      (ueber ${SICHER_BIS_SEKUNDEN}s - die Anwendung warnt hier im Protokoll)`);
  }
}

console.log("\nZum Vergleich, warum es vorher klemmte (Kontingent 10):");
for (const [deckel, was] of [
  [8, "die ursprüngliche Einstellung"],
  [6, "die Notbremse danach"],
] as const) {
  const bilder = 20 * FPS;
  const jeLambda = Math.max(25, Math.ceil(bilder / deckel));
  const stuecke = Math.ceil(bilder / jeLambda);
  console.log(
    `  ${deckel} Teilstücke (${was}): 20s -> ${stuecke} + ${OVERHEAD} = ` +
      `${stuecke + OVERHEAD} Aufrufe, ${jeLambda} Bilder je Lambda` +
      // ">=", nicht ">": genau zehn ist kein Bestehen. AWS drosselt auch die
      // Rate, nicht nur die Zahl - an der Kante scheiterte es reihenweise.
      `${stuecke + OVERHEAD >= 10 ? " -> Kontingent ausgereizt" : ""}` +
      `${jeLambda >= TRUNCATED_AB_BILDERN ? " -> Speichergrenze gesprengt" : ""}`,
  );
}

console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
