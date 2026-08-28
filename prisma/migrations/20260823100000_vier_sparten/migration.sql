-- Zwei weitere Sparten: EdgeChase Sports Reels und EdgeChase Clothing Reels.
--
-- Der Schluessel der bisherigen viralen Sparte bleibt "viral", obwohl sie
-- jetzt "Doc Meiro Reels" heisst. Ihn umzubenennen hiesse, in fuenf Tabellen
-- Zeilen umzuschreiben - fuer einen Namen, den ausser dem Code niemand sieht.

-- 1. Der Zeitplan gilt nicht mehr einmal global, sondern je Sparte.
ALTER TABLE "ViralSchedule" RENAME TO "TrackSchedule";
ALTER TABLE "TrackSchedule" ALTER COLUMN "id" DROP DEFAULT;

-- Die bisherige Einzelzeile gehoert der Doc-Meiro-Sparte.
UPDATE "TrackSchedule" SET "id" = 'viral' WHERE "id" = 'default';

-- Die beiden neuen Sparten starten mit abgeschaltetem Zeitplan: sie sollen
-- erst laufen, wenn jemand sie bewusst einschaltet.
INSERT INTO "TrackSchedule" ("id", "enabled", "videosPerDay", "conceptMode", "conceptIds", "updatedAt")
VALUES
    ('sports',   false, 1, 'rotation', '[]', CURRENT_TIMESTAMP),
    ('clothing', false, 1, 'rotation', '[]', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Falls die Doc-Meiro-Zeile noch gar nicht existierte (Zeitplan nie geoeffnet).
INSERT INTO "TrackSchedule" ("id", "enabled", "videosPerDay", "conceptMode", "conceptIds", "updatedAt")
VALUES ('viral', false, 1, 'rotation', '[]', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 2. Quellordner der Sports-Sparte. Der Ordner war frueher schon einmal als
-- Parkour-Quelle eingetragen und wurde damals ersetzt; er ist aktuell
-- nirgends eingebunden. Der Name kommt beim ersten Abgleich aus Drive.
INSERT INTO "SourceFolder" ("id", "driveFolderId", "track", "sortIndex")
VALUES ('quelle-sports-1', '1WDtxBREWE1MPYAvqjUbAtI8mRbXziYMO', 'sports', 0)
ON CONFLICT ("driveFolderId") DO NOTHING;

-- Fuer die Clothing-Sparte steht noch kein Ordner fest. Sie bleibt bis dahin
-- ohne Quelle - eintragen laesst er sich im Dashboard, ohne Migration.

-- 3. Die bestehenden Konzepte der Doc-Meiro-Sparte einmalig nach Sports
-- kopieren. Kopie, nicht geteilt: ein Text fuer Doc Meiro darf sich anders
-- entwickeln als einer fuer EdgeChase.
INSERT INTO "Concept" (
    "id", "track", "title", "sourceUrl", "hookText", "textPhases", "textStyle",
    "clipCount", "totalSeconds", "secondsPerScene", "theme", "notes", "createdAt"
)
SELECT
    'sports-' || "id",
    'sports',
    "title",
    "sourceUrl",
    "hookText",
    "textPhases",
    "textStyle",
    "clipCount",
    "totalSeconds",
    "secondsPerScene",
    "theme",
    "notes",
    CURRENT_TIMESTAMP
FROM "Concept"
WHERE "track" = 'viral'
ON CONFLICT ("id") DO NOTHING;
