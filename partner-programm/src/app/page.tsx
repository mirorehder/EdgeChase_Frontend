import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { istEffektivAufruf } from "@/lib/programm/verarbeitung";
import { monatVon, rundeChf } from "@/lib/programm/provision";
import { PROGRAMM } from "@/lib/programm/wissensbasis";
import { PartnerAktionen } from "./PartnerAktionen";
import { PushEinrichten } from "./PushEinrichten";
import { Schalter } from "./Schalter";
import { Uebersteuerung } from "./Uebersteuerung";

/**
 * Das Betreiber-Dashboard des Partner-Programms.
 *
 * Zeigt je Person Code, Einlösungen, Umsatz, offene Provision und Status,
 * den Konversations-Verlauf mit dem Bot, und die Reels, die als Partner-Aufruf
 * gelten. Eskalationen stehen ganz oben - dort muss der Betreiber ran.
 */
export const dynamic = "force-dynamic";

/** Zustände, in denen eine Person als aktive:r Partner:in zählt. */
const AKTIVE_ZUSTAENDE = ["zustimmung_erhalten", "frage_offen"];

/** Interne Zwischenzustände, die im Dashboard nicht als Partner auftauchen. */
const VERBORGENE_ZUSTAENDE = ["neu", "inArbeit", "verworfen"];

function zeitLesbar(datum: Date): string {
  return datum.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    sprache_offen: "Sprachfrage",
    angeschrieben: "angeschrieben",
    zustimmung_erhalten: "aktiv",
    frage_offen: "aktiv (Frage offen)",
    eskaliert: "eskaliert",
    abgelehnt: "abgelehnt",
    beendet: "beendet",
  };
  return map[status] ?? status;
}

export default async function StartSeite() {
  const jetzt = new Date();
  const aktuellerMonat = monatVon(jetzt);
  const jahr = jetzt.getFullYear();

  const [config, partner, medien] = await Promise.all([
    prisma.partnerConfig.findUnique({ where: { id: "default" } }),
    prisma.partner.findMany({
      where: { status: { notIn: VERBORGENE_ZUSTAENDE } },
      orderBy: { updatedAt: "desc" },
      include: {
        nachrichten: { orderBy: { createdAt: "asc" } },
        bestellungen: true,
        auszahlungen: true,
      },
    }),
    prisma.partnerMedia.findMany({ orderBy: { aktualisiertAm: "desc" } }),
  ]);

  const wartend = await prisma.partner.count({ where: { status: "neu" } });

  // Kennzahlen je Person vorrechnen.
  const aufbereitet = partner.map((p) => {
    const nichtStorniert = p.bestellungen.filter((b) => !b.storniert);
    const umsatz = rundeChf(nichtStorniert.reduce((s, b) => s + Number(b.bestellwertNetto), 0));
    const provisionGesamt = rundeChf(nichtStorniert.reduce((s, b) => s + Number(b.provision), 0));
    const jahresProvision = rundeChf(
      nichtStorniert
        .filter((b) => b.monat.startsWith(String(jahr)))
        .reduce((s, b) => s + Number(b.provision), 0),
    );
    const monatProvision = rundeChf(
      nichtStorniert
        .filter((b) => b.monat === aktuellerMonat)
        .reduce((s, b) => s + Number(b.provision), 0),
    );
    const ausgezahlt = rundeChf(
      p.auszahlungen
        .filter((a) => a.status === "ausgezahlt")
        .reduce((s, a) => s + Number(a.betrag), 0),
    );
    const offen = rundeChf(provisionGesamt - ausgezahlt);
    return {
      p,
      einloesungen: nichtStorniert.length,
      umsatz,
      provisionGesamt,
      jahresProvision,
      monatProvision,
      offen,
      deckelNah: jahresProvision >= env.jahresDeckelChf * 0.8,
    };
  });

  const aktive = aufbereitet.filter((a) => AKTIVE_ZUSTAENDE.includes(a.p.status) && !a.p.gesperrt);
  const eskalierte = aufbereitet.filter((a) => a.p.status === "eskaliert");
  const gesamtProvisionOffen = rundeChf(aufbereitet.reduce((s, a) => s + a.offen, 0));
  const monatProvisionGesamt = rundeChf(aufbereitet.reduce((s, a) => s + a.monatProvision, 0));

  const aktiveMedien = medien.filter(istEffektivAufruf);
  const andereMedien = medien.filter((m) => !istEffektivAufruf(m)).slice(0, 15);

  return (
    <main>
      <h1>Partner-Programm</h1>
      <p className="subtitle">
        Wer auf ein Partner-Aufruf-Reel reagiert oder danach fragt, wird vom Bot durch das
        Onboarding geführt: Sprache, Zustimmung, persönlicher Code ({PROGRAMM.kaeuferRabatt}% Rabatt
        für Käufer:innen, {Math.round(PROGRAMM.provisionssatz * 100)}% Provision). Bei Unklarheit,
        Beschwerde oder grossem Betrag eskaliert er an dich.
      </p>

      <Schalter start={config?.enabled ?? true} wartend={wartend} />

      {env.vapidPublicKey && <PushEinrichten vapidPublicKey={env.vapidPublicKey} />}

      {eskalierte.length > 0 && (
        <div className="ig-fehlerkasten">
          <strong>
            {eskalierte.length} {eskalierte.length === 1 ? "Eskalation" : "Eskalationen"} — bitte
            übernehmen
          </strong>
          <ul>
            {eskalierte.map((a) => (
              <li key={a.p.id}>
                {a.p.name ?? a.p.igUsername ?? a.p.igUserId} — {a.p.eskalationsGrund ?? "ohne Grund"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="value">{aktive.length}</div>
          <div className="label">Aktive Partner:innen</div>
        </div>
        <div className="stat-card">
          <div className="value">{aufbereitet.length}</div>
          <div className="label">Personen insgesamt</div>
        </div>
        <div className="stat-card">
          <div className="value">CHF {monatProvisionGesamt.toFixed(2)}</div>
          <div className="label">Provision {aktuellerMonat}</div>
        </div>
        <div className="stat-card">
          <div className="value">CHF {gesamtProvisionOffen.toFixed(2)}</div>
          <div className="label">Offene Provision</div>
        </div>
        <div className="stat-card">
          <div className="value">{eskalierte.length}</div>
          <div className="label">Eskaliert</div>
        </div>
      </div>

      <h2 className="abschnitt-titel">Partner:innen</h2>
      {aufbereitet.length === 0 ? (
        <p className="empty-state">Noch niemand im Programm.</p>
      ) : (
        aufbereitet.map((a) => (
          <div className="pp-partner" key={a.p.id} id={a.p.id}>
            <div className="pp-partner-kopf">
              <span className="pp-partner-name">
                {a.p.name ?? a.p.igUsername ?? a.p.igUserId}
              </span>
              <span className={`pp-status pp-status-${a.p.status}`}>{statusLabel(a.p.status)}</span>
              {a.p.gesperrt && <span className="pp-gesperrt">gesperrt</span>}
              {a.p.couponCode && <code>{a.p.couponCode}</code>}
              <span className="ig-schwach">
                {a.p.quelle === "kommentar" ? "aus Kommentar" : "aus DM"}
                {a.p.sprache ? ` · ${a.p.sprache.toUpperCase()}` : ""}
              </span>
            </div>

            <div className="pp-zahlen">
              <div>
                <div className="pp-zahl-wert">{a.einloesungen}</div>
                <div className="pp-zahl-label">Einlösungen</div>
              </div>
              <div>
                <div className="pp-zahl-wert">CHF {a.umsatz.toFixed(2)}</div>
                <div className="pp-zahl-label">Umsatz (netto)</div>
              </div>
              <div>
                <div className="pp-zahl-wert">CHF {a.offen.toFixed(2)}</div>
                <div className="pp-zahl-label">offene Provision</div>
              </div>
              <div>
                <div className="pp-zahl-wert" style={a.deckelNah ? { color: "var(--warn)" } : undefined}>
                  CHF {a.jahresProvision.toFixed(2)} / {env.jahresDeckelChf}
                </div>
                <div className="pp-zahl-label">Provision {jahr} (Jahres-Deckel)</div>
              </div>
            </div>

            {a.p.eskalationsGrund && a.p.status === "eskaliert" && (
              <div className="ig-warnung">Eskalation: {a.p.eskalationsGrund}</div>
            )}

            {a.p.nachrichten.length > 0 && (
              <details className="pp-verlauf">
                <summary>{a.p.nachrichten.length} Nachrichten anzeigen</summary>
                {a.p.nachrichten.map((n) => (
                  <div
                    key={n.id}
                    className={`pp-nachricht ${n.richtung === "eingehend" ? "pp-eingehend" : "pp-ausgehend"}`}
                  >
                    {n.text}
                    <div className="pp-nachricht-meta">
                      {zeitLesbar(n.createdAt)}
                      {n.klassifikation ? ` · ${n.klassifikation}` : ""}
                      {n.sicherheit !== null ? ` · ${Math.round(n.sicherheit * 100)}%` : ""}
                    </div>
                  </div>
                ))}
              </details>
            )}

            <PartnerAktionen
              partnerId={a.p.id}
              gesperrt={a.p.gesperrt}
              eskaliert={a.p.status === "eskaliert"}
            />
          </div>
        ))
      )}

      <h2 className="abschnitt-titel">Partner-Aufruf-Reels</h2>
      {aktiveMedien.length === 0 ? (
        <p className="empty-state">
          Noch kein Reel als Partner-Aufruf erkannt. Das passiert beim ersten Kommentar darunter.
        </p>
      ) : (
        <div className="ig-reels">
          {aktiveMedien.map((media) => (
            <div className="ig-reel" key={media.id}>
              <div className="ig-reel-kopf">
                <span className="tag">{media.sprache.toUpperCase()}</span>
                {media.permalink ? (
                  <a href={media.permalink} target="_blank" rel="noreferrer">
                    Reel öffnen ↗
                  </a>
                ) : (
                  <span className="ig-schwach">{media.id}</span>
                )}
              </div>
              <div className="ig-reel-caption">{media.caption.split("\n")[0].slice(0, 120)}</div>
              {media.analyseHinweis && (
                <div className="ig-schwach">Erkennung: {media.analyseHinweis}</div>
              )}
              <Uebersteuerung
                mediaId={media.id}
                ueberschreibung={media.ueberschreibung}
                automatischErkannt={media.istAufruf}
              />
            </div>
          ))}
        </div>
      )}

      {andereMedien.length > 0 && (
        <>
          <h2 className="abschnitt-titel">Andere zuletzt gesehene Reels</h2>
          <p className="subtitle">
            Nicht als Partner-Aufruf erkannt. Gehört eines doch dazu, hier von Hand nachtragen.
          </p>
          <div className="ig-reels">
            {andereMedien.map((media) => (
              <div className="ig-reel" key={media.id}>
                <div className="ig-reel-kopf">
                  <span className="tag">{media.sprache.toUpperCase()}</span>
                  {media.permalink ? (
                    <a href={media.permalink} target="_blank" rel="noreferrer">
                      Reel öffnen ↗
                    </a>
                  ) : (
                    <span className="ig-schwach">{media.id}</span>
                  )}
                </div>
                <div className="ig-reel-caption">{media.caption.split("\n")[0].slice(0, 120)}</div>
                {media.analyseHinweis && (
                  <div className="ig-schwach">Erkennung: {media.analyseHinweis}</div>
                )}
                <Uebersteuerung
                  mediaId={media.id}
                  ueberschreibung={media.ueberschreibung}
                  automatischErkannt={media.istAufruf}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <p className="subtitle" style={{ marginTop: 40 }}>
        <a href="/regeln">Teilnahmebedingungen ansehen ↗</a>
      </p>
    </main>
  );
}
