import { google, drive_v3 } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { env } from "./env";

// Video-MIME-Typen, auf die die Ordner-Abfrage beschränkt wird - der
// Quellordner könnte auch andere Dateien enthalten (Notizen, Vorschaubilder).
const VIDEO_MIME_QUERY = "mimeType contains 'video/'";

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;

  const credentials = JSON.parse(env.googleServiceAccountJson);
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    // drive.readonly reicht für den Quellordner, drive.file für den Upload
    // ins Zielverzeichnis - kein voller Drive-Zugriff nötig.
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
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
}

/** Listet alle Video-Dateien im Quellordner (mit Pagination). */
export async function listSourceClips(): Promise<DriveClipFile[]> {
  const drive = getDriveClient();
  const files: DriveClipFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${env.driveSourceFolderId}' in parents and trashed = false and (${VIDEO_MIME_QUERY})`,
      fields:
        "nextPageToken, files(id, name, mimeType, size, createdTime, videoMediaMetadata(durationMillis))",
      pageSize: 200,
      pageToken,
    });

    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      files.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: f.size ? Number(f.size) : null,
        createdTime: f.createdTime ?? null,
        durationMs: f.videoMediaMetadata?.durationMillis
          ? Number(f.videoMediaMetadata.durationMillis)
          : null,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

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

/** Prüft, ob im Zielordner bereits eine Datei mit diesem Namen liegt - Grundlage für den Duplikatschutz beim Retry. */
export async function findFileInOutputFolder(
  fileName: string,
): Promise<{ id: string; webViewLink: string | null } | null> {
  const drive = getDriveClient();
  const escaped = fileName.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${env.driveOutputFolderId}' in parents and trashed = false and name = '${escaped}'`,
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
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [env.driveOutputFolderId],
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
