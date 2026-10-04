-- Neue Sparte "Daily Serien" (Schluessel "serie"): Videos mit Tageszaehler,
-- die nach dem Rendern sofort gepostet werden.

ALTER TABLE "Concept" ADD COLUMN "counterNext" INTEGER;
ALTER TABLE "Concept" ADD COLUMN "serieAktiv" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Concept" ADD COLUMN "serieLastDay" TEXT;

-- Zeitplan startet abgeschaltet.
INSERT INTO "TrackSchedule" ("id", "enabled", "videosPerDay", "conceptMode", "conceptIds", "updatedAt")
VALUES ('serie', false, 1, 'rotation', '[]', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Einmalige Uebernahme des Doc-Meiro-Materials (Ordner und analysierte Clips),
-- damit nichts neu analysiert werden muss. Kopie, nicht geteilt: danach laeuft
-- die Sparte unabhaengig. Die Rotation startet frisch.
INSERT INTO "SourceFolder" (
    "id", "driveFolderId", "name", "track", "description", "autoAnalyze",
    "useInVideos", "sortIndex", "createdAt"
)
SELECT
    'serie-' || "id", "driveFolderId", "name", 'serie', "description",
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
    'serie-' || "id", "driveFileId", "name", 'serie', "durationMs", "sourceFolderId",
    "sourceFolderName", "rootFolderId", "manualRank", "disabled", "description",
    "apparelScore", "stuntScore", "momentArt", "momentDescription",
    "highlightStartMs", "highlightEndMs", "peakMs", "startMs", "endMs",
    "analysisVersion", "analysisFailures", "analysisError", "editedAt",
    NULL, CURRENT_TIMESTAMP
FROM "Clip"
WHERE "track" = 'viral'
ON CONFLICT ("driveFileId", "track") DO NOTHING;

-- Posting-Einstellungen der Sparte: Trend-Sounds, Hashtags und Trial-Schalter
-- einmalig von Doc Meiro uebernehmen, damit das erste Video nicht an "kein
-- Sound verfuegbar" scheitert. Gibt es noch keine Doc-Meiro-Zeile, bleibt es
-- bei den Voreinstellungen (der Aufruf von /api/post-schedule/seed-trends
-- fuellt sie dann). Danach unabhaengig.
INSERT INTO "PostZeitplan" ("id", "alsTrialReel", "hashtags", "trendSounds", "updatedAt")
SELECT 'serie', "alsTrialReel", "hashtags", "trendSounds", CURRENT_TIMESTAMP
FROM "PostZeitplan"
WHERE "id" = 'viral'
ON CONFLICT ("id") DO NOTHING;
