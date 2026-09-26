import { prisma } from "../db";
import { env } from "../env";
import { nutzungen } from "../wix/coupons";
import { sendePrivateAntwort } from "./graph";
import { holeAktiveGueltigTage, holeAktivenRabatt } from "./verarbeitung";

/**
 * Nachfassen bei Codes, die 48 Stunden alt sind und noch nicht eingelöst
 * wurden.
 *
 * Auslegung:
 * - Genau einmal pro Kommentar. Die Sperre steckt in "nachgefasstAm" - solange
 *   das gesetzt ist, wird die Zeile nicht mehr in die Warteschlange
 *   aufgenommen, unabhängig davon, wie oft der Aufräumjob läuft. Auch das
 *   Ergebnis der Wix-Prüfung (eingelöst → codeEingeloestAm gesetzt) reicht
 *   allein schon, um die Zeile aus der Warteschlange zu nehmen.
 * - Nur an Personen, deren Erst-DM tatsächlich rausging. Ist die Erst-DM
 *   fehlgeschlagen, gibt es keinen Grund anzunehmen, dass eine zweite
 *   ankommen würde - und es wäre auch fachlich falsch (die Person hat den
 *   Code nie in der Hand gehabt).
 * - Nur innerhalb von Metas Sieben-Tage-Fenster für private Antworten. Nach
 *   dieser Frist würde jede DM-API-Anfrage scheitern - deshalb bewusst mit
 *   einem Puffer bei 6,5 Tagen aufhören.
 */

/** Nach so vielen Stunden ist der Zeitpunkt fürs Nachfassen. */
const NACHFASSEN_NACH_H = 48;

/**
 * So kurz vor Ablauf des Sieben-Tage-Fensters wird nicht mehr nachgefasst.
 *
 * Zwölf Stunden Puffer klingen viel, aber der Zeitplan läuft nicht
 * sekundengenau, und ein Kommentar knapp vor der Frist würde ohnehin nur
 * eine 400 von Meta zurückbekommen.
 */
const FENSTER_ENDE_H = 6.5 * 24;

/**
 * Metas Frist für private Antworten auf einen Kommentar (168 h) minus einem
 * kleinen Puffer. Danach lehnt die Graph-API jede DM zu diesem Kommentar ab -
 * sowohl Nachfassen als auch Ablauf-Erinnerung.
 */
const META_DM_FENSTER_ENDE_H = 7 * 24 - 4;

/**
 * Zeitfenster für die Ablauf-Erinnerung, in Abhängigkeit der Gültigkeitsdauer.
 *
 * - Bei 4-7 Tagen Gültigkeit: 20-24 h vor dem tatsächlichen Ablauf, damit die
 *   Person noch reagieren kann. Der Aufräum-Lauf hat ca. 20 h Zeit, die Zeile
 *   zu greifen, sodass sie zwischen zwei Läufen nicht durchrutscht.
 * - Bei ≤ 3 Tagen Gültigkeit: keine Erinnerung. Nachfassen (48 h) fällt
 *   ohnehin schon nahe an den Ablauf, eine zweite DM wenige Stunden später
 *   wäre eher aufdringlich als hilfreich.
 * - Bei > 7 Tagen Gültigkeit: keine Erinnerung. Metas DM-Frist von 7 Tagen
 *   lässt eine "läuft bald ab"-Nachricht in den letzten Stunden nicht mehr zu.
 *
 * null als Rückgabe: keine Erinnerung für diese Gültigkeitsdauer.
 */
function erinnerungsFenster(
  gueltigTage: number,
): { fruehestensH: number; spaetestensH: number } | null {
  if (gueltigTage < 4 || gueltigTage > 7) return null;
  const spaetestensH = Math.min(gueltigTage * 24 - 4, META_DM_FENSTER_ENDE_H);
  const fruehestensH = Math.max(NACHFASSEN_NACH_H + 12, spaetestensH - 20);
  if (fruehestensH >= spaetestensH) return null;
  return { fruehestensH, spaetestensH };
}

/**
 * Wortlaut der Nachfass-DM.
 *
 * Bewusst knapp - der Code läuft ohnehin nach sieben Tagen ab, das reicht als
 * Dringlichkeit. Sprache wählt sich nach dem Reel (spracheAusCaption) - fällt
 * die Person auf ein deutschsprachiges Reel, kommt Deutsch, sonst Englisch.
 *
 * Der WhatsApp-Kanal wird als PS angehängt: da drüben lassen sich Personen
 * legitim ansprechen (Opt-in nach dem Beitritt), während eine Wiederkontakt-DM
 * auf Instagram nach Ablauf des Sieben-Tage-Fensters ohnehin nicht mehr
 * möglich wäre.
 */
function formuliereNachfass(name: string, code: string, sprache: "de" | "en"): string {
  if (sprache === "de") {
    return (
      `Hey ${name}, dein Code ${code} ist noch gültig auf edgechase.com ✨\n` +
      `PS: Unsere Herbst-Kollektion droppt bald — komm in unseren WhatsApp-Kanal, ` +
      `damit du sie als Erste*r siehst: ${env.whatsappChannelUrl}`
    );
  }
  return (
    `Hey ${name}, your code ${code} is still valid on edgechase.com ✨\n` +
    `PS: our fall collection is dropping soon — join our WhatsApp channel to see ` +
    `it first: ${env.whatsappChannelUrl}`
  );
}

/**
 * Wie viel Zeit bis zum Ablauf, in kurzen Worten. Bewusst grob - die
 * Erinnerung soll dringend wirken, nicht Uhrzeiten-genau.
 */
function ablaufIn(restStunden: number, sprache: "de" | "en"): string {
  if (restStunden <= 24) {
    return sprache === "de" ? "läuft heute ab" : "expires today";
  }
  const tage = Math.max(1, Math.round(restStunden / 24));
  if (sprache === "de") {
    return tage === 1 ? "läuft morgen ab" : `läuft in ${tage} Tagen ab`;
  }
  return tage === 1 ? "expires tomorrow" : `expires in ${tage} days`;
}

/**
 * Wortlaut der Ablauf-Erinnerung.
 *
 * Wenige Stunden vor Schluss geht der Ton eine Spur direkter als beim
 * ersten Nachfass - die tatsächliche Restzeit wird beim Absenden anhand von
 * createdAt und der aktuellen Gültigkeitsdauer errechnet und in den Text
 * eingesetzt, damit die Aussage stimmt, egal wie die Config eingestellt ist.
 */
function formuliereErinnerung(
  name: string,
  code: string,
  prozent: number,
  sprache: "de" | "en",
  restStunden: number,
): string {
  const ablauf = ablaufIn(restStunden, sprache);
  if (sprache === "de") {
    return (
      `${name}, letzte Erinnerung: dein Code ${code} (${prozent}% Rabatt) ${ablauf}. ` +
      `Schnapp dir noch was auf edgechase.com 🔥`
    );
  }
  return (
    `${name}, last reminder: your code ${code} (${prozent}% off) ${ablauf}. ` +
    `Grab something quick on edgechase.com 🔥`
  );
}

/**
 * Lädt die Sprachen aller in der Liste vorkommenden Reels in einem einzigen
 * Aufruf. Ein Nachfass-Lauf betrifft meist mehrere Kommentare desselben
 * Reels; ohne Bündelung wäre es N+1.
 */
async function ladeSprachen(mediaIds: string[]): Promise<Map<string, "de" | "en">> {
  const einmalig = Array.from(new Set(mediaIds));
  if (einmalig.length === 0) return new Map();
  const medien = await prisma.instagramMedia.findMany({
    where: { id: { in: einmalig } },
    select: { id: true, sprache: true },
  });
  const karte = new Map<string, "de" | "en">();
  for (const m of medien) {
    karte.set(m.id, m.sprache === "de" ? "de" : "en");
  }
  return karte;
}

/** Fällt Englisch, wenn wir das Reel (oder seine Sprache) nicht kennen. */
function spracheFuer(mediaId: string, karte: Map<string, "de" | "en">): "de" | "en" {
  return karte.get(mediaId) ?? "en";
}

export type NachfassAbschluss = {
  commentId: string;
  ergebnis: "nachgefasst" | "eingeloest" | "keine_dm_moeglich" | "fehler";
  hinweis?: string;
};

export async function nachfasseOffene(hoechstens = 20): Promise<NachfassAbschluss[]> {
  const jetzt = Date.now();
  // Kommentare älter als 48 h, aber noch innerhalb des DM-Fensters, mit
  // gesendeter Erst-DM und weder eingelöst noch schon nachgefasst.
  const obereGrenze = new Date(jetzt - NACHFASSEN_NACH_H * 60 * 60 * 1000);
  const untereGrenze = new Date(jetzt - FENSTER_ENDE_H * 60 * 60 * 1000);

  const kandidaten = await prisma.instagramComment.findMany({
    where: {
      status: "verarbeitet",
      dmGesendet: true,
      // Nur Personen, die den Code tatsächlich per DM bekommen haben - bei
      // Zeilen mit codeGesendetAm=null steht der Opt-in noch aus, ein Nachfass
      // wäre verwirrend ("dein Code ${code}" ohne dass sie ihn je gesehen
      // hat).
      codeGesendetAm: { not: null },
      couponCode: { not: null },
      couponId: { not: null },
      nachgefasstAm: null,
      codeEingeloestAm: null,
      createdAt: { gte: untereGrenze, lte: obereGrenze },
    },
    orderBy: { createdAt: "asc" },
    take: hoechstens,
  });

  const sprachen = await ladeSprachen(kandidaten.map((z) => z.mediaId));
  const abschluesse: NachfassAbschluss[] = [];

  for (const zeile of kandidaten) {
    if (!zeile.couponId || !zeile.couponCode || !zeile.name) continue;

    // Vor der DM: Wix fragen, ob der Code eingelöst ist. Ist er es, wäre die
    // Nachfass-DM peinlich - und der Datenpunkt Umsatz ist ohnehin wertvoller
    // als die Erinnerung.
    let anzahl: number;
    try {
      anzahl = await nutzungen(zeile.couponId);
    } catch (fehler) {
      abschluesse.push({
        commentId: zeile.id,
        ergebnis: "fehler",
        hinweis: `Wix-Abfrage fehlgeschlagen: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
      });
      // Dieser Fall wird beim nächsten Lauf wieder aufgegriffen - kein
      // Zeitstempel setzen, sonst geht der Kommentar für immer verloren.
      continue;
    }

    if (anzahl > 0) {
      await prisma.instagramComment.update({
        where: { id: zeile.id },
        // Beide Felder setzen: eingelöst als eigener Datenpunkt, und der
        // Nachfass-Zeitstempel zusätzlich als Sperre, damit die Zeile bei
        // späteren Läufen nicht mehr abgefragt wird.
        data: { codeEingeloestAm: new Date(), nachgefasstAm: new Date() },
      });
      abschluesse.push({ commentId: zeile.id, ergebnis: "eingeloest" });
      continue;
    }

    // DM verschicken. Wir nutzen dieselbe "private Antwort"-API wie bei der
    // Erst-DM: sie verwendet die commentId als Empfänger und funktioniert
    // deshalb im selben Sieben-Tage-Fenster. Dass die Person darauf antworten
    // muss, um ein 24-Stunden-Fenster zu öffnen, ist hier egal - wir nutzen
    // gar nicht dieses Fenster.
    try {
      await sendePrivateAntwort(
        zeile.id,
        formuliereNachfass(zeile.name, zeile.couponCode, spracheFuer(zeile.mediaId, sprachen)),
      );
      await prisma.instagramComment.update({
        where: { id: zeile.id },
        data: { nachgefasstAm: new Date() },
      });
      abschluesse.push({ commentId: zeile.id, ergebnis: "nachgefasst" });
    } catch (fehler) {
      const text = fehler instanceof Error ? fehler.message : String(fehler);
      // 400 von Meta heisst meist: das Fenster ist zu. Dann setzen wir den
      // Zeitstempel trotzdem, damit die Zeile nicht bei jedem Lauf denselben
      // Fehler produziert. Andere Fehler bleiben offen und werden erneut
      // versucht.
      const fensterZu = /\b400\b/.test(text) || /window/i.test(text);
      if (fensterZu) {
        await prisma.instagramComment.update({
          where: { id: zeile.id },
          data: { nachgefasstAm: new Date() },
        });
      }
      abschluesse.push({
        commentId: zeile.id,
        ergebnis: "keine_dm_moeglich",
        hinweis: text,
      });
    }
  }

  return abschluesse;
}

export type ErinnerungsAbschluss = {
  commentId: string;
  ergebnis: "erinnert" | "eingeloest" | "keine_dm_moeglich" | "fehler";
  hinweis?: string;
};

/**
 * Erinnert an Codes, die kurz vor Ablauf stehen.
 *
 * Loss-Aversion: den letzten Anschub für Leute, die den Code erhalten, aber
 * nie eingelöst haben. Läuft im gleichen Fahrplan wie das Nachfassen, ist
 * aber ein eigener Zeitstempel - so gehen erste Erinnerung und Ablauf-
 * Erinnerung nicht zusammen, und man sieht im Dashboard, welche Zeile in
 * welcher Stufe hängt.
 *
 * Nur an Personen, die den Code tatsächlich per DM bekommen haben (nicht die
 * mit offenem Opt-in) und deren Code noch nicht als eingelöst gemeldet ist.
 * Vor der DM kurz bei Wix nachfragen, damit niemand eine Erinnerung für einen
 * bereits eingelösten Code bekommt.
 */
export async function erinnereBaldAblaufende(hoechstens = 20): Promise<ErinnerungsAbschluss[]> {
  const jetzt = Date.now();
  const gueltigTage = await holeAktiveGueltigTage();
  const fenster = erinnerungsFenster(gueltigTage);
  // Bei Gültigkeit < 4 oder > 7 Tagen läuft keine Erinnerung. Gar nicht erst
  // die DB fragen.
  if (!fenster) return [];

  const obereGrenze = new Date(jetzt - fenster.fruehestensH * 60 * 60 * 1000);
  const untereGrenze = new Date(jetzt - fenster.spaetestensH * 60 * 60 * 1000);

  const kandidaten = await prisma.instagramComment.findMany({
    where: {
      status: "verarbeitet",
      // Nur wer den Code auch in der Hand hatte - sonst wäre "dein Code X"
      // eine Nachricht ins Leere.
      codeGesendetAm: { not: null },
      couponCode: { not: null },
      couponId: { not: null },
      erinnerungGesendetAm: null,
      codeEingeloestAm: null,
      createdAt: { gte: untereGrenze, lte: obereGrenze },
    },
    orderBy: { createdAt: "asc" },
    take: hoechstens,
  });

  const rabatt = await holeAktivenRabatt();
  const sprachen = await ladeSprachen(kandidaten.map((z) => z.mediaId));
  const abschluesse: ErinnerungsAbschluss[] = [];

  for (const zeile of kandidaten) {
    if (!zeile.couponId || !zeile.couponCode || !zeile.name) continue;

    // Wie beim Nachfassen: zuerst Wix fragen. Eine Erinnerung an einen
    // bereits eingelösten Code sähe schlecht aus.
    let anzahl: number;
    try {
      anzahl = await nutzungen(zeile.couponId);
    } catch (fehler) {
      abschluesse.push({
        commentId: zeile.id,
        ergebnis: "fehler",
        hinweis: `Wix-Abfrage fehlgeschlagen: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
      });
      continue;
    }

    if (anzahl > 0) {
      await prisma.instagramComment.update({
        where: { id: zeile.id },
        // Auch hier beide Felder: eingelöst als eigener Datenpunkt, plus
        // Erinnerungs-Sperre, damit die Zeile nicht später nochmal aufpoppt.
        data: { codeEingeloestAm: new Date(), erinnerungGesendetAm: new Date() },
      });
      abschluesse.push({ commentId: zeile.id, ergebnis: "eingeloest" });
      continue;
    }

    // Restzeit bis zum tatsächlichen Ablauf, gerechnet ab Kommentar-Erstellung
    // plus Gültigkeitsdauer. Nie negativ (falls doch: der Nachfass-Text sagt
    // dann "läuft heute ab", was in Wahrheit "gerade eben abgelaufen" heisst -
    // ein akzeptabler Kompromiss gegenüber gar keiner Nachricht).
    const restStunden = Math.max(
      0,
      (zeile.createdAt.getTime() + gueltigTage * 24 * 60 * 60 * 1000 - jetzt) /
        (60 * 60 * 1000),
    );

    try {
      await sendePrivateAntwort(
        zeile.id,
        formuliereErinnerung(
          zeile.name,
          zeile.couponCode,
          rabatt,
          spracheFuer(zeile.mediaId, sprachen),
          restStunden,
        ),
      );
      await prisma.instagramComment.update({
        where: { id: zeile.id },
        data: { erinnerungGesendetAm: new Date() },
      });
      abschluesse.push({ commentId: zeile.id, ergebnis: "erinnert" });
    } catch (fehler) {
      const text = fehler instanceof Error ? fehler.message : String(fehler);
      // Wie beim Nachfassen: bei "Fenster zu" den Zeitstempel setzen, damit
      // die Zeile nicht bei jedem Lauf denselben Fehler produziert. Andere
      // Fehler bleiben offen.
      const fensterZu = /\b400\b/.test(text) || /window/i.test(text);
      if (fensterZu) {
        await prisma.instagramComment.update({
          where: { id: zeile.id },
          data: { erinnerungGesendetAm: new Date() },
        });
      }
      abschluesse.push({
        commentId: zeile.id,
        ergebnis: "keine_dm_moeglich",
        hinweis: text,
      });
    }
  }

  return abschluesse;
}
