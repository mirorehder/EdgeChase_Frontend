-- Feste Post-Uhrzeiten in Schweizer Zeit.
--
-- Ergaenzung zum bestehenden Fenster/Abstand-Modell: hier stehen konkrete
-- Uhrzeiten (z.B. "17:00,20:00"). Ist das Feld gefuellt, gelten diese
-- Uhrzeiten AUSSCHLIESSLICH - Fenster und Mindestabstand werden ignoriert.
-- Ist es leer, gilt weiterhin die alte Logik.
--
-- CH-Zeit statt UTC: eine Uhrzeit, die der Nutzer im Kopf hat, soll auch
-- diese Uhrzeit sein. Ohne Umrechnen im Kopf ueber Sommer- und Winterzeit.
ALTER TABLE "PostZeitplan" ADD COLUMN "postingTimes" TEXT NOT NULL DEFAULT '';
