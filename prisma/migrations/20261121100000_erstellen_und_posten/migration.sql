-- Erstellen und Posten in einem Ablauf: Marker am Video, Reservierung fürs Posten.
ALTER TABLE "PromoVideo" ADD COLUMN "autoPost" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PromoVideo" ADD COLUMN "altbestand" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PromoVideo" ADD COLUMN "postClaimedAt" TIMESTAMP(3);
ALTER TABLE "PromoVideo" ADD COLUMN "postAttempts" INTEGER NOT NULL DEFAULT 0;

-- Alles, was bisher erstellt und nicht gepostet wurde, wird einmalig als Altbestand
-- gekennzeichnet. Die Automatik lässt es liegen; gepostet wird nur noch von Hand.
UPDATE "PromoVideo" SET "altbestand" = true WHERE "postedAt" IS NULL;
