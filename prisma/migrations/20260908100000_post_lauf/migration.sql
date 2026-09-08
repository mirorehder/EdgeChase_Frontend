-- Protokoll jeder Prüfung der Posting-Automatik.
--
-- Bisher hinterliess ein Pinger-Lauf, der nichts zu posten fand, keine Spur.
-- Damit war "um 10:00 wurde nichts gepostet" von aussen nicht zu erklären:
-- lief der Pinger nicht, gab es kein postbares Video, oder war die Uhrzeit
-- noch nicht erreicht? Diese Tabelle hält den Ausgang jeder Prüfung fest -
-- auch den ergebnislosen -, und das Dashboard zeigt ihn an.
--
-- Aufeinanderfolgende gleiche Ausgänge derselben Sparte werden in der
-- Anwendung zu einer Zeile zusammengefasst (nur der Zeitstempel wandert mit),
-- damit ein stündlicher Pinger vor der ersten Post-Uhrzeit nicht Dutzende
-- gleicher Zeilen erzeugt.
CREATE TABLE "PostLauf" (
  "id" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "track" TEXT NOT NULL,
  "gepostet" BOOLEAN NOT NULL DEFAULT false,
  "grund" TEXT,
  "mediaId" TEXT,
  "videoTitel" TEXT,
  CONSTRAINT "PostLauf_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PostLauf_at_idx" ON "PostLauf" ("at");
CREATE INDEX "PostLauf_track_at_idx" ON "PostLauf" ("track", "at");
