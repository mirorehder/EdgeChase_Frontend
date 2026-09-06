-- Hashtags und Trend-Sound-Pool pro Sparte.
--
-- Grund: bisher wurde ein Video ohne konfigurierten Sound OHNE Sound gepostet.
-- Der Nutzer will das ausdruecklich nicht - stumme Reels sind ein No-Go. Der
-- Trend-Sound-Pool ist die Antwort: eine kleine Liste von IG-Sound-Links, die
-- der Nutzer als "gute Trend-Sounds" ausgewaehlt hat; beim Posten wird zufaellig
-- einer daraus gezogen, wenn kein eigener Sound am Konzept haengt.
--
-- Fehlt der Pool UND der eigene Sound UND enthaelt der Dateiname nicht "_music"
-- (= Video hat schon eigene Musik), wird nicht gepostet - lieber ausfallen als
-- stumm veroeffentlichen.
--
-- Hashtags sind Freitext; das Anhaengen sauber-formatiert die Rauten.
ALTER TABLE "PostZeitplan" ADD COLUMN "hashtags" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PostZeitplan" ADD COLUMN "trendSounds" JSONB NOT NULL DEFAULT '[]';
