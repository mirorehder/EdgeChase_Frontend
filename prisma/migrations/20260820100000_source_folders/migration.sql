-- Quellordner werden im Dashboard verwaltet statt in der Umgebung.
--
-- Bis hierher hatte jede Sparte genau einen Wurzelordner, fest in einer
-- Umgebungsvariablen. Die Parkour-Sparte hat jetzt vier, und welche davon
-- eingelesen und verwendet werden, entscheidet sich zur Laufzeit.

CREATE TABLE "SourceFolder" (
    "id" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "track" TEXT NOT NULL DEFAULT 'viral',
    "description" TEXT NOT NULL DEFAULT '',
    "autoAnalyze" BOOLEAN NOT NULL DEFAULT true,
    "useInVideos" BOOLEAN NOT NULL DEFAULT true,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceFolder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceFolder_driveFolderId_key" ON "SourceFolder"("driveFolderId");
CREATE INDEX "SourceFolder_track_idx" ON "SourceFolder"("track");

-- Zuordnung zum Wurzelordner, Rangfolge von Hand und Stilllegung einzelner Clips.
ALTER TABLE "Clip" ADD COLUMN "rootFolderId" TEXT;
ALTER TABLE "Clip" ADD COLUMN "manualRank" INTEGER;
ALTER TABLE "Clip" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Clip_rootFolderId_idx" ON "Clip"("rootFolderId");

-- Die vier Parkour-Ordner. Der erste ist der bisherige, die drei anderen sind
-- neu. Die Namen bleiben leer und werden beim ersten Abgleich aus Drive geholt
-- - so steht nie ein Name im Dashboard, den in Drive niemand vergeben hat.
INSERT INTO "SourceFolder" ("id", "driveFolderId", "track", "sortIndex") VALUES
    ('quelle-parkour-1', '1t-9kl96htTGEiKqhRiA_Ab9f5T5EpMIN', 'viral', 0),
    ('quelle-parkour-2', '15mIJG1WPfd6NUVHoC8_eBetmzs8GrwFQ', 'viral', 1),
    ('quelle-parkour-3', '1GVD4dmPOpHNUrOv16c3eV7JkIbiS1U-H', 'viral', 2),
    ('quelle-parkour-4', '1Pn7GQCuDiUYtECVCgJ2F4ygg8w6BbbBj', 'viral', 3);

-- Bereits eingelesene Parkour-Clips stammen alle aus dem bisherigen Ordner.
-- Ohne diese Zuordnung stuenden sie in der Bibliothek unter keinem Ordner.
UPDATE "Clip"
   SET "rootFolderId" = '1t-9kl96htTGEiKqhRiA_Ab9f5T5EpMIN'
 WHERE "track" = 'viral' AND "rootFolderId" IS NULL;
