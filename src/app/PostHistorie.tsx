import type { Track } from "@/lib/trackClient";

/**
 * Die Posting-Übersicht einer Sparte: was automatisch gepostet wurde und was
 * die Automatik zuletzt geprüft hat.
 *
 * Zwei Blöcke, weil es zwei Fragen sind:
 *
 *  - "Wann wurde was gepostet?" - die tatsächlichen Posts, mit Schweizer
 *    Uhrzeit, Sound und Media-ID. Das ist die dauerhafte Historie.
 *  - "Warum ist gerade nichts rausgegangen?" - der Ausgang der letzten
 *    Pinger-Prüfungen. Ohne diesen Block hinterliess ein Lauf, der nichts zu
 *    posten fand, keine Spur; "um 10:00 wurde nichts gepostet" war damit von
 *    aussen nicht zu erklären. Jetzt steht der Grund hier.
 *
 * Reine Anzeige - die Zeiten sind schon serverseitig in CH-Zeit formatiert.
 */

export interface PostHistorieEintrag {
  id: string;
  zeit: string;
  titel: string;
  mediaId: string | null;
  sound: string | null;
  herkunft: string;
  driveUrl: string | null;
}

export interface PostLaufEintrag {
  id: string;
  zeit: string;
  gepostet: boolean;
  grund: string | null;
  titel: string | null;
}

export function PostHistorie({
  posts,
  laeufe,
}: {
  track: Track;
  posts: PostHistorieEintrag[];
  laeufe: PostLaufEintrag[];
}) {
  return (
    <section className="post-historie">
      <h2>Automatisch gepostet</h2>

      {posts.length === 0 ? (
        <p className="empty-state">
          Noch nichts automatisch gepostet. Sobald die Automatik ein Video
          veröffentlicht, erscheint es hier mit Uhrzeit (CH), Sound und Media-ID.
        </p>
      ) : (
        <ul className="historie-liste">
          {posts.map((p) => (
            <li key={p.id} className="historie-zeile">
              <span className="historie-zeit">{p.zeit}</span>
              <span className="historie-mitte">
                <span className="historie-titel">
                  {p.driveUrl ? (
                    <a href={p.driveUrl} target="_blank" rel="noreferrer">
                      {p.titel}
                    </a>
                  ) : (
                    p.titel
                  )}
                </span>
                <span className="historie-details">
                  {p.herkunft === "scheduled" ? "Tageslauf" : "Handversuch"}
                  {p.sound ? ` · Sound: ${p.sound}` : ""}
                  {p.mediaId ? ` · Media-ID ${p.mediaId}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="historie-unter">Letzte Automatik-Prüfungen</h3>
      {laeufe.length === 0 ? (
        <p className="empty-state small">
          Noch keine Prüfung protokolliert. Der externe Wecker ruft die
          Posting-Route auf; jeder Aufruf wird hier festgehalten - auch wenn
          nichts zu posten war.
        </p>
      ) : (
        <ul className="lauf-liste">
          {laeufe.map((l) => (
            <li key={l.id} className={l.gepostet ? "lauf-post" : "lauf-leer"}>
              <span className="lauf-zeit">{l.zeit}</span>
              <span className="lauf-text">
                {l.gepostet
                  ? `gepostet${l.titel ? `: „${l.titel}“` : ""}`
                  : l.grund ?? "nichts zu tun"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
