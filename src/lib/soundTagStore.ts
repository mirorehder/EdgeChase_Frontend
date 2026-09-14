/**
 * Lesen und Schreiben des globalen SoundTag-Katalogs.
 *
 * Getrennt von soundTags.ts (dort liegt der reine, netz- und datenbankfreie
 * Kern), damit die Oberfläche und die Prüf-Skripte die Rechenlogik nutzen
 * können, ohne Prisma zu laden. Hier ist die Schicht, die die Datenbank fragt.
 */
import { prisma } from "./db";
import { STANDARD_SOUND_TAGS, tagKeyAus, type SoundTagDef, type TagArt } from "./soundTags";

/**
 * Der Katalog, nach sortIndex geordnet. Ist die Tabelle leer (frisch
 * migriert und wieder geleert, oder ein Testlauf), gilt die Vorschlagsliste -
 * so steht dem Dashboard nie eine leere Auswahl gegenüber.
 */
export async function getSoundTagKatalog(): Promise<SoundTagDef[]> {
  const rows = await prisma.soundTag.findMany({ orderBy: [{ sortIndex: "asc" }, { label: "asc" }] });
  if (rows.length === 0) return STANDARD_SOUND_TAGS;
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    kind: r.kind === "genre" ? "genre" : "stimmung",
    sortIndex: r.sortIndex,
  }));
}

function art(wert: unknown): TagArt {
  return wert === "genre" ? "genre" : "stimmung";
}

/**
 * Ersetzt den Katalog vollständig durch die übergebenen Tags.
 *
 * Bewusst "ganz neu setzen" statt einzeln ändern: die Liste ist klein und
 * global, und die Oberfläche schickt ohnehin den ganzen Stand. Labels werden zu
 * eindeutigen Schlüsseln verdichtet; ein leeres Label fällt weg. Die
 * Reihenfolge der Eingabe wird zum sortIndex.
 *
 * Ein bestehender Schlüssel behält seine Identität (Sounds und Sparten, die ihn
 * referenzieren, bleiben gültig); ein entfernter verschwindet aus der Auswahl.
 */
export async function setSoundTagKatalog(
  eingabe: { key?: string; label?: string; kind?: string }[],
): Promise<SoundTagDef[]> {
  const gesehen = new Set<string>();
  const sauber: SoundTagDef[] = [];
  for (const e of Array.isArray(eingabe) ? eingabe : []) {
    const label = String(e?.label ?? "").trim();
    if (!label) continue;
    // Vorhandenen Schlüssel bewahren, sonst aus dem Label ableiten.
    const key = String(e?.key ?? "").trim() || tagKeyAus(label);
    if (!key || gesehen.has(key)) continue;
    gesehen.add(key);
    sauber.push({ key, label, kind: art(e?.kind), sortIndex: sauber.length });
  }

  await prisma.$transaction([
    prisma.soundTag.deleteMany({}),
    prisma.soundTag.createMany({ data: sauber }),
  ]);

  return sauber;
}
