"use client";

import { useState } from "react";
import type { Track } from "@/lib/trackClient";

/**
 * Die Posting-Übersicht einer Sparte: was automatisch gepostet wurde und was
 * die Automatik zuletzt versucht hat.
 *
 * Zwei Blöcke, weil es zwei Fragen sind:
 *
 *  - "Wann wurde was gepostet?" - die tatsächlichen Posts, mit Schweizer
 *    Uhrzeit, Sound und Media-ID. Das ist die dauerhafte Historie.
 *  - "Warum ist gerade nichts rausgegangen?" - der Ausgang der letzten
 *    Post-Versuche. Ohne diesen Block hinterliess ein übersprungener oder
 *    gescheiterter Post keine Spur (kein Sound, keine öffentliche Kopie ...).
 *    Jetzt steht der Grund hier.
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
  const [offen, setOffen] = useState(false);

  const zusammenfassung = posts.length === 0
    ? "noch nichts gepostet"
    : `${posts.length} gepostet`;

  return (
    <section className="post-historie">
      <button className="abschnitt-titel" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
        Automatisch gepostet
        <span className="ordner-zahl">{zusammenfassung}</span>
      </button>

      {offen && (
        <>
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

          <h3 className="historie-unter">Letzte Post-Versuche</h3>
          {laeufe.length === 0 ? (
            <p className="empty-state small">
              Noch kein Post-Versuch protokolliert. Jeder Versuch nach dem
              Erstellen eines Videos wird hier festgehalten - auch wenn er
              gescheitert ist oder übersprungen wurde.
            </p>
          ) : (
            <ul className="lauf-liste">
              {laeufe.map((l) => (
                <li key={l.id} className={l.gepostet ? "lauf-post" : "lauf-leer"}>
                  <span className="lauf-zeit">{l.zeit}</span>
                  <span className="lauf-text">
                    {l.gepostet
                      ? `gepostet${l.titel ? `: „${l.titel}"` : ""}`
                      : l.grund ?? "nichts zu tun"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
