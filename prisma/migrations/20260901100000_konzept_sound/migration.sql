-- Der Sound je Konzept, und was davon am Auftrag festgehalten wird.
--
-- Hintergrund: Instagram kennt beim Anhaengen eines Sounds keinen
-- Startversatz. Nur Sounds, deren Anfang schon die gewollte Stelle ist, sind
-- brauchbar. Welcher das ist, wird einmal je Konzept geklaert und hier
-- festgehalten.

ALTER TABLE "Concept" ADD COLUMN "soundUrl" TEXT;
ALTER TABLE "Concept" ADD COLUMN "soundAudioId" TEXT;
ALTER TABLE "Concept" ADD COLUMN "soundKind" TEXT;
ALTER TABLE "Concept" ADD COLUMN "soundTitle" TEXT;
ALTER TABLE "Concept" ADD COLUMN "soundArtist" TEXT;
-- Vorgabe "ohne": ein Konzept ohne eingefuegten Link hat keinen eigenen
-- Sound, und beim Posten gilt der Trend-Sound. "offen" hiesse "eingefuegt,
-- aber noch nicht geprueft" und waere fuer bestehende wie neue Konzepte
-- gleichermassen falsch.
ALTER TABLE "Concept" ADD COLUMN "soundStatus" TEXT NOT NULL DEFAULT 'ohne';
ALTER TABLE "Concept" ADD COLUMN "soundNote" TEXT;
ALTER TABLE "Concept" ADD COLUMN "soundCheckedAt" TIMESTAMP(3);

ALTER TABLE "PromoVideo" ADD COLUMN "conceptId" TEXT;
ALTER TABLE "PromoVideo" ADD COLUMN "soundAudioId" TEXT;
ALTER TABLE "PromoVideo" ADD COLUMN "soundTitle" TEXT;
ALTER TABLE "PromoVideo" ADD COLUMN "soundStatus" TEXT;
