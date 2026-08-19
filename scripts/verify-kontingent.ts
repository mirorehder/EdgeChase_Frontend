/**
 * Weist nach, wie ein Auftrag reagiert, wenn AWS den Render wegen seines
 * Kontingents abweist ("Concurrency limit reached / Rate Exceeded").
 *
 * Vorher wurde nicht unterschieden: drei Versuche in Folge, ohne Pause, alle
 * in dieselbe Wand - danach stand der Auftrag auf "fehlgeschlagen", obwohl gar
 * nichts kaputt war und das Gedränge Sekunden später vorbei gewesen wäre.
 *
 * Geprüft wird an den echten Fehlertexten, die AWS und Remotion liefern -
 * darunter wörtlich der aus dem Betrieb gemeldete.
 */
import { istKontingentFehler, kontingentEntscheidung } from "../src/lib/pipeline";

const STUNDE = 60 * 60 * 1000;

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)} (erwartet ${JSON.stringify(soll)})`);
}

console.log("1. Erkennung am echten Fehlertext");
const ausDemBetrieb =
  "Remotion-Lambda-Render fehlgeschlagen: Error: AWS Concurrency limit reached " +
  "(Original Error: Rate Exceeded.). See https://www.remotion.dev/docs/lambda/" +
  "troubleshooting/rate-limit for tips to fix this.";
pruefe("der gemeldete Fehler", istKontingentFehler(ausDemBetrieb), true);
pruefe("nackte AWS-Drosselung", istKontingentFehler("Rate Exceeded."), true);
pruefe("TooManyRequestsException", istKontingentFehler("TooManyRequestsException: ..."), true);
pruefe("ThrottlingException", istKontingentFehler("ThrottlingException"), true);

console.log("\n2. Andere Fehler bleiben andere Fehler");
pruefe(
  "der Speicherfehler von früher",
  istKontingentFehler("failed with error code Runtime.TruncatedResponse: undefined"),
  false,
);
pruefe("fehlende Variable", istKontingentFehler("Umgebungsvariable REMOTION_SERVE_URL fehlt."), false);
pruefe("Drive-Fehler", istKontingentFehler("File not found: 1abc"), false);

console.log("\n3. Frischer Auftrag: warten statt nachsetzen");
const frisch = new Date();
pruefe("nach Versuch 1", kontingentEntscheidung(1, frisch).warteMs, 30_000);
pruefe("nach Versuch 2", kontingentEntscheidung(2, frisch).warteMs, 60_000);
pruefe("Status zwischendurch", kontingentEntscheidung(1, frisch).status, "queued");

console.log("\n4. Alle Versuche verbraucht");
pruefe("kein weiteres Warten", kontingentEntscheidung(3, frisch).warteMs, null);
pruefe(
  "bleibt in der Warteschlange, statt aufzugeben",
  kontingentEntscheidung(3, frisch).status,
  "queued",
);

console.log("\n5. Seit Stunden am Kontingent");
const alt = new Date(Date.now() - 3 * STUNDE);
pruefe("wird aufgegeben", kontingentEntscheidung(3, alt).status, "failed");
pruefe(
  "knapp innerhalb der Geduld noch nicht",
  kontingentEntscheidung(3, new Date(Date.now() - 1.9 * STUNDE)).status,
  "queued",
);

console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
