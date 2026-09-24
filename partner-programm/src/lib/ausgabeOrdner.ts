/**
 * Die von Hand gewählten Ausgabeordner - je Sparte und je Herkunft.
 *
 * Bisher stand der Zielordner im Code und in Umgebungsvariablen. Damit sich die
 * Posting-Routinen sauber trennen lassen, wählt der Nutzer die Ordner jetzt im
 * Dashboard: je Sparte einen für den Tageslauf und einen für die Handversuche.
 *
 * Wichtig ist die Rückwärtskompatibilität: fehlt eine Zeile, gilt weiterhin
 * der bisherige Standard. Die Einstellung ist ein Zusatz, kein Zwang - wer
 * nichts einträgt, bekommt genau das Verhalten von vorher.
 */
import { prisma } from "./db";
import { ordnerIdAus } from "./sourceFolders";
import { folderName } from "./drive";
import type { Track } from "./trackClient";

/**
 * Woher ein Video stammt - dieselbe Zweiteilung, die die Videoliste zeigt.
 *
 * "scheduled" ist der tägliche Lauf, "manual" alles im Dashboard oder per
 * Dialog Ausgelöste. Ein Auftrag trägt seine Herkunft im Feld origin; daraus
 * ergibt sich die Art hier eindeutig.
 */
export type AusgabeArt = "scheduled" | "manual";

export function artAusHerkunft(origin: string | null | undefined): AusgabeArt {
  return origin === "scheduled" ? "scheduled" : "manual";
}

export interface AusgabeOrdnerStand {
  folderId: string;
  folderName: string;
  folderUrl: string | null;
}

/** Beide Ordner einer Sparte - für die Anzeige im Dashboard. */
export async function ausgabeOrdnerDerSparte(
  track: Track,
): Promise<{ scheduled: AusgabeOrdnerStand | null; manual: AusgabeOrdnerStand | null }> {
  const zeilen = await prisma.ausgabeOrdner.findMany({ where: { track } });
  const finde = (kind: AusgabeArt): AusgabeOrdnerStand | null => {
    const z = zeilen.find((r) => r.kind === kind);
    return z ? { folderId: z.folderId, folderName: z.folderName, folderUrl: z.folderUrl } : null;
  };
  return { scheduled: finde("scheduled"), manual: finde("manual") };
}

/**
 * Die Überschreibung für die Pipeline: die eingestellte Ordner-ID oder null.
 *
 * null heisst ausdrücklich "nichts eingestellt" - dann bleibt es beim
 * bisherigen Standard. Der Aufrufer entscheidet, welcher das ist.
 */
export async function ausgabeOrdnerId(track: Track, art: AusgabeArt): Promise<string | null> {
  const zeile = await prisma.ausgabeOrdner.findUnique({
    where: { track_kind: { track, kind: art } },
  });
  return zeile?.folderId ?? null;
}

export interface SetzErgebnis {
  ok: boolean;
  fehler?: string;
  stand?: AusgabeOrdnerStand;
}

/**
 * Setzt oder entfernt einen Ausgabeordner.
 *
 * Leerer Link = entfernen: das ist die Art, zum bisherigen Standardordner
 * zurückzukehren. Sonst wird die ID aus dem Link gezogen; der angezeigte Name
 * kommt aus der Eingabe, sonst best-effort aus Drive, sonst bleibt er leer.
 *
 * Der Name wird NICHT erzwungen: das Dienstkonto liest nur Ordner, die für es
 * freigegeben sind, und ein Ausgabeordner muss das nicht sein. Ein fehlender
 * Name ist deshalb kein Fehler, nur eine fehlende Gedächtnisstütze.
 */
export async function setzeAusgabeOrdner(
  track: Track,
  art: AusgabeArt,
  eingabe: { url?: string | null; name?: string | null },
): Promise<SetzErgebnis> {
  const url = (eingabe.url ?? "").trim();

  if (!url) {
    await prisma.ausgabeOrdner
      .delete({ where: { track_kind: { track, kind: art } } })
      .catch(() => {});
    return { ok: true };
  }

  const folderId = ordnerIdAus(url);
  if (!folderId) {
    return {
      ok: false,
      fehler:
        "Kein Drive-Ordner-Link. Erwartet wird etwas wie " +
        "https://drive.google.com/drive/folders/…",
    };
  }

  // Der eingegebene Name gewinnt. Ohne Eingabe wird der Name aus Drive
  // versucht - klappt nur bei Freigabe fürs Dienstkonto, deshalb ohne Zwang.
  let name = (eingabe.name ?? "").trim();
  if (!name) {
    name = (await folderName(folderId).catch(() => "")) || "";
  }

  const stand = await prisma.ausgabeOrdner.upsert({
    where: { track_kind: { track, kind: art } },
    create: { track, kind: art, folderId, folderName: name, folderUrl: url },
    update: { folderId, folderName: name, folderUrl: url },
  });

  return {
    ok: true,
    stand: { folderId: stand.folderId, folderName: stand.folderName, folderUrl: stand.folderUrl },
  };
}
