// Prüft mitDbWiederholung ohne Datenbank: Wiederholung bei Verbindungsfehlern,
// sofortiges Durchreichen aller anderen Fehler, Aufgeben nach der Obergrenze.
import { mitDbWiederholung } from "../src/lib/db";

class PrismaClientInitializationError extends Error {
  name = "PrismaClientInitializationError";
}

let fehler = 0;
function pruefe(name: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`${ok ? "OK " : "FEHLER"} ${name}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`);
}
const ohnePause = async () => {};

async function main() {
  let n = 0;
  const r1 = await mitDbWiederholung(async () => {
    n++;
    if (n < 3) throw new PrismaClientInitializationError("Can't reach database server");
    return "ok";
  }, { schlaf: ohnePause });
  pruefe("gelingt im dritten Versuch", [r1, n], ["ok", 3]);

  let m = 0;
  const r2 = await mitDbWiederholung(async () => {
    m++;
    throw new PrismaClientInitializationError("immer weg");
  }, { schlaf: ohnePause }).catch((e) => e.message);
  pruefe("gibt nach 3 Versuchen auf", [r2, m], ["immer weg", 3]);

  let k = 0;
  const r3 = await mitDbWiederholung(async () => {
    k++;
    throw new Error("Unique constraint");
  }, { schlaf: ohnePause }).catch((e) => e.message);
  pruefe("andere Fehler sofort durch", [r3, k], ["Unique constraint", 1]);

  process.exit(fehler ? 1 : 0);
}
main();
