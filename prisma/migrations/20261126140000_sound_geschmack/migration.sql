-- Sound-Bibliothek: Bekanntheit (Trend-Platz) und Geschmacks-Urteil.
ALTER TABLE "SoundBibliothek" ADD COLUMN "trendRang" INTEGER;
ALTER TABLE "SoundBibliothek" ADD COLUMN "urteil" TEXT;
ALTER TABLE "SoundBibliothek" ADD COLUMN "urteilAt" TIMESTAMP(3);
