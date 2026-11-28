/**
 * DM-Texte für die Interaktions-Kampagne.
 *
 * Drei Situationen:
 *   1. Code-DM  — Person folgt, Code wird zugestellt.
 *   2. Folge-DM — Person folgt nicht, bitte zuerst folgen.
 *   3. Fallback  — Follow-Status nicht ermittelbar, freundliche Rückfrage.
 *
 * Alle Texte auf Deutsch und Englisch. Sprache wird aus dem Reel-Datensatz
 * übernommen (sprache-Feld), da die Caption des Interaktions-Reels dieselbe
 * Sprach-Erkennung durchläuft wie ein Namens-Reel.
 */

/** Uhrzeit-String im Format HH:MM aus einem Date-Objekt. */
function uhrzeit(d: Date): string {
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Die Code-DM — wird verschickt, sobald die Follow-Prüfung positiv ausfällt.
 *
 * Enthält den Namen (falls bekannt), den Code, den exakten Ablaufzeitpunkt
 * ("bis morgen HH:MM Uhr") und den Shop-Link.
 */
export function formuliereInteraktionCode(
  name: string | null,
  code: string,
  prozent: number,
  gueltigBis: Date,
  sprache: "de" | "en" = "de",
): string {
  const anrede = name ? `Hey ${name}!` : "Hey!";
  const ablauf = uhrzeit(gueltigBis);

  if (sprache === "de") {
    return (
      `${anrede} 🎉 Hier ist dein persönlicher Code: ${code}\n\n` +
      `Er gibt dir ${prozent}% Rabatt beim Checkout auf www.edgechase.com – ` +
      `gilt die nächsten 24 Stunden, bis morgen ${ablauf} Uhr. Have fun! 🛒`
    );
  }
  return (
    `${anrede} 🎉 Here's your personal code: ${code}\n\n` +
    `Use it for ${prozent}% off at checkout on www.edgechase.com – ` +
    `valid for the next 24 hours, until tomorrow at ${ablauf}. Happy shopping! 🛒`
  );
}

/**
 * Folge-DM — Person folgt dem Konto noch nicht.
 *
 * Freundlich, kurz, kein Druck. Bittet explizit darum, danach kurz zu
 * antworten, damit das 24-Stunden-Fenster offen bleibt.
 */
export function formuliereInteraktionFolge(
  name: string | null,
  prozent: number,
  sprache: "de" | "en" = "de",
): string {
  const anrede = name ? `Hey ${name}!` : "Hey!";

  if (sprache === "de") {
    return (
      `${anrede} 👋 Folge uns zuerst kurz auf Instagram – ` +
      `dann antworte hier einfach mit einem kurzen "Done" und dein ${prozent}%-Code ist sofort unterwegs! 🎁`
    );
  }
  return (
    `${anrede} 👋 Follow us on Instagram first – ` +
    `then just reply here with "Done" and your ${prozent}% code is on its way! 🎁`
  );
}

/**
 * Fallback-DM — Follow-Status war nicht abfragbar (privates Profil o. Ä.).
 *
 * Fragt höflich nach, ob die Person dem Konto folgt. Wird nur eingesetzt,
 * wenn die Graph-API keinen Wert zurückliefert.
 */
export function formuliereInteraktionFallback(
  name: string | null,
  prozent: number,
  sprache: "de" | "en" = "de",
): string {
  const anrede = name ? `Hey ${name}!` : "Hey!";

  if (sprache === "de") {
    return (
      `${anrede} 🙌 Folgst du uns schon auf Instagram? ` +
      `Wenn ja, antworte kurz mit "Ja" – dann schick ich dir sofort deinen ${prozent}%-Code! 🎁`
    );
  }
  return (
    `${anrede} 🙌 Are you already following us on Instagram? ` +
    `If yes, just reply with "Yes" and I'll send your ${prozent}% code right away! 🎁`
  );
}
