-- Posting-Automatik: Zeitplan je Sparte, plus zwei Felder am Video.
--
-- Bisher postete das Tool gar nicht selbst - das lief ueber eine Claude-Routine
-- und den Instagram-MCP. Jetzt kann jede Sparte einen eigenen Posting-Takt
-- bekommen (wie oft, in welchem Zeitfenster, mit welchem Mindestabstand), und
-- das Tool veroeffentlicht selbst per Graph-API.
--
-- Fehlt die Zeitplan-Zeile, ist die Automatik aus - es passiert nichts von
-- selbst, genau wie vorher.
CREATE TABLE "PostZeitplan" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "postsPerDay" INTEGER NOT NULL DEFAULT 1,
  "fensterVonMin" INTEGER NOT NULL DEFAULT 480,
  "fensterBisMin" INTEGER NOT NULL DEFAULT 1260,
  "minAbstandMin" INTEGER NOT NULL DEFAULT 120,
  "alsTrialReel" BOOLEAN NOT NULL DEFAULT true,
  "quelle" TEXT NOT NULL DEFAULT 'scheduled',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PostZeitplan_pkey" PRIMARY KEY ("id")
);

-- Oeffentlich ladbarer Link (Instagram holt das Video von dort) und der
-- letzte Posting-Fehler fuers Dashboard.
ALTER TABLE "PromoVideo" ADD COLUMN "publicUrl" TEXT;
ALTER TABLE "PromoVideo" ADD COLUMN "postError" TEXT;

-- Wer schon gepostet hat, soll nicht doppelt drankommen: die Taktung fragt oft
-- nach "heute schon gepostet" und "zuletzt gepostet".
CREATE INDEX "PromoVideo_track_postedAt_idx" ON "PromoVideo" ("track", "postedAt");
