import { AGB_VERSION, FAQ, PROGRAMM, REGELN } from "@/lib/programm/wissensbasis";

/**
 * Öffentliche Teilnahmebedingungen des Partner-Programms. Diese URL verlinkt
 * die Onboarding-DM; mit dem Zustimmungsklick ("JA") gilt sie als akzeptiert
 * (die Fassung wird je Person in Partner.agbVersion festgehalten).
 *
 * Inhaltlich aus derselben Wissensbasis wie die Bot-Antworten - so kann die
 * Seite nichts anderes versprechen als der Bot sagt.
 */
export const metadata = {
  title: "Teilnahmebedingungen — EdgeChase Partner-Programm",
};

export default function RegelnSeite() {
  return (
    <main>
      <h1>Teilnahmebedingungen — Partner-Programm</h1>
      <p className="subtitle">
        Fassung {AGB_VERSION}. Mit deiner Zustimmung im Chat akzeptierst du diese Bedingungen.
      </p>

      <h2 className="abschnitt-titel">So funktioniert&apos;s</h2>
      <ul className="ig-gruende">
        <li>
          Du bekommst einen persönlichen Rabatt-Code. Wer damit auf edgechase.com kauft, erhält{" "}
          <strong>{PROGRAMM.kaeuferRabatt}% Rabatt</strong>.
        </li>
        <li>
          Du erhältst <strong>{Math.round(PROGRAMM.provisionssatz * 100)}% Provision</strong> auf den
          Netto-Warenwert jeder Bestellung, die über deinen Code läuft.
        </li>
        <li>
          Auszahlung monatlich am {PROGRAMM.auszahlungTag}. für den Vormonat, ab CHF 20, per TWINT
          oder Bank. Darunter wird übertragen.
        </li>
      </ul>

      <h2 className="abschnitt-titel">Regeln</h2>
      <ul className="ig-gruende">
        {REGELN.de.map((regel, i) => (
          <li key={i}>{regel}</li>
        ))}
      </ul>

      <h2 className="abschnitt-titel">Datenschutz</h2>
      <ul className="ig-gruende">
        <li>
          <strong>Zweckbindung:</strong> Wir speichern deine Instagram-Kennung, deinen Code und die
          Konversation ausschliesslich zur Abwicklung und Abrechnung des Partner-Programms.
        </li>
        <li>
          <strong>Keine Weitergabe:</strong> Deine Daten werden nicht an Dritte weitergegeben oder
          zu anderen Zwecken verwendet.
        </li>
        <li>
          <strong>Löschrecht:</strong> Auf Anfrage löschen wir alle deine Daten. Schreib uns dazu
          einfach per DM &quot;löschen&quot;.
        </li>
        <li>
          <strong>Bot-Hinweis:</strong> Die Erstbetreuung übernimmt ein automatischer Assistent
          (Bot). Er gibt sich als solcher zu erkennen; für alles Weitere übernimmt ein Mensch.
        </li>
      </ul>

      <h2 className="abschnitt-titel">Häufige Fragen</h2>
      <ul className="ig-gruende">
        {FAQ.map((eintrag) => (
          <li key={eintrag.thema}>
            <strong>{eintrag.thema}</strong> {eintrag.de}
          </li>
        ))}
      </ul>

      <p className="subtitle" style={{ marginTop: 40 }}>
        Fragen? Schreib uns per Instagram-DM. Aussteigen jederzeit mit &quot;beenden&quot;.
      </p>
    </main>
  );
}
