-- Gueltigkeitsdauer der Codes aus der Datenbank, damit sie ohne Deploy
-- anpassbar ist. Vorbelegung 7 Tage entspricht dem bisherigen Verhalten.
ALTER TABLE "InstagramConfig" ADD COLUMN "gueltigTage" INTEGER NOT NULL DEFAULT 7;
