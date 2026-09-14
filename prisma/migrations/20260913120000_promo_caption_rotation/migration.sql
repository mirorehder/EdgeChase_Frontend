-- Nur Promo: getrennte Auswahl für Video-Text (Overlay) und Instagram-
-- Bildunterschrift - jeweils entweder KI oder eine eigene, rotierend gewählte
-- Liste. Bisher formulierte die KI beides; die Bildunterschriften gefielen
-- nicht immer.
ALTER TABLE "DailyConfig" ADD COLUMN "hookMode" TEXT NOT NULL DEFAULT 'ki';
ALTER TABLE "DailyConfig" ADD COLUMN "hookTexts" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "DailyConfig" ADD COLUMN "hookIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyConfig" ADD COLUMN "captionMode" TEXT NOT NULL DEFAULT 'ki';
ALTER TABLE "DailyConfig" ADD COLUMN "captions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "DailyConfig" ADD COLUMN "captionIndex" INTEGER NOT NULL DEFAULT 0;

-- Bisheriges Verhalten bewahren: ein vorhandener fester Hook-Text wird zur
-- Ein-Eintrag-Rotation, damit das Overlay unverändert bleibt.
UPDATE "DailyConfig"
  SET "hookMode" = 'eigene',
      "hookTexts" = to_jsonb(ARRAY["hookText"])
  WHERE "hookText" IS NOT NULL AND "hookText" <> '';

-- Feste Bildunterschrift je Video (nur gesetzt, wenn der Nutzer eigene
-- Captions wählt).
ALTER TABLE "PromoVideo" ADD COLUMN "postCaption" TEXT;
