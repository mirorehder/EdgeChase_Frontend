/**
 * Prueft die Kennzahlen-Aggregation gegen erfundene Eingaben.
 *
 * Ohne Live-API: die Aggregation ist reine Rechnung, sie darf getestet werden,
 * ohne Instagram oder Wix zu erreichen.
 */
import { fasseSparteZusammen } from "../src/lib/aggregation";
import type { MediaKennzahlen } from "../src/lib/instagram";
import type { GepostetesVideo } from "../src/lib/mapping";

let fehler = 0;
function pruefe(name: string, bedingung: boolean, extra?: string) {
  if (bedingung) {
    console.log(`  ok:   ${name}`);
  } else {
    console.log(`  FAIL: ${name}${extra ? ` (${extra})` : ""}`);
    fehler += 1;
  }
}

function video(id: string, mediaId: string, tag: string): GepostetesVideo {
  return {
    id,
    track: "promo",
    mediaId,
    postedAt: new Date(`${tag}T12:00:00Z`),
    hookText: `Hook ${id}`,
    fileTitle: `Titel ${id}`,
    origin: "scheduled",
    conceptId: null,
    publicUrl: null,
    driveUrl: null,
  };
}

function k(mediaId: string, x: Partial<MediaKennzahlen>): MediaKennzahlen {
  return {
    mediaId,
    reichweite: null,
    aufrufe: null,
    likes: null,
    kommentare: null,
    shares: null,
    saves: null,
    watchTimeMs: null,
    vorschau: null,
    gepostet: null,
    ...x,
  };
}

console.log("Aggregation: Grundfall");
{
  const videos = [
    video("a", "IG1", "2026-09-01"),
    video("b", "IG2", "2026-09-01"),
    video("c", "IG3", "2026-09-02"),
  ];
  const karte = new Map<string, MediaKennzahlen>([
    ["IG1", k("IG1", { reichweite: 1000, aufrufe: 1500, likes: 50, kommentare: 5, shares: 2, saves: 3 })],
    ["IG2", k("IG2", { reichweite: 2000, aufrufe: 3000, likes: 100, kommentare: 20, shares: 4, saves: 6 })],
    ["IG3", k("IG3", { reichweite: 500, aufrufe: 700, likes: 10, kommentare: 1, shares: 0, saves: 1 })],
  ]);
  const r = fasseSparteZusammen(videos, karte);
  pruefe("Summe Reichweite", r.summen.reichweite === 3500);
  pruefe("Summe Aufrufe", r.summen.aufrufe === 5200);
  pruefe("Summe Likes", r.summen.likes === 160);
  pruefe("Verlauf hat 2 Tage", r.verlauf.length === 2);
  pruefe(
    "Verlauf Tag 1 Reichweite",
    r.verlauf[0].reichweite === 3000,
    `war ${r.verlauf[0].reichweite}`,
  );
  pruefe(
    "Engagement-Rate",
    Math.abs((r.mittel.engagementRate ?? 0) - (160 + 26 + 6 + 10) / 3500) < 1e-9,
  );
  pruefe("Rangliste 3 Eintraege", r.top.length === 3);
  pruefe("Rangfuehrender ist IG2", r.top[0].mediaId === "IG2");
}

console.log("Aggregation: fehlende Kennzahlen zaehlen nicht in Durchschnitt");
{
  const videos = [
    video("a", "IG1", "2026-09-01"),
    video("b", "IG2", "2026-09-01"),
  ];
  const karte = new Map<string, MediaKennzahlen>([
    ["IG1", k("IG1", { aufrufe: 1000, reichweite: null })],
    ["IG2", k("IG2", { aufrufe: 2000, reichweite: 500 })],
  ]);
  const r = fasseSparteZusammen(videos, karte);
  pruefe(
    "Mittel Reichweite nur ueber 1 Video",
    r.mittel.reichweite === 500,
    `war ${r.mittel.reichweite}`,
  );
  pruefe(
    "Mittel Aufrufe ueber 2 Videos",
    r.mittel.aufrufe === 1500,
    `war ${r.mittel.aufrufe}`,
  );
  pruefe("mitDaten = 2", r.summen.mitDaten === 2);
}

console.log("Aggregation: leere Eingabe");
{
  const r = fasseSparteZusammen([], new Map());
  pruefe("keine Videos", r.summen.videos === 0);
  pruefe("kein Aufruf", r.summen.aufrufe === 0);
  pruefe("kein Mittel", r.mittel.aufrufe === null);
  pruefe("kein Top", r.top.length === 0);
}

process.exit(fehler > 0 ? 1 : 0);
