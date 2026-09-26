-- Ablauf-Erinnerung: eine DM ca. 12 h vor Ende der 7-Tage-Gültigkeit. Der
-- Zeitstempel dient auch als Sperre, damit die Zeile nicht wiederholt
-- aufgegriffen wird.
ALTER TABLE "InstagramComment" ADD COLUMN "erinnerungGesendetAm" TIMESTAMP(3);
