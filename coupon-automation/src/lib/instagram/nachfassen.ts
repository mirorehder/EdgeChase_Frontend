import { prisma } from "../db";
import { nutzungen } from "../wix/coupons";
import { sendePrivateAntwort } from "./graph";

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
 * Wortlaut der Nachfass-DM.
 *
 * Bewusst kein Zwang und kein Zeitdruck - der Code läuft ohnehin nach sieben
 * Tagen ab, das reicht als Dringlichkeit. Der Ton bleibt derselbe wie in der
 * Erst-DM (englisch), damit die Nachricht wie eine Erinnerung im selben
 * Gespräch wirkt, nicht wie eine neue Aktion.
 */
function formuliereNachfass(name: string, code: string): string {
  return (
    `Hey ${name}, quick nudge — your code ${code} is still good on edgechase.com. ` +
    `If anything caught your eye, this is your window ✨`
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
