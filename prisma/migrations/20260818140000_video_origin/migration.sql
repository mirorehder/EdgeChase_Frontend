-- AlterTable
ALTER TABLE "PromoVideo" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';

-- Bestehende Aufträge nachtragen. Die drei Entstehungswege lassen sich
-- rückwirkend sauber trennen: der tägliche Promo-Lauf setzt kein
-- requestedVia, und ein Zielordner am Auftrag wird ausschliesslich vom
-- Zeitplan der viralen Sparte gesetzt.
UPDATE "PromoVideo"
SET "origin" = CASE
  WHEN "requestedVia" IS NULL THEN 'scheduled'
  WHEN "driveFolderId" IS NOT NULL THEN 'scheduled'
  ELSE 'manual'
END;

-- CreateIndex
CREATE INDEX "PromoVideo_origin_idx" ON "PromoVideo"("origin");
