/**
 * Prüft die Zusammenstellung mehrphasiger Edits gegen eine echte Datenbank.
 *
 * Ohne Gemini-Schlüssel greifen die Ersatzwege (Reihenfolge und Aufbau-Clip
 * ohne Modell) - genau die sollen hier mitgeprüft werden, denn sie tragen den
 * Tageslauf, wenn das Modell ausfällt.
 */
import { prisma } from "../src/lib/db";
import { composeViralVideo, syncClipLibrary, type ComposedScene } from "../src/lib/pipeline";
import type { ConceptTextPhase } from "../src/lib/gemini";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await prisma.promoVideo.deleteMany({});
  await prisma.clip.deleteMany({});
  await syncClipLibrary("viral");

  // Bewertungen so setzen, dass es einen klar ruhigen Clip gibt: er muss für
  // die Eröffnung gewählt werden, obwohl er der schwächste ist.
  const clips = await prisma.clip.findMany({ where: { track: "viral" }, orderBy: { name: "asc" } });
  for (const [i, clip] of clips.entries()) {
    const ruhig = i === clips.length - 1;
    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        stuntScore: ruhig ? 0.05 : Math.round((0.95 - i * 0.02) * 100) / 100,
        description: ruhig
          ? "Person stands still at the edge of a wall, looking down, no trick"
          : `Backflip over a rail in location ${i}`,
        highlightStartMs: 2000,
        highlightEndMs: 2800,
        startMs: 1800,
        endMs: 3150,
        analysisVersion: 1,
      },
    });
  }
  const ruhigerClip = clips[clips.length - 1];
  console.log(`${clips.length} Clips bewertet. Ruhiger Clip: ${ruhigerClip.name} (0.05)\n`);

  const phasen: ConceptTextPhase[] = [
    {
      text: '"Bro aren\'t you sad that you\'re stupid\nand hella chopped"',
      seconds: 3.2,
      role: "setup",
      sceneHint: "person stands still at a wall, no trick",
    },
    { text: "Nah I can backflip", seconds: 9.4, role: "payoff", sceneHint: "fast montage of flips" },
  ];

  console.log("--- Mehrphasig ---");
  const mehr = await composeViralVideo("viral", {
    hookText: phasen[0].text,
    clipCount: 8,
    totalSeconds: 13,
    textPhases: phasen,
  });
  zeige(mehr.scenes, mehr.textPhases ?? [], clips, ruhigerClip.id);

  console.log("\n--- Einphasig (wie bisher) ---");
  const eins = await composeViralVideo("viral", {
    hookText: "Nur ein Text",
    clipCount: 8,
    totalSeconds: 13,
  });
  zeige(eins.scenes, eins.textPhases ?? [], clips, ruhigerClip.id);
}

function zeige(
  scenes: ComposedScene[],
  phasen: { text: string; startMs: number; durationMs: number }[],
  clips: { id: string; name: string }[],
  ruhigId: string,
) {
  const name = (id: string) => clips.find((c) => c.id === id)?.name ?? "?";
  console.log(`   Szenen (${scenes.length}):`);
  let t = 0;
  for (const [i, s] of scenes.entries()) {
    console.log(
      `     ${i === 0 ? "Eröffnung" : "Montage  "} ${(t / 1000).toFixed(1)}s +${s.seconds.toFixed(1)}s  ${name(s.clipId)}`,
    );
    t += s.seconds * 1000;
  }
  console.log(`   Gesamtlänge: ${(t / 1000).toFixed(1)}s`);
  console.log(`   Eröffnung ist der ruhige Clip: ${scenes[0].clipId === ruhigId ? "ja" : "NEIN"}`);

  console.log(`   Textphasen (${phasen.length}):`);
  for (const p of phasen) {
    console.log(
      `     ${(p.startMs / 1000).toFixed(1)}-${((p.startMs + p.durationMs) / 1000).toFixed(1)}s  ` +
        `"${p.text.replace(/\n/g, " ").slice(0, 45)}"`,
    );
  }

  const ende = phasen.length ? phasen[phasen.length - 1].startMs + phasen[phasen.length - 1].durationMs : 0;
  console.log(`   Text deckt das Video lückenlos ab: ${Math.abs(ende - t) < 60 ? "ja" : `NEIN (${ende} vs ${Math.round(t)})`}`);
  if (phasen.length > 1) {
    const schnitt = scenes[0].seconds * 1000;
    console.log(
      `   Wechsel liegt auf dem Schnitt: ${Math.abs(phasen[1].startMs - schnitt) < 60 ? "ja" : "NEIN"}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
