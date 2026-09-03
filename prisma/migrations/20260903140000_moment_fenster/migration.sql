-- Zwei Felder, die beide dieselbe Luecke schliessen: die Auswahl und der
-- Schnitt wussten bisher nur, wo der Trick ANFAENGT und wo er AUFHOERT.
--
-- momentDescription: was NUR im gezeigten Fenster passiert. Bisher wurde auf
-- die Beschreibung des ganzen Clips ausgewaehlt - der dauert oft eine halbe
-- Minute, davon kommt rund eine Sekunde ins Video. Ein Clip konnte deshalb
-- wegen einer Stelle gewaehlt werden, die im fertigen Video nie vorkommt.
--
-- peakMs: der eine Augenblick dazwischen, auf den es ankommt. Gebraucht, wenn
-- der Trick laenger dauert, als eine Einstellung zeigen darf: bisher wurde ab
-- dem Absprung geschnitten, und bei einem langen Trick (Anlauf, Klettern, dann
-- Salto) fiel die Landung hinten heraus - gezeigt wurde der Anlauf, die Pointe
-- fehlte.
--
-- Beide bleiben leer, bis der Clip neu analysiert ist. Der Code faellt so
-- lange auf das bisherige Verhalten zurueck: lange Beschreibung, Schnitt ab
-- dem Absprung. Die Umstellung braucht damit keinen Stichtag.
ALTER TABLE "Clip" ADD COLUMN "momentDescription" TEXT;
ALTER TABLE "Clip" ADD COLUMN "peakMs" INTEGER;
