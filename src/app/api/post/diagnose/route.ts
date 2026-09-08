import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { TRACK_LISTE } from "@/lib/trackClient";
import { igZugang, pruefeZugang } from "@/lib/instagram";
import { getPostZeitplan, naechstesVideo, letzteLaeufe, bestandDerSparte } from "@/lib/postAuto";
import { formatUhrzeit, chFormatZeitstempel } from "@/lib/zeit";

export const dynamic = "force-dynamic";

/**
 * Selbstauskunft der Posting-Automatik.
 *
 * Ausdruecklich KEINE Werte - die Tokens duerfen dieser Route nie entweichen.
 * Sie meldet nur, ob eine Umgebungsvariable im laufenden Prozess ankommt (was
 * fuer die haeufigste Falle wichtig ist: eine Variable, die nur fuer
 * "Preview" oder "Development" gesetzt wurde, taucht in "Production" nicht
 * auf; und eine gesetzte Variable wird erst mit dem naechsten Deploy sichtbar).
 *
 * Zusaetzlich: der Zeitplanstand und die Anzahl postbarer Videos je Sparte -
 * dann sieht man auf einen Blick, warum die Automatik gerade nichts postet.
 *
 * Geschuetzt ueber dasselbe Geheimnis wie der Pinger.
 */
export async function GET(request: NextRequest) {
  const ausHeader = request.headers.get("authorization");
  const ausQuery = request.nextUrl.searchParams.get("secret");
  const erlaubt = ausHeader === `Bearer ${env.cronSecret}` || ausQuery === env.cronSecret;
  if (!erlaubt) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const sparten = await Promise.all(
    TRACK_LISTE.map(async (b) => {
      const suffix = b.key.toUpperCase();
      const varToken = `IG_TOKEN_${suffix}`;
      const varUserId = `IG_USER_ID_${suffix}`;
      const zeitplan = await getPostZeitplan(b.key);
      const kandidat = zeitplan.enabled ? await naechstesVideo(b.key, zeitplan.quelle) : null;
      const zugang = igZugang(b.key);
      const laeufe = await letzteLaeufe(b.key, 1);
      const letzterLauf = laeufe[0] ?? null;
      const bestand = await bestandDerSparte(b.key);
      // Live prüfen, ob der Token wirklich trägt - nicht nur, ob er gesetzt ist.
      const tokenPruefung = zugang ? await pruefeZugang(zugang) : null;

      return {
        sparte: b.key,
        label: b.label,
        // Nur die Anwesenheit, nicht der Wert.
        hatToken: !!process.env[varToken] || !!process.env.IG_TOKEN,
        hatUserId: !!process.env[varUserId] || !!process.env.IG_USER_ID,
        // Wenn keine sparten-eigene Variable da ist, faellt es auf den
        // allgemeinen Rueckfall zurueck - fuer den Nutzer sichtbar.
        rueckfallBenutzt:
          (!process.env[varToken] && !!process.env.IG_TOKEN) ||
          (!process.env[varUserId] && !!process.env.IG_USER_ID),
        erwarteteVariablen: { token: varToken, userId: varUserId },
        wuerdeEchtePosten: !!zugang, // Zugang aufloesbar? (Trockenlauf sonst)
        // Die entscheidende Auskunft: gilt der Token bei Instagram wirklich?
        tokenGueltig: tokenPruefung ? tokenPruefung.ok : null,
        tokenKonto: tokenPruefung?.konto ?? null,
        tokenFehler: tokenPruefung && !tokenPruefung.ok ? tokenPruefung.fehler : null,
        zeitplan: {
          an: zeitplan.enabled,
          // Welche Betriebsart greift - genau das war bei "10:00 hat nicht
          // gepostet" die Frage: feste Uhrzeiten oder das alte Fenster?
          modus: zeitplan.postingTimes.length > 0 ? "uhrzeiten" : "fenster",
          uhrzeiten: zeitplan.postingTimes.map(formatUhrzeit),
          postsProTag: zeitplan.postsPerDay,
          fensterVon: zeitplan.fensterVonMin,
          fensterBis: zeitplan.fensterBisMin,
          abstandMin: zeitplan.minAbstandMin,
          quelle: zeitplan.quelle,
        },
        naechsterKandidat: kandidat
          ? {
              id: kandidat.id,
              titel: kandidat.fileTitle ?? kandidat.hookText.slice(0, 60),
              hatOeffentlicheKopie: !!kandidat.publicUrl,
            }
          : null,
        // Bestandsaufnahme: wie viele Videos in welchem Zustand, und welche
        // fertigen noch offen sind. Zeigt, warum "ich habe X generiert" und
        // "Y sind postbar" auseinanderfallen.
        bestand,
        // Der letzte protokollierte Ausgang der Automatik - beweist, ob der
        // Pinger überhaupt läuft, und nennt den Grund fürs Nichtstun.
        letzterLauf: letzterLauf
          ? {
              wann: chFormatZeitstempel(letzterLauf.at),
              gepostet: letzterLauf.gepostet,
              grund: letzterLauf.grund,
            }
          : null,
      };
    }),
  );

  // Nur die NAMEN, keine Werte - damit sich sofort sehen laesst, ob die
  // Variablen unter den erwarteten Bezeichnern angekommen sind oder unter
  // welchen anderen.
  const alleIgVariablen = Object.keys(process.env)
    .filter((k) => k.startsWith("IG_"))
    .sort();

  return NextResponse.json({
    allgemeinerRueckfall: {
      hatToken: !!process.env.IG_TOKEN,
      hatUserId: !!process.env.IG_USER_ID,
      variablen: { token: "IG_TOKEN", userId: "IG_USER_ID" },
    },
    alleIgVariablenImProzess: alleIgVariablen,
    erwarteteVariablen: [
      "IG_TOKEN_VIRAL",
      "IG_USER_ID_VIRAL",
      "IG_TOKEN_PROMO",
      "IG_USER_ID_PROMO",
      "IG_TOKEN_SPORTS",
      "IG_USER_ID_SPORTS",
      "IG_TOKEN_CLOTHING",
      "IG_USER_ID_CLOTHING",
      "IG_TOKEN (Rueckfall)",
      "IG_USER_ID (Rueckfall)",
    ],
    cronGeheimnis: { hatCronSecret: !!process.env.CRON_SECRET },
    // Vercel setzt diese beim Build - dann laesst sich am Commit ablesen, ob
    // die neue Version wirklich live ist.
    deploy: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      wann: process.env.VERCEL_DEPLOYMENT_BUILT_AT ?? null,
    },
    sparten,
  });
}
