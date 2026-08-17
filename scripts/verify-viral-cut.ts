/**
 * Weist an echten Parkour-Clips nach, dass der Schnitt den Trick trifft.
 *
 * Absprung und Landung werden hier von Hand vorgegeben (aus den Einzelbildern
 * abgelesen), damit die Prüfung unabhängig davon ist, was Gemini liefert:
 * geprüft wird die Schnittrechnung und der Render, nicht das Modell.
 */
import { writeFileSync } from "node:fs";
import { viralSceneWindow } from "../src/lib/pipeline";
import { renderPromoVideo } from "../src/lib/render";

interface Fall {
  name: string;
  driveFileId: string;
  durationMs: number;
  /** Aus den Einzelbildern abgelesen. */
  takeoffMs: number;
  landingMs: number;
}

const faelle: Fall[] = [
  {
    name: "IMG_6642.mov (Halle, Sprung über den Kasten)",
    driveFileId: "1-XCDRPYXd_ZIaU8Ew8US7qqGzBNSnObV",
    durationMs: 4000,
    takeoffMs: 2400,
    landingMs: 3100,
  },
  {
    name: "Backflip Pre 2.mov (Mauer, Rückwärtssalto)",
    driveFileId: "1kLfoRhp_8-kB0UNhF-Jy3yER0r4Ouk9u",
    durationMs: 4900,
    takeoffMs: 2700,
    landingMs: 2950,
  },
];

async function main() {
  const scenes = [];

  for (const fall of faelle) {
    const fenster = viralSceneWindow({
      highlightStartMs: fall.takeoffMs,
      highlightEndMs: fall.landingMs,
      startMs: null,
      endMs: null,
      durationMs: fall.durationMs,
    });

    const endMs = fenster.startMs + Math.round(fenster.seconds * 1000);
    console.log(
      `${fall.name}\n` +
        `  Trick laut Einzelbildern: ${fall.takeoffMs}-${fall.landingMs} ms\n` +
        `  Schnitt:                  ${fenster.startMs}-${endMs} ms (${fenster.seconds}s)\n` +
        `  Trick vollständig drin:   ${fenster.startMs <= fall.takeoffMs && endMs >= fall.landingMs ? "ja" : "NEIN"}\n` +
        `  Vorlauf ${fall.takeoffMs - fenster.startMs} ms, Nachlauf ${endMs - fall.landingMs} ms`,
    );

    scenes.push({
      clipId: fall.name,
      driveFileId: fall.driveFileId,
      startMs: fenster.startMs,
      endMs,
    });
  }

  if (process.argv.includes("--render")) {
    console.log("\nRender über Remotion Lambda ...");
    const started = Date.now();
    const buffer = await renderPromoVideo(
      "When mom tells me to stay away\nfrom the idiots out there but the\nenemy is closer than she thinks",
      scenes,
      "reference",
      1,
    );
    const out = process.env.OUT_PATH ?? "/tmp/viral-test.mp4";
    writeFileSync(out, buffer);
    console.log(
      `Fertig: ${(buffer.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${out}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
