-- Worauf es bei der Clipauswahl ankam - die Regieanweisung des Dialogs.
--
-- Bisher stand sie nur im Fliesstext von requestedVia ("6 Clips, moeglichst
-- Stuerze"). Wer aus einem gelungenen Video ein Konzept macht, verliert sie
-- damit: das Konzept traegt den Text und die Zahlen, aber nicht die Vorgabe,
-- die die Clipauswahl ueberhaupt erst getroffen hat - und der naechste Lauf
-- danach waehlt wieder beliebige Hoehepunkte.
ALTER TABLE "PromoVideo" ADD COLUMN "themeHint" TEXT;
