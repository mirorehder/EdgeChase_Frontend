/**
 * Weist nach, dass ein Auftrag nicht mehr auf "wartet" stehen bleibt, wenn der
 * Anstoss in der Kette verloren geht.
 *
 * Der Fall aus dem Betrieb: der Zeitplan rendert das Werbevideo noch selbst,
 * legt danach den Parkour-Edit an - und wird an Vercels 300-Sekunden-Grenze
 * abgeschnitten, bevor er ihn anstossen kann. Der Edit blieb dann bis zum
 * Folgetag liegen.
 *
 * Geprüft wird gegen eine echte Datenbank und einen echten HTTP-Server, der
 * die Render-Route vertritt und mitschreibt, welcher Auftrag angestossen wird.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../src/lib/db";
import { starteWartende, weckeWartende } from "../src/lib/dispatch";
import { nextQueuedJobId } from "../src/lib/pipeline";

const MINUTE = 60 * 1000;

/** Ein Server anstelle der Render-Route: er merkt sich nur die Anstösse. */
function anstossServer() {
  const empfangen: string[] = [];
  const server = createServer((req, res) => {
    const treffer = /\/api\/jobs\/([^/]+)\/process/.exec(req.url ?? "");
    if (treffer) empfangen.push(treffer[1]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  return { empfangen, server };
}

async function auftrag(
  name: string,
  track: "promo" | "viral",
  status: string,
  altersMinuten: number,
  claimedVorMinuten?: number,
) {
  return prisma.promoVideo.create({
    data: {
      track,
      hookText: name,
      scenes: [],
      status,
      createdAt: new Date(Date.now() - altersMinuten * MINUTE),
      claimedAt:
        claimedVorMinuten === undefined ? null : new Date(Date.now() - claimedVorMinuten * MINUTE),
    },
  });
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  const { empfangen, server } = anstossServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  let fehler = 0;
  const pruefe = (frage: string, ist: unknown, soll: unknown) => {
    const ok = ist === soll;
    if (!ok) fehler++;
    console.log(`${ok ? "OK  " : "FEHL"}  ${frage}: ${ist} (erwartet ${soll})`);
  };

  // 1. Reihenfolge über beide Sparten hinweg -----------------------------
  await prisma.promoVideo.deleteMany({});
  const promo = await auftrag("Werbevideo", "promo", "queued", 20);
  const edit = await auftrag("Parkour-Edit", "viral", "queued", 10);

  console.log("\n1. Der nächste wartende Auftrag, ohne Sparte gefragt");
  pruefe("ältester zuerst", await nextQueuedJobId(), promo.id);
  pruefe("virale Sparte gezielt", await nextQueuedJobId("viral"), edit.id);

  // 2. Verlorener Anstoss: der Edit wartet, nichts rendert ----------------
  await prisma.promoVideo.update({ where: { id: promo.id }, data: { status: "done" } });

  console.log("\n2. Der Edit wartet seit 10 Minuten, nichts rendert");
  empfangen.length = 0;
  pruefe("Wächter stösst ihn an", await weckeWartende(baseUrl), edit.id);
  pruefe("Anstoss ist wirklich angekommen", empfangen[0], edit.id);

  // 3. Während ein Render läuft, greift der Wächter nicht ein -------------
  await prisma.promoVideo.update({
    where: { id: promo.id },
    data: { status: "rendering", claimedAt: new Date() },
  });

  console.log("\n3. Ein Render läuft gerade");
  empfangen.length = 0;
  pruefe("Wächter hält sich zurück", await weckeWartende(baseUrl), null);
  pruefe("kein Anstoss abgeschickt", empfangen.length, 0);

  // 4. Ein hängengebliebener Render blockiert nicht für immer -------------
  await prisma.promoVideo.update({
    where: { id: promo.id },
    data: { claimedAt: new Date(Date.now() - 11 * MINUTE) },
  });

  console.log("\n4. Der Render hängt seit 11 Minuten (Ausführung längst tot)");
  empfangen.length = 0;
  // Der Hänger selbst kommt dran, nicht der Wartende hinter ihm: er ist der
  // ältere Auftrag, und sein Status stimmt nicht mehr mit der Wirklichkeit
  // überein.
  pruefe("Wächter belebt den Hänger", await weckeWartende(baseUrl), promo.id);

  // 5. Ein frischer Auftrag wird nicht sofort doppelt angestossen ---------
  await prisma.promoVideo.deleteMany({});
  const frisch = await auftrag("Gerade angelegt", "viral", "queued", 0);

  console.log("\n5. Ein Auftrag, der gerade erst angelegt wurde");
  empfangen.length = 0;
  pruefe("Wächter wartet ab", await weckeWartende(baseUrl), null);
  pruefe("Zeitplan stösst ihn sofort an", await starteWartende(baseUrl), frisch.id);
  pruefe("Anstoss ist angekommen", empfangen[0], frisch.id);

  // 6. Ein Render, dessen Ausführung mitten drin abgeschnitten wurde -------
  // Das war die Lücke: der Auftrag steht auf "rendert", niemand rendert ihn,
  // und weil der Wächter nur nach "wartet" suchte, blieb er für immer so.
  await prisma.promoVideo.deleteMany({});
  const abgeschnitten = await auftrag("Abgeschnitten", "viral", "rendering", 30, 12);
  const dahinter = await auftrag("Wartet dahinter", "promo", "queued", 20);

  console.log("\n6. Ein Render hängt seit 12 Minuten, ein weiterer Auftrag wartet");
  empfangen.length = 0;
  pruefe("der Hänger kommt zuerst dran", await weckeWartende(baseUrl), abgeschnitten.id);
  pruefe("Anstoss ist angekommen", empfangen[0], abgeschnitten.id);

  // 7. Aussichtslose Fälle werden nicht ewig wiederholt --------------------
  await prisma.promoVideo.update({
    where: { id: abgeschnitten.id },
    data: { createdAt: new Date(Date.now() - 150 * MINUTE) },
  });

  console.log("\n7. Derselbe Hänger, aber seit zweieinhalb Stunden");
  empfangen.length = 0;
  pruefe("stattdessen kommt der Wartende dran", await weckeWartende(baseUrl), dahinter.id);
  const aufgegeben = await prisma.promoVideo.findUnique({ where: { id: abgeschnitten.id } });
  pruefe("der Hänger ist als fehlgeschlagen vermerkt", aufgegeben?.status, "failed");
  pruefe(
    "mit einer Begründung",
    (aufgegeben?.lastError ?? "").includes("300-Sekunden-Grenze"),
    true,
  );

  server.close();
  await prisma.$disconnect();

  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
