-- Von Hand gewaehlte Ausgabeordner je Sparte und Herkunft.
--
-- Bisher stand der Zielordner fest im Code und in Umgebungsvariablen. Damit
-- die Posting-Routinen sauber getrennt aufgestellt werden koennen, waehlt der
-- Nutzer die Ordner jetzt im Dashboard - je Sparte einen fuer den Tageslauf
-- und einen fuer die Handversuche. Fehlt eine Zeile, gilt weiterhin der
-- bisherige Standard.
CREATE TABLE "AusgabeOrdner" (
  "track" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "folderName" TEXT NOT NULL DEFAULT '',
  "folderUrl" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AusgabeOrdner_pkey" PRIMARY KEY ("track", "kind")
);
