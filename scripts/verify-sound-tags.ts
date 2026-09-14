/**
 * Weist die Stimmungs-/Genre-Tags für Sounds nach.
 *
 * Drei Ebenen, von rein zu angeschlossen:
 *  1. Die reine Rechenlogik (soundTags.ts): Schlüssel ableiten, Listen säubern,
 *     Eignung eines Sounds für eine Sparte.
 *  2. Die Wirkung beim Sound-Wählen (waehleSound): nur passende Pool-Sounds,
 *     und der Rückfall auf den ganzen Pool, wenn keiner passt (nie stumm).
 *  3. Die Routen: der globale Katalog (/api/sound-tags) und die Sparten-Auswahl
 *     samt Sound-Tags (/api/post-schedule) - gespeichert und sauber gelesen.
 *
 * Ebene 3 braucht eine lokale Datenbank und einen laufenden Server unter
 * BASIS_URL. Ebene 1 und 2 laufen ohne beides.
 */
import { prisma } from "../src/lib/db";
import {
  normalisiereTagKeys,
  passtZuSparte,
  tagKeyAus,
  STANDARD_SOUND_TAGS,
} from "../src/lib/soundTags";
import { passendeSounds, waehleSound } from "../src/lib/postAuto";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

async function main() {
  console.log("1. Reine Rechenlogik");
  pruefe("tagKeyAus: Umlaute/Sonderzeichen", tagKeyAus("Hip-Hop/Trap"), "hip-hop-trap");
  pruefe("tagKeyAus: Düster", tagKeyAus("Düster"), "duester");
  pruefe("normalisiere: dedupe + trim", normalisiereTagKeys([" a ", "a", "b", ""]), ["a", "b"]);
  pruefe(
    "normalisiere: nur erlaubte behalten (entfernter Tag fällt weg)",
    normalisiereTagKeys(["a", "weg", "b"], new Set(["a", "b"])),
    ["a", "b"],
  );

  // Eignung: keine Sparten-Tags → alles passt; kein Sound-Tag → passt (nicht
  // stillschweigend rausfallen); sonst mindestens ein gemeinsamer Tag.
  pruefe("Sparte ohne Wahl → alles passt", passtZuSparte(["episch"], []), true);
  pruefe("Sound ohne Tags → passt trotzdem", passtZuSparte([], ["episch"]), true);
  pruefe("Schnittmenge vorhanden → passt", passtZuSparte(["episch", "pop"], ["episch"]), true);
  pruefe("keine Schnittmenge → passt nicht", passtZuSparte(["pop"], ["episch"]), false);

  console.log("\n2. Sound-Wahl filtert nach Stimmung");
  const pool = [
    { audioId: "a", titel: "Aggro", tags: ["aggressiv"] },
    { audioId: "b", titel: "Sanft", tags: ["ruhig"] },
    { audioId: "c", titel: "Neu", tags: [] },
  ];
  pruefe(
    "passendeSounds: nur aggressiv (+ untagged c)",
    passendeSounds(pool, ["aggressiv"]).map((s) => s.audioId),
    ["a", "c"],
  );
  pruefe(
    "passendeSounds: keine Wahl → ganzer Pool",
    passendeSounds(pool, []).map((s) => s.audioId),
    ["a", "b", "c"],
  );
  pruefe(
    "passendeSounds: nichts passt → ganzer Pool (nie stumm)",
    passendeSounds([{ audioId: "a", titel: "", tags: ["pop"] }], ["episch"]).map((s) => s.audioId),
    ["a"],
  );

  // waehleSound zieht deterministisch (zufall=0 → erster Kandidat).
  const wahl = waehleSound({
    dateiName: "clip.mp4",
    konzeptSound: { audioId: null, status: "offen" },
    trendPool: pool,
    spartenTags: ["ruhig"],
    zufall: () => 0,
  });
  pruefe("waehleSound nimmt passenden Sound (ruhig → b)", wahl.audioId, "b");
  pruefe("waehleSound Herkunft pool", wahl.herkunft, "pool");

  const leer = waehleSound({
    dateiName: "clip.mp4",
    konzeptSound: { audioId: null, status: "offen" },
    trendPool: [],
    spartenTags: ["ruhig"],
  });
  pruefe("waehleSound ohne Pool → kein Sound", leer.grund, "kein Sound verfügbar");

  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    console.log("\n(Routen-Prüfung übersprungen: keine lokale DATABASE_URL.)");
    console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
    process.exit(fehler === 0 ? 0 : 1);
  }

  console.log("\n3a. Globaler Katalog: setzen und lesen, Schlüssel abgeleitet");
  const put = await fetch(`${BASIS}/api/sound-tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tags: [
        { label: "Episch", kind: "stimmung" },
        { label: "Hip-Hop/Trap", kind: "genre" },
        { label: "  ", kind: "stimmung" }, // leer → fällt weg
      ],
    }),
  });
  const gesetzt = await put.json();
  pruefe("zwei Tags gespeichert (leeres weg)", gesetzt.tags.length, 2);
  pruefe("Schlüssel aus Label abgeleitet", gesetzt.tags[1].key, "hip-hop-trap");

  console.log("\n3b. Sparten-Auswahl + Sound-Tags über /api/post-schedule");
  const putPlan = await fetch(`${BASIS}/api/post-schedule`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      track: "clothing",
      enabled: true,
      quelle: "scheduled",
      soundTags: ["episch", "weg-existiert-nicht"],
      trendSounds: [
        { link: "https://www.instagram.com/reels/audio/354553290259617/", titel: "X", tags: ["episch", "pop"] },
      ],
    }),
  });
  const plan = await putPlan.json();
  pruefe("Sparten-Tags gespeichert", plan.soundTags, ["episch", "weg-existiert-nicht"]);
  pruefe("Sound trägt seine Tags", plan.trendSounds?.[0]?.tags, ["episch", "pop"]);

  // Katalog auf den Standard zurücksetzen, damit der Lauf nichts hinterlässt.
  await fetch(`${BASIS}/api/sound-tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tags: STANDARD_SOUND_TAGS.map((t) => ({ key: t.key, label: t.label, kind: t.kind })),
    }),
  });

  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
