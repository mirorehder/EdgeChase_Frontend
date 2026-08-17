-- AlterTable
ALTER TABLE "Clip" ADD COLUMN "track" TEXT NOT NULL DEFAULT 'promo';
ALTER TABLE "Clip" ADD COLUMN "stuntScore" DOUBLE PRECISION;
ALTER TABLE "Clip" ADD COLUMN "highlightStartMs" INTEGER;
ALTER TABLE "Clip" ADD COLUMN "highlightEndMs" INTEGER;

ALTER TABLE "PromoVideo" ADD COLUMN "track" TEXT NOT NULL DEFAULT 'promo';

ALTER TABLE "Concept" ADD COLUMN "track" TEXT NOT NULL DEFAULT 'promo';

ALTER TABLE "ActivityLog" ADD COLUMN "track" TEXT NOT NULL DEFAULT 'promo';

-- CreateIndex
CREATE INDEX "Clip_track_idx" ON "Clip"("track");
CREATE INDEX "PromoVideo_track_idx" ON "PromoVideo"("track");
