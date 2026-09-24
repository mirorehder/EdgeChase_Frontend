/**
 * Weist den Fix für die Kleider-Sparte nach: fuelleSzenenNachBudget liefert
 * mindestens VIRAL_MIN_SCENES Einstellungen, sofern genug Kandidaten da sind -
 * auch bei langen Einstellungen und knapper Ziellänge.
 *
 * Der Fehler war: Kleider-Clips haben keine kurzen Trickfenster, ihre
 * Einstellungen sind ~1,8s lang. Bei knapper Ziellänge griff die Längenbremse
 * schon nach zwei Einstellungen, und der Edit fiel an der Mindestzahl (3) durch
 * - Tag für Tag "Zu wenige verwertbare Höhepunkte für einen Edit".
 *
 * Rein und ohne Netz/DB - genau der Kern, an dem es hing.
 */
import { fuelleSzenenNachBudget, type SzenenKandidat } from "../src/lib/pipeline";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

/** N Kandidaten gleicher Länge. */
function kandidaten(n: number, seconds: number): SzenenKandidat[] {
  return Array.from({ length: n }, (_, i) => ({
    clipId: `c${i}`,
    driveFileId: `d${i}`,
    startMs: 0,
    seconds,
  }));
}

console.log("1. Kleider-Fall: lange Szenen (1,8s), knappe Ziellänge (3s)");
// Vor dem Fix: Bremse nach 2 Szenen -> Edit fiel durch. Jetzt: min. 3.
const kleider = fuelleSzenenNachBudget(kandidaten(5, 1.8), 3);
pruefe("mindestens 3 Einstellungen trotz knapper Ziellänge", kleider.length, 3);
pruefe("endMs wird aus seconds berechnet", kleider[0].endMs, 1800);

console.log("\n2. Nach Erreichen der Mindestzahl greift die Längenbremse");
// 6 Kandidaten, aber nach 3 ist used=5,4 >= totalSeconds(3) -> Schluss bei 3.
pruefe("stoppt bei 3, wenn Ziellänge schon erreicht", fuelleSzenenNachBudget(kandidaten(6, 1.8), 3).length, 3);

console.log("\n3. Virale Sparte unverändert: kurze Szenen füllen bis zur Ziellänge");
// 0,9s-Szenen, Ziellänge 13s: füllt bis used>=13 -> ca. 15, aber nur 15 da.
const viral = fuelleSzenenNachBudget(kandidaten(15, 0.9), 13);
pruefe("füllt mehrere Einstellungen (>=3)", viral.length >= 3, true);
pruefe("hört nicht schon bei 3 auf (kurze Szenen)", viral.length > 3, true);

console.log("\n4. Ziellänge als Obergrenze, nicht Quote (nach Mindestzahl)");
// 10 Kandidaten 1,0s, Ziellänge 5s: min 3, dann bis used>=5 -> 5 Szenen.
pruefe("stoppt bei 5s Ziellänge nach 5 Szenen à 1s", fuelleSzenenNachBudget(kandidaten(10, 1.0), 5).length, 5);

console.log("\n5. Zu wenige Kandidaten: liefert, was da ist (Aufrufer wirft dann)");
pruefe("2 Kandidaten -> 2 Szenen (kein Zaubern)", fuelleSzenenNachBudget(kandidaten(2, 1.8), 3).length, 2);

console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
