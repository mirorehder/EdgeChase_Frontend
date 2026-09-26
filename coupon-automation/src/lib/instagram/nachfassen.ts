import { prisma } from "../db";
import { env } from "../env";
import { nutzungen } from "../wix/coupons";
import { sendePrivateAntwort } from "./graph";
import { holeAktivenRabatt } from "./verarbeitung";

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
 * Zeitfenster für die Ablauf-Erinnerung.
 *
 * Der Gutschein läuft 7 Tage (168 h) nach der Erstellung. Die Erinnerung soll
 * ungefähr 12 h vor Schluss rausgehen - aber der Zeitplan feuert nicht
 * sekundengenau, und die Zeile darf nicht zwischen zwei Läufen durchrutschen.
 * Deshalb ein Fenster von 144 h bis 164 h Alter: der Aufräum-Lauf hat rund
 * einen Tag Zeit, die Zeile zu greifen, und die letzten vier Stunden bleiben
 * als Puffer gegen Metas 7-Tage-Frist frei.
 */
const ERINNERUNG_FRUEHESTENS_H = 6 * 24;
const ERINNERUNG_SPAETESTENS_H = 7 * 24 - 4;

/**
 * Wortlaut der Nachfass-DM.
 *
 * Bewusst knapp - der Code läuft ohnehin nach sieben Tagen ab, das reicht als
 * Dringlichkeit. Der Ton bleibt derselbe wie in der Erst-DM (englisch), damit
 * die Nachricht wie eine Erinnerung im selben Gespräch wirkt.
 *
 * Ist ein WhatsApp-Kanal-Link hinterlegt, wird er als PS angehängt: da drüben
 * lassen sich Personen legitim ansprechen (Opt-in nach dem Beitritt), während
 * eine Wiederkontakt-DM auf Instagram nach Ablauf des Sieben-Tage-Fensters
 * ohnehin nicht mehr möglich wäre.
 */
function formuliereNachfass(name: string, code: string): string {
  return (
    `Hey ${name}, dein Code ${code} ist noch gültig auf edgechase.com ✨\n` +
    `PS: Unsere Herbst-Kollektion droppt bald — komm in unseren WhatsApp-Kanal, ` +
    `damit du sie als Erste*r siehst: ${env.whatsappChannelUrl}`
  );
}

/**
 * Wortlaut der Ablauf-Erinnerung.
 *
 * Wenige Stunden vor Schluss geht der Ton eine Spur direkter als beim
 * ersten Nachfass - "läuft heute ab" trägt sich selbst, und die Person
 * hat den Code bewusst nicht eingelöst, will aber vielleicht doch noch
 * zugreifen. Kurz halten, damit der Code als Blickfang stehen bleibt.
 */
function formuliereErinnerung(name: string, code: string, prozent: number): string {
  return (
    `${name}, letzte Erinnerung: dein Code ${code} (${prozent}% Rabatt) läuft heute ab. ` +
    `Schnapp dir noch was auf edgechase.com 🔥`
  );
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
      await sendePrivateAntwort(zeile.id, formuliereNachfass(zeile.name, zeile.couponCode));
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
  const obereGrenze = new Date(jetzt - ERINNERUNG_FRUEHESTENS_H * 60 * 60 * 1000);
  const untereGrenze = new Date(jetzt - ERINNERUNG_SPAETESTENS_H * 60 * 60 * 1000);

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

    try {
      await sendePrivateAntwort(zeile.id, formuliereErinnerung(zeile.name, zeile.couponCode, rabatt));
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
