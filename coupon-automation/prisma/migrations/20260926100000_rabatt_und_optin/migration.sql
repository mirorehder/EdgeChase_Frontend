-- Rabattsatz aus der Datenbank, damit er ohne Deploy anpassbar ist
ALTER TABLE "InstagramConfig" ADD COLUMN "rabattProzent" INTEGER NOT NULL DEFAULT 25;

-- Zwei-Stufen-DM-Ablauf: die Erst-DM ist der Opt-in, die zweite DM enthält
-- den Code. Ohne Backfill würden alle bereits ausgelieferten Codes als
-- "wartet auf Opt-in" gelten und ein Duplikat bekommen, sobald die Person
-- irgendwann noch mal schreibt.
ALTER TABLE "InstagramComment" ADD COLUMN "codeGesendetAm" TIMESTAMP(3);
UPDATE "InstagramComment" SET "codeGesendetAm" = "updatedAt" WHERE "dmGesendet" = true;
