-- Poller-Wasserstände: weil beide Apps sich eine Meta-App teilen, hat das
-- Partner-Programm keinen eigenen Webhook und holt Kommentare/DMs im Zeitplan
-- aktiv ab. Diese Spalten merken sich den Zeitpunkt des jeweils letzten Laufs.
-- AlterTable
ALTER TABLE "PartnerConfig" ADD COLUMN     "letzterDmScan" TIMESTAMP(3),
ADD COLUMN     "letzterKommentarScan" TIMESTAMP(3);
