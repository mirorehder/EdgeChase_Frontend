/**
 * Weist nach, dass ein fehlgeschlagener Auftrag wieder in die Warteschlange
 * zurückfindet.
 *
 * Vorher war er endgültig verloren: der Wächter greift nur nach wartenden
 * Aufträgen, und die Oberfläche bot keinen Weg zurück. Wer die Ursache behoben
 * hatte - ein erhöhtes AWS-Kontingent, ein erneuertes Drive-Token -, musste
 * das Video neu anlegen und verlor die Zusammenstellung, die schon
 * Gemini-Zeit gekostet hat.
 *
 * Geprüft wird gegen eine echte Datenbank und über echtes HTTP: ein
 * Ersatzserver nimmt die Stelle der Render-Route ein und schreibt mit, welcher
 * Auftrag angestossen wird.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../src/lib/db";
import { starteWartende } from "../src/lib/dispatch";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)} (erwartet ${JSON.stringify(soll)})`,
  );
}

async function auftrag(name: string, status: string, fehlertext: string | null) {
  return prisma.promoVideo.create({
    data: {
      track: "viral",
      hookText: name,
      scenes: [{ clipId: "c1", driveFileId: "d1", startMs: 0, endMs: 1000, seconds: 1 }],
      status,
      attempts: status === "failed" ? 3 : 0,
      lastError: fehlertext,
      fileTitle: name,
    },
  });
}

/** Dasselbe, was die Route tut - hier ohne Next, damit es prüfbar bleibt. */
async function wiederEinreihen(ids: string[]) {
  await prisma.promoVideo.updateMany({
    where: { id: { in: ids } },
    data: { status: "queued", lastError: null, attempts: 0, claimedAt: null },
  });
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  const empfangen: string[] = [];
  const server = createServer((req, res) => {
    const treffer = /\/api\/jobs\/([^/]+)\/process/.exec(req.url ?? "");
    if (treffer) empfangen.push(treffer[1]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await prisma.promoVideo.deleteMany({});

  const a = await auftrag("Erster", "failed", "AWS Concurrency limit reached");
  const b = await auftrag("Zweiter", "failed", "AWS Concurrency limit reached");
  const fertig = await auftrag("Schon fertig", "done", null);

  console.log("1. Ausgangslage");
  pruefe("nichts wartet", await prisma.promoVideo.count({ where: { status: "queued" } }), 0);
  empfangen.length = 0;
  pruefe("es gibt also auch nichts anzustossen", await starteWartende(baseUrl), null);

  console.log("\n2. Beide fehlgeschlagenen wieder einreihen");
  await wiederEinreihen([a.id, b.id]);
  pruefe("beide warten jetzt", await prisma.promoVideo.count({ where: { status: "queued" } }), 2);

  const nachher = await prisma.promoVideo.findUniqueOrThrow({ where: { id: a.id } });
  pruefe("die Fehlermeldung ist weg", nachher.lastError, null);
  pruefe("die Versuche sind zurueckgesetzt", nachher.attempts, 0);
  pruefe(
    "die Zusammenstellung bleibt erhalten",
    (nachher.scenes as unknown as unknown[]).length,
    1,
  );
  pruefe("der Dateiname bleibt derselbe", nachher.fileTitle, "Erster");

  console.log("\n3. Der erste geht sofort los, die Kette holt den zweiten");
  empfangen.length = 0;
  pruefe("angestossen wird der aeltere", await starteWartende(baseUrl), a.id);
  pruefe("und der Anstoss kommt an", empfangen[0], a.id);

  console.log("\n4. Ein fertiges Video wird nicht angefasst");
  const fertigNachher = await prisma.promoVideo.findUniqueOrThrow({ where: { id: fertig.id } });
  pruefe("bleibt fertig", fertigNachher.status, "done");

  server.close();
  await prisma.$disconnect();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
