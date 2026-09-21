/**
 * Die feste Wissensbasis des Partner-Bots: Konditionen, Willkommens-DM, FAQ,
 * Regeln, Datenschutz. Gemini bekommt daraus den passenden Ausschnitt und
 * antwortet ausschliesslich daraus - was hier nicht steht, beantwortet der Bot
 * nicht selbst, sondern eskaliert.
 *
 * Alle Texte zweisprachig (de/en), weil der Bot als Erstes nach der bevorzugten
 * Sprache fragt.
 */

export type Sprache = "de" | "en";

/** Die Konditionen des Programms - an einer Stelle, überall dieselben. */
export const PROGRAMM = {
  /** Provisionssatz als Anteil (0.15 = 15% auf den Netto-Warenwert). */
  provisionssatz: 0.15,
  /** Rabatt für die Käufer:in in Prozent. */
  kaeuferRabatt: 15,
  /** Auszahltag im Folgemonat. */
  auszahlungTag: 10,
} as const;

/**
 * Fassung der Teilnahmebedingungen. Bei inhaltlicher Änderung hochzählen -
 * so lässt sich später nachweisen, welche Fassung eine Person akzeptiert hat.
 */
export const AGB_VERSION = "2026-09-v1";

/**
 * Die Sprachfrage - immer zuerst, zweisprachig, und gibt sich sofort als Bot
 * zu erkennen (Meta-Vorgabe: keine Illusion menschlicher Identität).
 */
export const SPRACHFRAGE =
  "Hi! 👋 Ich bin der EdgeChase-Assistent — ein Bot, kein Mensch. / I'm the EdgeChase assistant — a bot, not a human.\n\n" +
  "Welche Sprache möchtest du? Antworte mit DE oder EN. / Which language do you prefer? Reply DE or EN.";

/** Die Willkommens-DM, sobald die Sprache feststeht. {name} wird ersetzt. */
export const WILLKOMMEN: Record<Sprache, (name: string) => string> = {
  de: (name) =>
    `Hey ${name}! Ich bin der EdgeChase-Assistent, kein Mensch — ich helfe dir beim Partner-Programm.\n\n` +
    `So läuft's:\n` +
    `• Dein persönlicher Code → 15% Rabatt für alle, die ihn nutzen\n` +
    `• Du bekommst 15% Provision auf jeden Kauf über deinen Code\n` +
    `• Auszahlung monatlich per TWINT oder Bank, kein Vertrag, kein Aufwand\n\n` +
    `Interessiert? Antworte mit "JA" — dann schicke ich dir deinen Code + die kurzen Teilnahmebedingungen als Link. ` +
    `Du willst lieber mit einem Menschen sprechen? Schreib "Miro bitte", dann übergebe ich.`,
  en: (name) =>
    `Hey ${name}! I'm the EdgeChase assistant, not a human — I help you with the partner programme.\n\n` +
    `Here's how it works:\n` +
    `• Your personal code → 15% off for everyone who uses it\n` +
    `• You earn 15% commission on every purchase made with your code\n` +
    `• Payout monthly via TWINT or bank transfer, no contract, no hassle\n\n` +
    `Interested? Reply "YES" — then I'll send you your code + the short terms as a link. ` +
    `Prefer to talk to a human? Type "Miro please" and I'll hand over.`,
};

/** Die Code-Auslieferung nach der Zustimmung. {name}, {code}, {regeln} ersetzt. */
export const CODE_AUSLIEFERUNG: Record<Sprache, (v: { name: string; code: string; regeln: string }) => string> = {
  de: ({ name, code, regeln }) =>
    `Willkommen an Bord, ${name}! 🎉\n\n` +
    `Dein persönlicher Code: ${code}\n` +
    `• Alle, die damit auf edgechase.com kaufen, bekommen 15% Rabatt\n` +
    `• Du bekommst 15% Provision auf den Netto-Warenwert jeder Bestellung über deinen Code\n` +
    `• Auszahlung monatlich am 10. für den Vormonat (ab CHF 20)\n\n` +
    `Teilnahmebedingungen (bitte einmal lesen): ${regeln}\n\n` +
    `Teile ihn per Story, DM oder WhatsApp — und kennzeichne Werbung als "Werbung". ` +
    `Fragen? Schreib einfach hier. Aussteigen? Antworte "beenden".`,
  en: ({ name, code, regeln }) =>
    `Welcome aboard, ${name}! 🎉\n\n` +
    `Your personal code: ${code}\n` +
    `• Anyone who buys on edgechase.com with it gets 15% off\n` +
    `• You earn 15% commission on the net item value of every order made with your code\n` +
    `• Payout monthly on the 10th for the previous month (from CHF 20)\n\n` +
    `Terms & conditions (please read once): ${regeln}\n\n` +
    `Share it via story, DM or WhatsApp — and label ads as "ad". ` +
    `Questions? Just message here. Want to stop? Reply "stop".`,
};

/** Bestätigung des Ausstiegs. */
export const BEENDET: Record<Sprache, string> = {
  de: "Alles klar, dein Code wird deaktiviert. Bereits verdiente Provisionen zahlen wir dir noch aus. Danke, dass du dabei warst! 🙌",
  en: "Got it, your code will be deactivated. We'll still pay out any commission you've already earned. Thanks for being part of it! 🙌",
};

/** Freundliche Absage, wenn die Person nicht mitmachen will. */
export const ABGELEHNT: Record<Sprache, string> = {
  de: "Kein Problem, danke für deine Rückmeldung! Falls du es dir anders überlegst, schreib einfach. ✌️",
  en: "No worries, thanks for letting me know! If you change your mind, just message me. ✌️",
};

/** Was die Person hört, wenn an einen Menschen übergeben wird. */
export const UEBERGABE: Record<Sprache, string> = {
  de: "Ich hole kurz einen Menschen dazu — Miro meldet sich hier bei dir. Einen Moment Geduld! 🙏",
  en: "Let me bring in a human — Miro will get back to you right here. Bear with us a moment! 🙏",
};

export type FaqEintrag = {
  thema: string;
  de: string;
  en: string;
};

/**
 * Die FAQ-Basis. Der Bot antwortet inhaltlich daraus - nicht wörtlich, aber
 * ohne über diese Fakten hinauszugehen. Kann er eine Frage hiermit nicht klar
 * beantworten, eskaliert er.
 */
export const FAQ: FaqEintrag[] = [
  {
    thema: "Wie viel verdiene ich?",
    de: "15% auf jeden Einkauf (Netto-Warenwert), der über deinen Code läuft.",
    en: "15% on every purchase (net item value) made with your code.",
  },
  {
    thema: "Wann kommt das Geld?",
    de: "Monatlich am 10. für den Vormonat, sobald mindestens CHF 20 zusammengekommen sind. Darunter wird ins nächste Monat übertragen.",
    en: "Monthly on the 10th for the previous month, once you've reached at least CHF 20. Below that it carries over to the next month.",
  },
  {
    thema: "Muss ich Steuern zahlen?",
    de: "Ja, du versteuerst die Provision als Nebeneinkommen selbst. Wir übernehmen keine sozialversicherungsrechtliche Meldung. Details in den Teilnahmebedingungen.",
    en: "Yes, you declare the commission as additional income yourself. We don't handle any social-security reporting. Details are in the terms.",
  },
  {
    thema: "Was passiert bei Retouren?",
    de: "Wenn ein Einkauf zurückgeht, wird die Provision auf den zurückerstatteten Anteil abgezogen. Wird im Abrechnungsmonat verrechnet, nicht rückwirkend zurückgefordert.",
    en: "If a purchase is returned, the commission on the refunded amount is deducted. It's offset in the billing month, not reclaimed retroactively.",
  },
  {
    thema: "Kann ich den Code weiterschicken?",
    de: 'Ja, per Story, DM, WhatsApp, wie du willst. Wichtig: wenn du damit öffentlich Werbung machst, kennzeichne es als "Werbung" oder "Anzeige" — steht auch in den Teilnahmebedingungen.',
    en: 'Yes, via story, DM, WhatsApp, however you like. Important: if you advertise publicly with it, label it as "ad" — this is also in the terms.',
  },
  {
    thema: "Kombinierbar mit anderen Aktionen?",
    de: "Nein, dein Code kombiniert nicht mit Sale-Preisen oder anderen Rabatt-Codes.",
    en: "No, your code doesn't combine with sale prices or other discount codes.",
  },
  {
    thema: "Wie kann ich aufhören?",
    de: 'Schreib mir "beenden" oder "stopp", dann wird dein Code deaktiviert. Bereits verdiente Provisionen werden noch ausbezahlt.',
    en: 'Message me "stop" or "quit" and your code will be deactivated. Any commission already earned will still be paid out.',
  },
  {
    thema: "Was, wenn jemand meinen Code missbraucht?",
    de: "Melde es hier, dann sperren wir ihn.",
    en: "Report it here and we'll block it.",
  },
];

/**
 * Regeln & Datenschutz in Kurzform - Grundlage sowohl für die Bot-Antworten
 * als auch für die /regeln-Seite. Der Bot geht inhaltlich nicht darüber hinaus.
 */
export const REGELN: Record<Sprache, string[]> = {
  de: [
    "Du versteuerst die Provision selbst als Nebeneinkommen. EdgeChase übernimmt keine sozialversicherungsrechtliche Meldung.",
    "Die Provision je Person ist auf einen kleinen Jahresbetrag begrenzt (unter der AHV-Meldegrenze).",
    'Öffentliche Werbung mit deinem Code ist als "Werbung" oder "Anzeige" zu kennzeichnen.',
    "Dein Code kombiniert nicht mit Sale-Preisen oder anderen Rabatt-Codes.",
    "Datenschutz: Wir speichern deine Daten ausschliesslich zur Provisionsabrechnung, geben sie nicht weiter und löschen sie auf Anfrage.",
    "Auszahlung monatlich am 10. für den Vormonat ab CHF 20, per TWINT oder Bank.",
    'Aussteigen jederzeit mit "beenden" — bereits verdiente Provisionen werden ausbezahlt.',
  ],
  en: [
    "You declare the commission as additional income yourself. EdgeChase does not handle any social-security reporting.",
    "The commission per person is capped at a small yearly amount (below the Swiss AHV reporting threshold).",
    'Public advertising with your code must be labelled as "ad".',
    "Your code doesn't combine with sale prices or other discount codes.",
    "Data protection: we store your data solely for commission accounting, never share it, and delete it on request.",
    "Payout monthly on the 10th for the previous month from CHF 20, via TWINT or bank.",
    'Leave any time by replying "stop" — commission already earned will be paid out.',
  ],
};
