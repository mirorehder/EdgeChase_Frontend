import { prisma } from "./db";

export interface DailySettings {
  hookText: string;
  textStyle: "banner" | "reference";
  clipCount: number;
  maxSecondsPerScene: number;
  themeHint: string;
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
  hookText: REFERENCE_HOOK_TEXT,
  textStyle: "reference",
  clipCount: 6,
  maxSecondsPerScene: 2.5,
  themeHint: "",
  enabled: true,
};

/** Liest die Vorgaben; fehlt die Zeile noch, gelten die Voreinstellungen. */
export async function getDailySettings(): Promise<DailySettings> {
  const row = await prisma.dailyConfig.findUnique({ where: { id: "default" } });
  if (!row) return DEFAULTS;

  return {
    hookText: row.hookText ?? "",
    textStyle: row.textStyle === "reference" ? "reference" : "banner",
    clipCount: row.clipCount,
    maxSecondsPerScene: row.maxSecondsPerScene,
    themeHint: row.themeHint ?? "",
    enabled: row.enabled,
  };
}

export async function saveDailySettings(patch: Partial<DailySettings>): Promise<DailySettings> {
  const current = await getDailySettings();
  const next: DailySettings = {
    hookText: patch.hookText ?? current.hookText,
    textStyle: patch.textStyle === "reference" ? "reference" : patch.textStyle === "banner" ? "banner" : current.textStyle,
    clipCount: Math.min(8, Math.max(2, Math.round(patch.clipCount ?? current.clipCount))),
    maxSecondsPerScene: Math.min(4, Math.max(1.5, patch.maxSecondsPerScene ?? current.maxSecondsPerScene)),
    themeHint: patch.themeHint ?? current.themeHint,
    enabled: patch.enabled ?? current.enabled,
  };

  await prisma.dailyConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...next, hookText: next.hookText || null, themeHint: next.themeHint || null },
    update: { ...next, hookText: next.hookText || null, themeHint: next.themeHint || null },
  });

  return next;
}
