import { prisma } from "../db";
import { env } from "../env";
import { sendePush } from "../push";
import type { GeleseneBestellung } from "../wix/coupons";

/**
 * Provisions-Tracking: aus einer gelesenen Wix-Bestellung eine verbuchte
 * Provision machen, und die Aggregation je Person und Monat/Jahr bereitstellen.
 *
 * Beträge werden auf zwei Nachkommastellen gerundet und als Zahl an Prismas
 * Decimal-Felder gegeben - bei Geld darf die Rundung nicht vom Gleitkomma des
 * Anzeige-Codes abhängen, deshalb hier einmal zentral.
 */

/** Abrechnungsmonat "YYYY-MM" aus einem Datum. */
export function monatVon(datum: Date): string {
  return datum.toISOString().slice(0, 7);
}

/** Auf zwei Nachkommastellen runden. */
export function rundeChf(betrag: number): number {
  return Math.round(betrag * 100) / 100;
}

export type VerbuchenErgebnis =
  | { ergebnis: "verbucht"; provision: number; jahresProvision: number; deckelErreicht: boolean }
  | { ergebnis: "kein_code" }
  | { ergebnis: "unbekannter_code"; code: string }
  | { ergebnis: "doppelt" };

/**
 * Verbucht eine gelesene Bestellung als Provision.
 *
 * Ablauf: Code → Person zuordnen, Bestellwert × Provisionssatz = Provision,
 * idempotent speichern (wixOrderId ist unique - dasselbe Bestell-Ereignis
 * zählt nie doppelt). Erreicht die Jahres-Provision der Person den Deckel,
 * geht eine Push-Eskalation an den Betreiber ("grosser Betrag").
 */
export async function verbucheBestellung(
  gelesen: GeleseneBestellung,
): Promise<VerbuchenErgebnis> {
  if (!gelesen.couponCode) return { ergebnis: "kein_code" };

  // Zuordnung über den Code. Gross-/Kleinschreibung von Wix ist nicht garantiert
  // - deshalb unabhängig davon vergleichen.
  const partner = await prisma.partner.findFirst({
    where: { couponCode: { equals: gelesen.couponCode, mode: "insensitive" } },
  });
  if (!partner) return { ergebnis: "unbekannter_code", code: gelesen.couponCode };

  // Schon verbucht? Der unique-Index auf wixOrderId ist die eigentliche
  // Sperre; diese Vorabprüfung spart nur den Fehlerweg im Normalfall.
  const schon = await prisma.partnerBestellung.findUnique({
    where: { wixOrderId: gelesen.wixOrderId },
  });
  if (schon) return { ergebnis: "doppelt" };

  const provision = rundeChf(gelesen.bestellwertNetto * partner.provisionssatz);
  const monat = monatVon(gelesen.bestelltAm);

  try {
    await prisma.partnerBestellung.create({
      data: {
        partnerId: partner.id,
        wixOrderId: gelesen.wixOrderId,
        bestellwertNetto: gelesen.bestellwertNetto,
        waehrung: gelesen.waehrung,
        provisionssatz: partner.provisionssatz,
        provision,
        couponCode: gelesen.couponCode,
        monat,
        bestelltAm: gelesen.bestelltAm,
        payload: gelesen as unknown as never,
      },
    });
  } catch (fehler) {
    // Zwei Webhooks für dieselbe Bestellung zeitgleich - der zweite verliert
    // am unique-Index. Kein Fehlerfall, sondern die gewollte Doppelsperre.
    if (/unique|P2002/i.test(fehler instanceof Error ? fehler.message : String(fehler))) {
      return { ergebnis: "doppelt" };
    }
    throw fehler;
  }

  const jahr = gelesen.bestelltAm.getFullYear();
  const jahresProvision = await jahresProvisionVon(partner.id, jahr);
  const deckelErreicht = jahresProvision >= env.jahresDeckelChf;

  if (deckelErreicht) {
    await sendePush({
      titel: "⚠️ Provisions-Deckel erreicht",
      rumpf: `${partner.name ?? partner.igUsername ?? partner.couponCode}: CHF ${jahresProvision.toFixed(2)} in ${jahr} (Deckel CHF ${env.jahresDeckelChf}).`,
      url: `/?partner=${partner.id}`,
    }).catch((f) => console.error("Push für Deckel fehlgeschlagen", f));
  }

  return { ergebnis: "verbucht", provision, jahresProvision, deckelErreicht };
}

/** Summe der Provision einer Person in einem Kalenderjahr (ohne Stornos). */
export async function jahresProvisionVon(partnerId: string, jahr: number): Promise<number> {
  const von = `${jahr}-01`;
  const bis = `${jahr}-12`;
  const zeilen = await prisma.partnerBestellung.findMany({
    where: { partnerId, storniert: false, monat: { gte: von, lte: bis } },
    select: { provision: true },
  });
  return rundeChf(zeilen.reduce((s, z) => s + Number(z.provision), 0));
}

export type MonatsZeile = {
  monat: string;
  anzahl: number;
  umsatz: number;
  provision: number;
};

/** Aggregation je Monat für eine Person - für das Dashboard. */
export async function monatsUebersichtVon(partnerId: string): Promise<MonatsZeile[]> {
  const zeilen = await prisma.partnerBestellung.findMany({
    where: { partnerId, storniert: false },
    select: { monat: true, bestellwertNetto: true, provision: true },
  });

  const proMonat = new Map<string, MonatsZeile>();
  for (const z of zeilen) {
    const eintrag = proMonat.get(z.monat) ?? { monat: z.monat, anzahl: 0, umsatz: 0, provision: 0 };
    eintrag.anzahl += 1;
    eintrag.umsatz = rundeChf(eintrag.umsatz + Number(z.bestellwertNetto));
    eintrag.provision = rundeChf(eintrag.provision + Number(z.provision));
    proMonat.set(z.monat, eintrag);
  }

  return [...proMonat.values()].sort((a, b) => b.monat.localeCompare(a.monat));
}
