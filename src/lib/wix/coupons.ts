import { env } from "../env";

/**
 * Gutscheine auf der Wix-Site anlegen - über die REST-API mit API-Key.
 *
 * Bewusst ohne SDK und ohne MCP: der Webhook läuft serverseitig ohne
 * Benutzersitzung, und genau dafür sind Wix-API-Keys gedacht. Ein Key ist
 * langlebig (kein Token-Refresh) und identifiziert sein Ziel über einen
 * eigenen Kopfzeilen-Eintrag - deshalb "wix-site-id" zusätzlich zu
 * "Authorization".
 */

const COUPONS_URL = "https://www.wixapis.com/stores/v2/coupons";
const QUERY_URL = `${COUPONS_URL}/query`;

/** Wix begrenzt eine Seite der Gutschein-Abfrage auf 100 Einträge. */
const SEITE = 100;

/**
 * Obergrenze für die Kollisionsprüfung.
 *
 * Der Bestand liegt bei einigen hundert Codes und wächst mit jedem Lauf. Ohne
 * Grenze würde die Prüfung irgendwann pro Kommentar ein Dutzend Anfragen
 * schicken; mit ihr bleibt es bei höchstens zehn. Wird sie je erreicht, ist
 * das kein stiller Fehler: die Erstellung selbst lehnt einen doppelten Code ab
 * und der Aufrufer weicht dann auf eine Variante aus.
 */
const MAX_SEITEN = 10;

type WixSpezifikation = {
  code?: string;
};

type WixGutschein = {
  id: string;
  specification?: WixSpezifikation;
};

async function wixAnfrage<T>(url: string, body: unknown): Promise<T> {
  const antwort = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: env.wixApiKey,
      "wix-site-id": env.wixSiteId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await antwort.text();

  if (!antwort.ok) {
    // Der Rumpf enthält bei Wix die eigentliche Ursache ("code already
    // exists", fehlender Scope, falsche Site). Ohne ihn stünde im Log nur
    // eine nackte 400, mit der niemand etwas anfangen kann.
    throw new Error(`Wix ${antwort.status} auf ${url}: ${text.slice(0, 400)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

/** Alle bereits vergebenen Codes, klein geschrieben zum Vergleichen. */
async function vergebeneCodes(): Promise<Set<string>> {
  const codes = new Set<string>();

  for (let seite = 0; seite < MAX_SEITEN; seite++) {
    const daten = await wixAnfrage<{ coupons?: WixGutschein[]; totalResults?: number }>(
      QUERY_URL,
      { query: { paging: { limit: SEITE, offset: seite * SEITE } } },
    );

    const gutscheine = daten.coupons ?? [];
    for (const gutschein of gutscheine) {
      const code = gutschein.specification?.code;
      if (code) codes.add(code.toLowerCase());
    }

    const gesamt = daten.totalResults ?? 0;
    if (gutscheine.length < SEITE || (seite + 1) * SEITE >= gesamt) break;
  }

  return codes;
}

/**
 * Sucht einen freien Code, der den Namen erkennbar lässt.
 *
 * Die Abwandlung folgt dem, was auf der Site schon steht: erst der blosse
 * Name, dann "15" angehängt (LARS -> LARS15, so wie es die Athleten-Codes
 * vormachen), danach durchnummeriert. Ein Code wie "X7F2QP" wäre zwar auch
 * frei, aber der Name im Code ist der ganze Reiz der Aktion.
 */
export async function freierCode(wunsch: string): Promise<string> {
  const basis = wunsch.toUpperCase();
  const vergeben = await vergebeneCodes();

  if (!vergeben.has(basis.toLowerCase())) return basis;

  const varianten = [`${basis}15`, ...Array.from({ length: 8 }, (_, i) => `${basis}${i + 2}`)];
  for (const variante of varianten) {
    if (!vergeben.has(variante.toLowerCase())) return variante;
  }

  // Zehn Personen mit demselben Vornamen und allen Varianten belegt - dann
  // lieber ein Zufallssuffix als gar kein Code.
  return `${basis}${Math.floor(Math.random() * 900 + 100)}`;
}

export type NeuerGutschein = {
  /** Der gewünschte Code. Ist er vergeben, wird abgewandelt. */
  code: string;
  /** Rabatt in Prozent. */
  prozent: number;
  /** Gültigkeitsdauer ab jetzt. */
  gueltigTage: number;
  /** Schlagwort zur Auswertung im Wix-Dashboard. */
  tag: string;
};

/**
 * Legt den Gutschein an und gibt zurück, welcher Code es am Ende wurde.
 *
 * Die Kollisionsprüfung davor ist nicht wasserdicht - zwischen Abfrage und
 * Anlegen kann ein zweiter Kommentar denselben Namen belegen. Deshalb wird ein
 * abgelehnter Code hier noch einmal abgewandelt statt den ganzen Vorgang
 * scheitern zu lassen.
 */
export async function erstelleGutschein(
  vorgabe: NeuerGutschein,
): Promise<{ id: string; code: string }> {
  const jetzt = Date.now();
  const ablauf = jetzt + vorgabe.gueltigTage * 24 * 60 * 60 * 1000;

  const anlegen = async (code: string) => {
    const antwort = await wixAnfrage<{ id: string }>(COUPONS_URL, {
      specification: {
        name: `${code} - Instagram ${vorgabe.prozent}%`,
        code,
        active: true,
        // Wix erwartet die Zeitpunkte als Millisekunden-Zeitstempel im String.
        startTime: String(jetzt),
        expirationTime: String(ablauf),
        // Einmal einlösbar, über alle Kundinnen und Kunden hinweg.
        usageLimit: 1,
        scope: { namespace: "stores" },
        percentOffRate: vorgabe.prozent,
        tags: [vorgabe.tag],
      },
    });
    return { id: antwort.id, code };
  };

  const code = await freierCode(vorgabe.code);

  try {
    return await anlegen(code);
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    // Nur die Dopplung wird abgefangen. Ein fehlender Scope oder eine falsche
    // Site sollen laut scheitern, nicht in einer Endlosschleife aus Varianten
    // untergehen.
    if (!/exist|duplicate|taken|unique/i.test(text)) throw fehler;

    return anlegen(`${code}${Math.floor(Math.random() * 900 + 100)}`);
  }
}
