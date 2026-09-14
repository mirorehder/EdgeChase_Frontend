import { prisma } from "./db";

export type TextQuelle = "ki" | "eigene";

export interface DailySettings {
  /** Woher der Video-Text (Overlay) kommt. */
  hookMode: TextQuelle;
  /** Eigene Overlay-Texte, reihum gewählt (jeder Eintrag darf mehrzeilig sein). */
  hookTexts: string[];
  /** Rotationszeiger für die Overlay-Texte. */
  hookIndex: number;
  /** Woher die Instagram-Bildunterschrift kommt. */
  captionMode: TextQuelle;
  /** Eigene Bildunterschriften, reihum gewählt. */
  captions: string[];
  /** Rotationszeiger für die Bildunterschriften. */
  captionIndex: number;
  textStyle: "banner" | "reference";
  clipCount: number;
  maxSecondsPerScene: number;
  themeHint: string;
  videoVolume: number;
  enabled: boolean;
}

// Ausgangszustand: der Text und die Gestaltung aus dem Referenzvideo, das der
// Nutzer vorgegeben hat. Die Zeilenumbrüche sind gesetzt und werden vom
// Overlay übernommen.
export const REFERENCE_HOOK_TEXT = [
  "Brand so small",
  "the first 30 people",
  "who comment their",
  "name will get a custom",
  "discount code with",
  "their name in it",
].join("\n");

const DEFAULTS: DailySettings = {
  hookMode: "eigene",
  hookTexts: [REFERENCE_HOOK_TEXT],
  hookIndex: 0,
  captionMode: "ki",
  captions: [],
  captionIndex: 0,
  textStyle: "reference",
  clipCount: 6,
  maxSecondsPerScene: 2.5,
  themeHint: "",
  videoVolume: 1,
  enabled: true,
};

/** Eine JSON-Liste aus der Datenbank zu sauberen, nicht-leeren Zeichenketten. */
function textListe(rohes: unknown): string[] {
  if (!Array.isArray(rohes)) return [];
  return rohes.map((x) => String(x).trim()).filter(Boolean);
}

function quelle(wert: unknown, standard: TextQuelle): TextQuelle {
  return wert === "eigene" ? "eigene" : wert === "ki" ? "ki" : standard;
}

/**
 * Wählt reihum den nächsten Eintrag einer Liste und gibt den Zeiger für das
 * nächste Mal zurück. Rein und damit prüfbar - die Rotation ist der Kern des
 * Features "eigene Captions".
 */
export function waehleRotierend(liste: string[], index: number): { wert: string; naechsterIndex: number } {
  const n = liste.length;
  const i = ((index % n) + n) % n; // auch bei negativem oder zu grossem Index sicher
  return { wert: liste[i], naechsterIndex: (i + 1) % n };
}

/** Liest die Vorgaben; fehlt die Zeile noch, gelten die Voreinstellungen. */
export async function getDailySettings(): Promise<DailySettings> {
  const row = await prisma.dailyConfig.findUnique({ where: { id: "default" } });
  if (!row) return DEFAULTS;

  return {
    hookMode: quelle(row.hookMode, "ki"),
    hookTexts: textListe(row.hookTexts),
    hookIndex: row.hookIndex ?? 0,
    captionMode: quelle(row.captionMode, "ki"),
    captions: textListe(row.captions),
    captionIndex: row.captionIndex ?? 0,
    textStyle: row.textStyle === "reference" ? "reference" : "banner",
    clipCount: row.clipCount,
    maxSecondsPerScene: row.maxSecondsPerScene,
    themeHint: row.themeHint ?? "",
    videoVolume: row.videoVolume,
    enabled: row.enabled,
  };
}

export async function saveDailySettings(patch: Partial<DailySettings>): Promise<DailySettings> {
  const current = await getDailySettings();
  const next: DailySettings = {
    hookMode: quelle(patch.hookMode, current.hookMode),
    hookTexts: patch.hookTexts ? textListe(patch.hookTexts) : current.hookTexts,
    hookIndex: Math.max(0, Math.round(patch.hookIndex ?? current.hookIndex)),
    captionMode: quelle(patch.captionMode, current.captionMode),
    captions: patch.captions ? textListe(patch.captions) : current.captions,
    captionIndex: Math.max(0, Math.round(patch.captionIndex ?? current.captionIndex)),
    textStyle:
      patch.textStyle === "reference" ? "reference" : patch.textStyle === "banner" ? "banner" : current.textStyle,
    clipCount: Math.min(8, Math.max(2, Math.round(patch.clipCount ?? current.clipCount))),
    maxSecondsPerScene: Math.min(4, Math.max(1.5, patch.maxSecondsPerScene ?? current.maxSecondsPerScene)),
    themeHint: patch.themeHint ?? current.themeHint,
    videoVolume: Math.min(4, Math.max(0, patch.videoVolume ?? current.videoVolume)),
    enabled: patch.enabled ?? current.enabled,
  };

  // Prisma erwartet für Json-Felder InputJsonValue; eine string[]-Liste passt
  // strukturell, TypeScript sieht sie aber enger.
  const daten = {
    hookMode: next.hookMode,
    hookTexts: next.hookTexts as unknown as object,
    hookIndex: next.hookIndex,
    captionMode: next.captionMode,
    captions: next.captions as unknown as object,
    captionIndex: next.captionIndex,
    textStyle: next.textStyle,
    clipCount: next.clipCount,
    maxSecondsPerScene: next.maxSecondsPerScene,
    themeHint: next.themeHint || null,
    videoVolume: next.videoVolume,
    enabled: next.enabled,
  };

  await prisma.dailyConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...daten },
    update: daten,
  });

  return next;
}

/**
 * Schreibt nur die beiden Rotationszeiger fort - vom Tageslauf nach der Auswahl
 * aufgerufen, ohne die übrigen Einstellungen anzufassen.
 */
export async function merkeRotation(hookIndex: number, captionIndex: number): Promise<void> {
  await saveDailySettings({ hookIndex, captionIndex });
}
