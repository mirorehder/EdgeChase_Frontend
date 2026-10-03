-- Coaching bekommt eigene Quellordner und eigene Clips, unabhaengig von
-- Doc Meiro ("viral"). Dafuer darf dieselbe Datei bzw. derselbe Drive-Ordner
-- in mehreren Sparten vorkommen: die Eindeutigkeit gilt nur noch je Sparte.
DROP INDEX "Clip_driveFileId_key";
CREATE UNIQUE INDEX "Clip_driveFileId_track_key" ON "Clip"("driveFileId", "track");

DROP INDEX "SourceFolder_driveFolderId_key";
CREATE UNIQUE INDEX "SourceFolder_driveFolderId_track_key" ON "SourceFolder"("driveFolderId", "track");

-- Einmalige Uebernahme des Doc-Meiro-Materials nach Coaching, damit die Clips
-- nicht neu analysiert werden muessen. Danach laufen beide getrennt: Kopie,
-- nicht geteilt. Die Rotation (lastUsedAt) startet frisch.
INSERT INTO "SourceFolder" (
    "id", "driveFolderId", "name", "track", "description", "autoAnalyze",
    "useInVideos", "sortIndex", "createdAt"
)
SELECT
    'coaching-' || "id", "driveFolderId", "name", 'coaching', "description",
    "autoAnalyze", "useInVideos", "sortIndex", CURRENT_TIMESTAMP
FROM "SourceFolder"
WHERE "track" = 'viral'
ON CONFLICT ("driveFolderId", "track") DO NOTHING;

INSERT INTO "Clip" (
    "id", "driveFileId", "name", "track", "durationMs", "sourceFolderId",
    "sourceFolderName", "rootFolderId", "manualRank", "disabled", "description",
    "apparelScore", "stuntScore", "momentArt", "momentDescription",
    "highlightStartMs", "highlightEndMs", "peakMs", "startMs", "endMs",
    "analysisVersion", "analysisFailures", "analysisError", "editedAt",
    "lastUsedAt", "createdAt"
)
SELECT
    'coaching-' || "id", "driveFileId", "name", 'coaching', "durationMs", "sourceFolderId",
    "sourceFolderName", "rootFolderId", "manualRank", "disabled", "description",
    "apparelScore", "stuntScore", "momentArt", "momentDescription",
    "highlightStartMs", "highlightEndMs", "peakMs", "startMs", "endMs",
    "analysisVersion", "analysisFailures", "analysisError", "editedAt",
    NULL, CURRENT_TIMESTAMP
FROM "Clip"
WHERE "track" = 'viral'
ON CONFLICT ("driveFileId", "track") DO NOTHING;
