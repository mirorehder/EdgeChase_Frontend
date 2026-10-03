-- Neue Sparte "Coaching Videos" (Schluessel "coaching").
--
-- Clips, Quellordner und deren Analyse werden von der Sparte "viral"
-- mitgenutzt (siehe materialTrack in trackClient.ts) - es wird deshalb nichts
-- kopiert und nichts neu analysiert. Konzepte gibt es keine: die legt der
-- Nutzer im Dashboard selbst an.

-- Der Zeitplan startet abgeschaltet: er soll erst laufen, wenn jemand ihn
-- bewusst einschaltet.
INSERT INTO "TrackSchedule" ("id", "enabled", "videosPerDay", "conceptMode", "conceptIds", "updatedAt")
VALUES ('coaching', false, 1, 'rotation', '[]', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
