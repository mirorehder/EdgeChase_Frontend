import { google, drive_v3 } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { env } from "./env";

// Video-MIME-Typen, auf die die Ordner-Abfrage beschränkt wird - der
// Quellordner könnte auch andere Dateien enthalten (Notizen, Vorschaubilder).
const VIDEO_MIME_QUERY = "mimeType contains 'video/'";

const FOLDER_MIME = "application/vnd.google-apps.folder";

// macOS legt beim Kopieren auf fremde Dateisysteme zu jeder Datei eine
// "AppleDouble"-Schattendatei "._name.mov" an. Drive meldet sie mit
// Video-MIME-Typ, sie enthält aber nur Metadaten (wenige KB) und kein Bild.
// Ungefiltert landet für jede davon ein wertloser Gemini-Analyselauf an.
const APPLE_DOUBLE_PREFIX = "._";

// Darunter kann keine echte Videodatei liegen; fängt zusätzlich abgebrochene
// oder noch laufende Uploads ab.
const MIN_VIDEO_BYTES = 100_000;

// Die beiden Sparten des Werkzeugs. Sie teilen sich nur die Technik: eigener
// Quellordner, eigene Bibliothek, eigener Zielordner. Der Typ selbst liegt in
// trackClient.ts, damit ihn auch die Oberfläche verwenden kann, ohne diese
// Datei (und mit ihr googleapis) mitzuziehen.
export { isTrack, TRACKS, type Track } from "./trackClient";
import type { Track } from "./trackClient";

/**
 * Wurzelordner der Sparte aus der Umgebung.
 *
 * Nur noch ein Rückfall: die Ordner stehen inzwischen in der Datenbank und
 * werden im Dashboard verwaltet. Die beiden neuen Sparten haben gar keinen
 * Eintrag in der Umgebung - für sie ist das hier leer, und ohne Ordner in der
 * Datenbank lesen sie schlicht nichts ein.
 */
function sourceFolderId(track: Track): string {
  if (track === "viral") return env.driveViralFolderId;
  if (track === "promo") return env.driveSourceFolderId;
  return "";
}

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;

  const credentials = JSON.parse(env.googleServiceAccountJson);
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    // Nur lesend: Schreiben scheitert am fehlenden Speicherkontingent von
    // Dienstkonten und läuft deshalb über OAuth (siehe unten).
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return cachedAuth;
}

function getDriveClient(): drive_v3.Drive {
  return google.drive({ version: "v3", auth: getAuth() });
}

export interface DriveClipFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  createdTime: string | null;
  /** Aus Drives videoMediaMetadata - zuverlässiger als eine Gemini-Schätzung. */
  durationMs: number | null;
  /** Ordner, in dem der Clip liegt. Der Name ist ein inhaltliches Signal
   *  ("Parkour-Bangers" vs. "Trainings-Clips") und geht in die Auswahl ein. */
  folderId: string;
  folderName: string;
  /** Der im Dashboard verwaltete Wurzelordner, unter dem die Datei gefunden
   *  wurde. Danach gruppiert die Bibliothek - der unmittelbare Ordner darüber
   *  kann ein Unterordner sein, der im Dashboard gar nicht auftaucht. */
  rootFolderId: string;
  rootFolderName: string;
}

/** Ein Quellordner, so wie ihn der Abgleich braucht. */
export interface SourceRoot {
  driveFolderId: string;
  /** Leer heisst: Namen aus Drive holen. */
  name?: string;
}

/** Schutz gegen Endlosschleifen durch Verknüpfungen und gegen versehentlich
 *  riesige Ordnerbäume. */
const MAX_FOLDER_DEPTH = 6;

function excludedFolderNames(): Set<string> {
  const raw = process.env.DRIVE_EXCLUDED_FOLDER_NAMES;
  const names = raw
    ? raw.split(",").map((n) => n.trim()).filter(Boolean)
    : // "Referenz-Videos" enthält fremdes Material zur Inspiration - das darf
      // nie in einem eigenen Werbevideo landen. "Logos etc." enthält kein
      // Bewegtbild, das Werbewert hätte.
      ["Referenz-Videos", "Logos etc."];
  return new Set(names.map((n) => n.toLowerCase()));
}

/** Listet ein einzelnes Ordner-Level (Videos und Unterordner). */
async function listFolderEntries(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<{ videos: drive_v3.Schema$File[]; subfolders: drive_v3.Schema$File[] }> {
  const videos: drive_v3.Schema$File[] = [];
  const subfolders: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (${VIDEO_MIME_QUERY} or mimeType = '${FOLDER_MIME}')`,
      fields:
        "nextPageToken, files(id, name, mimeType, size, createdTime, videoMediaMetadata(durationMillis))",
      pageSize: 200,
      pageToken,
    });

    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      if (f.mimeType === FOLDER_MIME) subfolders.push(f);
      else videos.push(f);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { videos, subfolders };
}

/**
 * Das Vorschaubild einer Datei, wie Drive es selbst erzeugt.
 *
 * Der Umweg über den Server ist nötig: Drive liefert zwar zu jedem Video einen
 * thumbnailLink, aber der ist ohne Zugangstoken nicht abrufbar. Ein
 * <img src="..."> direkt auf diese Adresse bekäme im Browser eine 403 - das
 * Bild muss hier mit den Rechten des Dienstkontos geholt und weitergereicht
 * werden.
 *
 * Null, wenn Drive für die Datei kein Vorschaubild hat: bei frisch
 * hochgeladenen Videos dauert das eine Weile.
 */
export async function fileThumbnail(
  fileId: string,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const drive = getDriveClient();

  const meta = await drive.files.get({ fileId, fields: "thumbnailLink" });
  const link = meta.data.thumbnailLink;
  if (!link) return null;

  // Drive liefert standardmässig ein sehr kleines Bild. Die Grösse steckt als
  // "=s220" am Ende der Adresse und lässt sich hochsetzen.
  const grosse = link.replace(/=s\d+(-c)?$/, "=s480");

  const token = await getAuth().getAccessToken();
  const res = await fetch(grosse, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;

  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "image/jpeg",
  };
}

/** Der Name eines Ordners in Drive. Leer, wenn er sich nicht lesen lässt. */
export async function folderName(folderId: string): Promise<string> {
  try {
    const meta = await getDriveClient().files.get({ fileId: folderId, fields: "name" });
    return meta.data.name ?? "";
  } catch {
    // Ein unlesbarer Ordner - falsche ID, fehlende Freigabe - darf den
    // Abgleich nicht zu Fall bringen.
    return "";
  }
}

/**
 * Listet alle Video-Dateien unterhalb der Quellordner - rekursiv über alle
 * Unterordner, damit das gesamte Material zur Verfügung steht und die Auswahl
 * anhand des Ordnernamens den passenden Kontext wählen kann.
 *
 * Mehrere Wurzelordner statt einem: die Parkour-Sparte verteilt sich auf
 * mehrere Ordner in Drive, und welche davon mitlaufen, steht im Dashboard.
 * Ohne Angabe gilt der Ordner aus der Umgebung - so bleibt die Promo-Sparte,
 * wie sie war.
 *
 * Die Zielordner werden dabei übersprungen: sie könnten von Hand in den
 * Quellbaum verschoben werden, und die dort abgelegten fertigen Videos dürfen
 * nicht als Rohmaterial für das nächste Video wieder eingelesen werden.
 */
export async function listSourceClips(
  track: Track = "promo",
  roots?: SourceRoot[],
  /** Wurzelordner der anderen Sparten - beim Absteigen ausgelassen, damit die
   *  Sparten nie ineinanderlaufen, wenn jemand die Ordner in Drive
   *  ineinanderschiebt. */
  fremdeWurzeln: string[] = [],
): Promise<DriveClipFile[]> {
  const drive = getDriveClient();
  const excluded = excludedFolderNames();

  const ausDerUmgebung = sourceFolderId(track);
  const wurzeln: SourceRoot[] = roots?.length
    ? roots
    : ausDerUmgebung
      ? [{ driveFolderId: ausDerUmgebung }]
      : [];

  // Keine Ordner eingetragen heisst: nichts einzulesen. Ohne diese Abkürzung
  // liefe der Abgleich gegen eine leere Ordner-ID und Drive antwortete mit
  // einem Fehler statt mit einer leeren Liste.
  if (!wurzeln.length) return [];

  // Beim Absteigen wird jeder andere Wurzelordner ausgelassen: der der anderen
  // Sparte, damit Werbe- und Parkour-Material nie ineinanderlaufen, und die
  // übrigen Ordner dieser Sparte, damit ein Clip nicht doppelt auftaucht, wenn
  // jemand die Ordner in Drive ineinanderschiebt.
  const andereWurzeln = new Set<string>(fremdeWurzeln);
  for (const w of wurzeln) andereWurzeln.add(w.driveFolderId);
  // Der Ordner aus der Umgebung zählt weiterhin mit: die Promo-Sparte hat
  // keine Einträge in der Ordnertabelle und stünde sonst ungeschützt da.
  for (const t of ["promo", "viral", "sports", "clothing"] as Track[]) {
    if (t !== track) andereWurzeln.add(sourceFolderId(t));
  }

  const outputFolderNames = alleOutputFolderNames();

  const files: DriveClipFile[] = [];
  // Über alle Wurzeln hinweg: ein Ordner, der unter zwei Wurzeln hängt, wird
  // nur einmal eingelesen.
  const visited = new Set<string>();

  for (const wurzel of wurzeln) {
    // Den echten Namen holen, falls das Dashboard noch keinen hat. Clips, die
    // direkt in der Wurzel liegen, stünden sonst unter "(Quellordner)" - der
    // Ordnername ist aber genau das Themensignal, das die Auswahl braucht.
    const rootName =
      wurzel.name || (await folderName(wurzel.driveFolderId)) || "(Quellordner)";

    const queue: Array<{ id: string; name: string; depth: number }> = [
      { id: wurzel.driveFolderId, name: rootName, depth: 0 },
    ];

    while (queue.length) {
      const folder = queue.shift()!;
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);

      const { videos, subfolders } = await listFolderEntries(drive, folder.id);

      for (const f of videos) {
        if (f.name!.startsWith(APPLE_DOUBLE_PREFIX)) continue;
        if (f.size && Number(f.size) < MIN_VIDEO_BYTES) continue;
        files.push({
          id: f.id!,
          name: f.name!,
          mimeType: f.mimeType!,
          sizeBytes: f.size ? Number(f.size) : null,
          createdTime: f.createdTime ?? null,
          durationMs: f.videoMediaMetadata?.durationMillis
            ? Number(f.videoMediaMetadata.durationMillis)
            : null,
          folderId: folder.id,
          folderName: folder.name,
          rootFolderId: wurzel.driveFolderId,
          rootFolderName: rootName,
        });
      }

      if (folder.depth >= MAX_FOLDER_DEPTH) continue;
      for (const sub of subfolders) {
        if (andereWurzeln.has(sub.id!)) continue;
        if (outputFolderNames.has(sub.name!.toLowerCase())) continue;
        if (excluded.has(sub.name!.toLowerCase())) continue;
        queue.push({ id: sub.id!, name: sub.name!, depth: folder.depth + 1 });
      }
    }
  }

  return files;
}

/** Grösse einer Datei, ohne sie zu holen. */
export async function fileSize(fileId: string): Promise<number> {
  const res = await getDriveClient().files.get({ fileId, fields: "size" });
  return Number(res.data.size ?? 0);
}

/**
 * Lädt eine Datei auf die Platte statt in den Speicher.
 *
 * Der Weg über den Arbeitsspeicher trägt bei 4K-Material nicht: an einer
 * echten Datei gemessen belegte ein 388-MB-Clip nach dem Herunterladen 1346 MB
 * und nach dem Verpacken für Gemini 2123 MB - die Bibliothek hält die Daten
 * unterwegs mehrfach. Eine Serverless-Funktion hat so viel nicht, sie wird
 * vorher abgeräumt. Über die Platte bleibt der Verbrauch konstant.
 */
export async function downloadFileToPath(fileId: string, zielPfad: string): Promise<number> {
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const { stat } = await import("node:fs/promises");

  const drive = getDriveClient();
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });

  await pipeline(res.data as NodeJS.ReadableStream, createWriteStream(zielPfad));
  return (await stat(zielPfad)).size;
}

/** Lädt eine Datei komplett in den Speicher. Nur noch für kleine Dateien -
 *  für Rohclips gibt es downloadFileToPath. */
export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Schreiben: OAuth im Namen des Nutzers
//
// Dienstkonten haben kein Speicherkontingent. Eine Datei, die ein Dienstkonto
// anlegt, gehört ihm selbst - und ohne Kontingent scheitert das Anlegen, auch
// in einem Ordner mit Bearbeiter-Freigabe ("Service Accounts do not have
// storage quota"). Nur Shared Drives umgehen das, die es bei einem privaten
// Google-Konto nicht gibt. Der Upload läuft deshalb über OAuth im Namen des
// Nutzers; die fertigen Videos gehören damit ihm.
//
// Der Bereich bleibt bewusst auf drive.file beschränkt: er gilt bei Google als
// nicht sensibel, braucht daher keine Überprüfung, und der Zustimmungsbildschirm
// lässt sich sofort veröffentlichen - nur dann läuft das Refresh-Token nicht
// nach sieben Tagen ab.
// ---------------------------------------------------------------------------

let cachedOAuthDrive: drive_v3.Drive | null = null;

function getWriteClient(): drive_v3.Drive {
  if (cachedOAuthDrive) return cachedOAuthDrive;

  const client = new google.auth.OAuth2(
    env.googleOAuthClientId,
    env.googleOAuthClientSecret,
  );
  client.setCredentials({ refresh_token: env.googleOAuthRefreshToken });

  cachedOAuthDrive = google.drive({ version: "v3", auth: client });
  return cachedOAuthDrive;
}

/**
 * Übersetzt Googles "invalid_grant" in einen Satz, mit dem sich etwas anfangen
 * lässt.
 *
 * Google antwortet auf ein untaugliches Refresh-Token nur mit diesem einen
 * Wort. Im Dashboard stand dann "invalid_grant" - richtig, aber ohne jeden
 * Hinweis darauf, was zu tun ist. Der Fehler ist kein Programmfehler und geht
 * nicht von selbst weg: das Token muss neu geholt werden.
 */
export function istTokenFehler(fehler: unknown): boolean {
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  return /invalid_grant|invalid_token|unauthorized_client/i.test(text);
}

export const TOKEN_HINWEIS =
  "Der Drive-Zugang ist abgelaufen (invalid_grant). Das Refresh-Token gilt nicht mehr - " +
  "meistens, weil der OAuth-Zustimmungsbildschirm zurück auf 'Testmodus' steht (dann " +
  "verfällt es nach sieben Tagen) oder der Zugriff widerrufen wurde. Zu beheben: " +
  "Zustimmungsbildschirm auf 'In Produktion' setzen, mit scripts/oauth-url.ts ein neues " +
  "Token holen und als GOOGLE_OAUTH_REFRESH_TOKEN in Vercel hinterlegen.";

/**
 * Prüft, ob sich mit dem hinterlegten Refresh-Token ein Zugangstoken holen
 * lässt.
 *
 * Wird vor dem Render aufgerufen, nicht erst beim Hochladen. Sonst läuft erst
 * ein voller Lambda-Render durch - anderthalb Minuten Rechenzeit, die Geld
 * kosten -, und der Auftrag scheitert danach an einer Kleinigkeit, die schon
 * vorher feststand.
 */
export async function pruefeSchreibzugang(): Promise<void> {
  const client = new google.auth.OAuth2(
    env.googleOAuthClientId,
    env.googleOAuthClientSecret,
  );
  client.setCredentials({ refresh_token: env.googleOAuthRefreshToken });

  try {
    await client.getAccessToken();
  } catch (err) {
    if (istTokenFehler(err)) throw new Error(TOKEN_HINWEIS);
    throw err;
  }
}

const cachedOutputFolderIds = new Map<Track, string>();

/**
 * Name und ggf. festgenagelte ID des Zielordners je Sparte.
 *
 * Die beiden neuen Sparten haben keinen Ordner in Drive, den jemand von Hand
 * angelegt hätte - die Anwendung legt ihn selbst an, sobald das erste Video
 * fertig ist. Verschieben und umbenennen lässt er sich hinterher beliebig, die
 * Zuordnung läuft über die gemerkte ID.
 */
function outputFolderSettings(track: Track): { name: string; pinned: string | null } {
  switch (track) {
    case "viral":
      return { name: env.driveViralOutputFolderName, pinned: env.driveViralOutputFolderId };
    case "sports":
      return {
        name: process.env.DRIVE_SPORTS_OUTPUT_FOLDER_NAME || "EdgeChase Sports Reels",
        pinned: process.env.DRIVE_SPORTS_OUTPUT_FOLDER_ID || null,
      };
    case "clothing":
      return {
        name: process.env.DRIVE_CLOTHING_OUTPUT_FOLDER_NAME || "EdgeChase Clothing Reels",
        pinned: process.env.DRIVE_CLOTHING_OUTPUT_FOLDER_ID || null,
      };
    default:
      return { name: env.driveOutputFolderName, pinned: env.driveOutputFolderId };
  }
}

/** Alle Zielordnernamen - sie dürfen beim Einlesen nicht als Quelle auftauchen. */
function alleOutputFolderNames(): Set<string> {
  return new Set(
    (["promo", "viral", "sports", "clothing"] as Track[])
      .map((t) => outputFolderSettings(t).name.toLowerCase()),
  );
}

/**
 * Liefert den Zielordner der Sparte und legt ihn an, falls er fehlt.
 *
 * Mit drive.file sieht die Anwendung ausschliesslich, was sie selbst angelegt
 * hat - ein von Hand erstellter Ordner wäre für sie unsichtbar und ein Upload
 * dorthin schlüge mit 404 fehl. Der Ordner muss deshalb von der Anwendung
 * selbst stammen. Verschieben lässt er sich hinterher trotzdem beliebig, die
 * Zuordnung läuft über die ID.
 */
export async function ensureOutputFolder(track: Track = "promo"): Promise<string> {
  const cached = cachedOutputFolderIds.get(track);
  if (cached) return cached;

  const { name, pinned } = outputFolderSettings(track);

  // Feste ID hat Vorrang: die Suche läuft sonst über den Namen, und ein
  // Umbenennen in Drive würde beim nächsten Lauf einen zweiten Ordner anlegen.
  if (pinned) {
    cachedOutputFolderIds.set(track, pinned);
    return pinned;
  }

  const drive = getWriteClient();
  const escaped = name.replace(/'/g, "\\'");

  const existing = await drive.files.list({
    q: `mimeType = '${FOLDER_MIME}' and trashed = false and name = '${escaped}'`,
    fields: "files(id)",
    pageSize: 1,
  });

  const found = existing.data.files?.[0]?.id;
  if (found) {
    cachedOutputFolderIds.set(track, found);
    return found;
  }

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME },
    fields: "id",
  });
  if (!created.data.id) {
    throw new Error("Zielordner konnte nicht angelegt werden.");
  }

  cachedOutputFolderIds.set(track, created.data.id);
  return created.data.id;
}

/**
 * Prüft, ob im Zielordner bereits eine Datei mit diesem Namen liegt -
 * Grundlage für den Duplikatschutz beim Retry. Dass drive.file nur die selbst
 * angelegten Dateien sichtbar macht, passt hier genau: gesucht wird ohnehin
 * nur nach eigenen Uploads.
 */
export async function findFileInOutputFolder(
  fileName: string,
  track: Track = "promo",
  folderIdOverride?: string | null,
  /**
   * Nur Dateien beruecksichtigen, die nach diesem Zeitpunkt entstanden sind.
   *
   * Seit die Dateinamen aus einem erfundenen Titel stammen, koennen zwei
   * verschiedene Videos denselben Namen treffen. Ohne diese Schranke haelt ein
   * Wiederholversuch das fremde Video faelschlich fuer sein eigenes und
   * verlinkt es. Was vor dem Start des Auftrags existierte, kann nicht von ihm
   * stammen.
   */
  notBefore?: Date | null,
): Promise<{ id: string; webViewLink: string | null } | null> {
  const drive = getWriteClient();
  const folderId = folderIdOverride || (await ensureOutputFolder(track));
  const escaped = fileName.replace(/'/g, "\\'");

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and name = '${escaped}'`,
    fields: "files(id, webViewLink, createdTime)",
    orderBy: "createdTime desc",
    pageSize: 5,
  });

  for (const file of res.data.files ?? []) {
    if (!file.id) continue;
    if (notBefore && file.createdTime && new Date(file.createdTime) < notBefore) continue;
    return { id: file.id, webViewLink: file.webViewLink ?? null };
  }
  return null;
}

/** Lädt eine fertige Videodatei in den Zielordner hoch. */
export async function uploadToOutputFolder(
  fileName: string,
  buffer: Buffer,
  track: Track = "promo",
  folderIdOverride?: string | null,
): Promise<{ id: string; webViewLink: string | null }> {
  const drive = getWriteClient();
  const folderId = folderIdOverride || (await ensureOutputFolder(track));

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: "video/mp4",
      body: bufferToStream(buffer),
    },
    fields: "id, webViewLink",
  });
  if (!res.data.id) {
    throw new Error("Drive-Upload lieferte keine Datei-ID zurück.");
  }
  return { id: res.data.id, webViewLink: res.data.webViewLink ?? null };
}

/**
 * Legt eine kleine JSON-Datei neben ein hochgeladenes Video.
 *
 * Damit findet die Posting-Routine den Sound, ohne selbst suchen zu müssen.
 * Absichtlich eine eigene Datei und kein Zusatz am Videonamen: der Dateiname
 * wird beim Posten zur Bildunterschrift, eine angehängte ID stünde also unter
 * dem Reel.
 */
export async function uploadSidecar(
  fileName: string,
  inhalt: unknown,
  track: Track = "promo",
  folderIdOverride?: string | null,
): Promise<string> {
  const drive = getWriteClient();
  const folderId = folderIdOverride || (await ensureOutputFolder(track));

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: {
      mimeType: "application/json",
      body: bufferToStream(Buffer.from(JSON.stringify(inhalt, null, 2), "utf8")),
    },
    fields: "id",
  });
  if (!res.data.id) throw new Error("Drive nahm die Sound-Beilage nicht an.");
  return res.data.id;
}

function bufferToStream(buffer: Buffer) {
  const { Readable } = require("node:stream") as typeof import("node:stream");
  return Readable.from(buffer);
}

/**
 * Upload mit Wiederholungen. Vor jedem erneuten Versuch wird geprüft, ob die
 * Datei durch einen vorherigen, scheinbar fehlgeschlagenen Versuch (z.B.
 * Timeout nach erfolgreichem Schreiben) bereits angekommen ist - sonst
 * entstehen Duplikate im Zielordner.
 */
export async function uploadToOutputFolderWithRetry(
  fileName: string,
  buffer: Buffer,
  track: Track = "promo",
  folderIdOverride?: string | null,
  notBefore?: Date | null,
  maxAttempts = 3,
): Promise<{ id: string; webViewLink: string | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const existing = await findFileInOutputFolder(fileName, track, folderIdOverride, notBefore);
      if (existing) return existing;

      const backoffMs = 2000 * 2 ** (attempt - 2); // 2s, 4s, ...
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    try {
      return await uploadToOutputFolder(fileName, buffer, track, folderIdOverride);
    } catch (err) {
      // Ein untauglicher Zugang wird durch Wiederholen nicht besser - im
      // Gegenteil, drei Versuche verschleiern nur, woran es liegt.
      if (istTokenFehler(err)) throw new Error(TOKEN_HINWEIS);
      lastError = err;
    }
  }

  throw new Error(
    `Upload nach ${maxAttempts} Versuchen fehlgeschlagen: ${String(lastError)}`,
  );
}
