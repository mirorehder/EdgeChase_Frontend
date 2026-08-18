-- AlterTable
ALTER TABLE "Concept" ADD COLUMN "textPhases" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "PromoVideo" ADD COLUMN "textPhases" JSONB;

-- Bestehende Konzepte bekommen ihren bisherigen Text als einzige Phase, damit
-- sie sich genauso verhalten wie zuvor.
UPDATE "Concept"
SET "textPhases" = jsonb_build_array(
  jsonb_build_object(
    'text', "hookText",
    'seconds', "totalSeconds",
    'role', 'plain',
    'sceneHint', ''
  )
)
WHERE "hookText" <> '';
