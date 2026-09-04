/**
 * Kennzahlen zu einer Sparte in einem Zeitraum zusammenfassen.
 *
 * Werte, die die Instagram-API nicht liefert (null), zaehlen NICHT mit -
 * sonst wuerden Durchschnitte kleiner erscheinen als sie sind. Was in eine
 * Summe eingegangen ist, steht in `mitDaten`; die Oberflaeche zeigt es an.
 */
import type { GepostetesVideo } from "./mapping";
import type { MediaKennzahlen } from "./instagram";

export interface SparteSummen {
  videos: number;
  mitDaten: number;
  aufrufe: number;
  reichweite: number;
  likes: number;
  kommentare: number;
  shares: number;
  saves: number;
}

export interface SparteMittel {
  aufrufe: number | null;
  reichweite: number | null;
  likes: number | null;
  kommentare: number | null;
  engagementRate: number | null;
}

export interface SparteZusammenfassung {
  summen: SparteSummen;
  mittel: SparteMittel;
  verlauf: Array<{ tag: string; aufrufe: number; reichweite: number }>;
  top: Array<{
    mediaId: string;
    hookText: string;
    fileTitle: string | null;
    reichweite: number | null;
    aufrufe: number | null;
    engagement: number | null;
  }>;
}

/**
 * Alles auf einmal - Summen, Mittelwerte, Verlauf je Tag, Rangliste nach
 * Engagement (Likes + Kommentare + Shares + Saves).
 */
export function fasseSparteZusammen(
  videos: GepostetesVideo[],
  kennzahlen: Map<string, MediaKennzahlen>,
): SparteZusammenfassung {
  const summen: SparteSummen = {
    videos: videos.length,
    mitDaten: 0,
    aufrufe: 0,
    reichweite: 0,
    likes: 0,
    kommentare: 0,
    shares: 0,
    saves: 0,
  };
  const verlaufMap = new Map<
    string,
    { aufrufe: number; reichweite: number }
  >();
  const rangliste: SparteZusammenfassung["top"] = [];
  let mitAufrufen = 0;
  let mitReichweite = 0;
  let mitLikes = 0;
  let mitKommentare = 0;

  for (const v of videos) {
    const k = kennzahlen.get(v.mediaId);
    if (!k) continue;
    const hatDaten =
      k.aufrufe != null ||
      k.reichweite != null ||
      k.likes != null ||
      k.kommentare != null;
    if (hatDaten) summen.mitDaten += 1;
    if (k.aufrufe != null) {
      summen.aufrufe += k.aufrufe;
      mitAufrufen += 1;
    }
    if (k.reichweite != null) {
      summen.reichweite += k.reichweite;
      mitReichweite += 1;
    }
    if (k.likes != null) {
      summen.likes += k.likes;
      mitLikes += 1;
    }
    if (k.kommentare != null) {
      summen.kommentare += k.kommentare;
      mitKommentare += 1;
    }
    if (k.shares != null) summen.shares += k.shares;
    if (k.saves != null) summen.saves += k.saves;

    const tag = v.postedAt.toISOString().slice(0, 10);
    const e = verlaufMap.get(tag) ?? { aufrufe: 0, reichweite: 0 };
    if (k.aufrufe != null) e.aufrufe += k.aufrufe;
    if (k.reichweite != null) e.reichweite += k.reichweite;
    verlaufMap.set(tag, e);

    const engagement =
      (k.likes ?? 0) +
      (k.kommentare ?? 0) +
      (k.shares ?? 0) +
      (k.saves ?? 0);
    rangliste.push({
      mediaId: v.mediaId,
      hookText: v.hookText,
      fileTitle: v.fileTitle,
      reichweite: k.reichweite,
      aufrufe: k.aufrufe,
      engagement: hatDaten ? engagement : null,
    });
  }

  const mittel: SparteMittel = {
    aufrufe: mitAufrufen ? summen.aufrufe / mitAufrufen : null,
    reichweite: mitReichweite ? summen.reichweite / mitReichweite : null,
    likes: mitLikes ? summen.likes / mitLikes : null,
    kommentare: mitKommentare ? summen.kommentare / mitKommentare : null,
    engagementRate:
      mitReichweite && summen.reichweite > 0
        ? (summen.likes + summen.kommentare + summen.shares + summen.saves) /
          summen.reichweite
        : null,
  };

  const verlauf = [...verlaufMap.entries()]
    .map(([tag, w]) => ({ tag, ...w }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  const top = rangliste
    .filter((r) => r.engagement != null)
    .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
    .slice(0, 10);

  return { summen, mittel, verlauf, top };
}
