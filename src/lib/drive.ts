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
 * Listet alle Video-Dateien unterhalb des Quellordners - rekursiv über alle
 * Unterordner, damit das gesamte Material zur Verfügung steht und die Auswahl
 * anhand des Ordnernamens den passenden Kontext wählen kann.
 *
 * Der Zielordner wird dabei übersprungen: er liegt selbst unterhalb des
 * Quellbaums, und die dort abgelegten fertigen Videos dürfen nicht als
 * Rohmaterial für das nächste Video wieder eingelesen werden.
 */
export async function listSourceClips(): Promise<DriveClipFile[]> {
  const drive = getDriveClient();
  const excluded = excludedFolderNames();
  // Der Zielordner liegt zwar ausserhalb des Quellbaums (die Anwendung legt
  // ihn selbst an), könnte aber von Hand dorthin verschoben werden. Wird er
  // über den Namen ausgeschlossen, kämen fertige Videos nicht als Rohmaterial
  // für das nächste Video zurück.
  const outputFolderName = env.driveOutputFolderName.toLowerCase();

  const files: DriveClipFile[] = [];
  const visited = new Set<string>();
  const queue: Array<{ id: string; name: string; depth: number }> = [
    { id: env.driveSourceFolderId, name: "(Quellordner)", depth: 0 },
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
      });
    }

    if (folder.depth >= MAX_FOLDER_DEPTH) continue;
    for (const sub of subfolders) {
      if (sub.name!.toLowerCase() === outputFolderName) continue;
      if (excluded.has(sub.name!.toLowerCase())) continue;
      queue.push({ id: sub.id!, name: sub.name!, depth: folder.depth + 1 });
    }
  }

  return files;
}

/** Lädt eine Datei komplett in den Speicher. Rohclips sind kurz (Sekunden), das bleibt unproblematisch. */
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

let cachedOutputFolderId: string | null = null;

/**
 * Liefert den Zielordner und legt ihn an, falls er fehlt.
 *
 * Mit drive.file sieht die Anwendung ausschliesslich, was sie selbst angelegt
 * hat - ein von Hand erstellter Ordner wäre für sie unsichtbar und ein Upload
 * dorthin schlüge mit 404 fehl. Der Ordner muss deshalb von der Anwendung
 * selbst stammen. Verschieben lässt er sich hinterher trotzdem beliebig, die
 * Zuordnung läuft über die ID.
 */
export async function ensureOutputFolder(): Promise<string> {
  if (cachedOutputFolderId) return cachedOutputFolderId;

  const drive = getWriteClient();
  const name = env.driveOutputFolderName;
  const escaped = name.replace(/'/g, "\\'");

  const existing = await drive.files.list({
    q: `mimeType = '${FOLDER_MIME}' and trashed = false and name = '${escaped}'`,
    fields: "files(id)",
    pageSize: 1,
  });

  const found = existing.data.files?.[0]?.id;
  if (found) {
    cachedOutputFolderId = found;
    return found;
  }

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME },
    fields: "id",
  });
  if (!created.data.id) {
    throw new Error("Zielordner konnte nicht angelegt werden.");
  }

  cachedOutputFolderId = created.data.id;
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
): Promise<{ id: string; webViewLink: string | null } | null> {
  const drive = getWriteClient();
  const folderId = await ensureOutputFolder();
  const escaped = fileName.replace(/'/g, "\\'");

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and name = '${escaped}'`,
    fields: "files(id, webViewLink)",
    pageSize: 1,
  });
  const file = res.data.files?.[0];
  if (!file?.id) return null;
  return { id: file.id, webViewLink: file.webViewLink ?? null };
}

/** Lädt eine fertige Videodatei in den Zielordner hoch. */
export async function uploadToOutputFolder(
  fileName: string,
  buffer: Buffer,
): Promise<{ id: string; webViewLink: string | null }> {
  const drive = getWriteClient();
  const folderId = await ensureOutputFolder();

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
  maxAttempts = 3,
): Promise<{ id: string; webViewLink: string | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const existing = await findFileInOutputFolder(fileName);
      if (existing) return existing;

      const backoffMs = 2000 * 2 ** (attempt - 2); // 2s, 4s, ...
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    try {
      return await uploadToOutputFolder(fileName, buffer);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Upload nach ${maxAttempts} Versuchen fehlgeschlagen: ${String(lastError)}`,
  );
}
