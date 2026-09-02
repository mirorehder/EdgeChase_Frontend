import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { formuliereAntwort, formuliereDm } from "@/lib/instagram/antwort";
import { ladeMedia } from "@/lib/instagram/graph";
import {
  istAktionsReel,
  leseNameAusHandle,
  leseNameAusText,
  spracheAusCaption,
} from "@/lib/instagram/namen";
import { GUTSCHEIN } from "@/lib/instagram/verarbeitung";
import { freierCode } from "@/lib/wix/coupons";

/**
 * Prüfstand für die Einrichtung.
 *
 * Jeder Teil der Kette lässt sich hier einzeln anfassen, ohne dass jemand
 * etwas davon mitbekommt: kein Gutschein wird angelegt, keine DM verschickt,
 * kein Kommentar beantwortet. Das ist wichtig, weil sich die Kette sonst erst
 * im Ernstfall prüfen liesse - und ein Fehler dann eine echte Person trifft.
 *
 * Aufrufe (jeweils mit ?secret=<CRON_SECRET>):
 *
 *   ?pruefe=env                      Welche Zugangsdaten sind hinterlegt?
 *   ?pruefe=wix                      Erreicht der API-Key die Gutscheine?
 *   ?pruefe=caption&mediaId=123      Gilt das Reel als Aktions-Reel?
 *   ?pruefe=name&text=Lars           Welcher Name wird gelesen?
 *   ?pruefe=antwort&name=Lars        Wie klingt eine erzeugte Antwort?
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Nur bestätigen, dass etwas hinterlegt ist - niemals den Wert selbst. */
function gesetzt(name: string): boolean {
  return Boolean(process.env[name]);
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;

  if (
    params.get("secret") !== env.cronSecret &&
    request.headers.get("x-api-key") !== env.cronSecret
  ) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const pruefe = params.get("pruefe") ?? "env";

  try {
    switch (pruefe) {
      case "env":
        return NextResponse.json({
          IG_ACCESS_TOKEN: gesetzt("IG_ACCESS_TOKEN"),
          IG_APP_SECRET: gesetzt("IG_APP_SECRET"),
          IG_WEBHOOK_VERIFY_TOKEN: gesetzt("IG_WEBHOOK_VERIFY_TOKEN"),
          WIX_API_KEY: gesetzt("WIX_API_KEY"),
          GEMINI_API_KEY: gesetzt("GEMINI_API_KEY"),
          CRON_SECRET: gesetzt("CRON_SECRET"),
          igUserId: env.igUserId,
          wixSiteId: env.wixSiteId,
          konditionen: GUTSCHEIN,
        });

      case "wix": {
        // Liest den Gutschein-Bestand und schlägt einen freien Code vor.
        // Angelegt wird nichts - der Aufruf beweist nur, dass Key, Site-ID
        // und Berechtigung zusammenpassen.
        const wunsch = params.get("code") ?? "Testname";
        return NextResponse.json({ wunsch, waere: await freierCode(wunsch) });
      }

      case "caption": {
        const mediaId = params.get("mediaId");
        if (!mediaId) {
          return NextResponse.json({ error: "mediaId fehlt." }, { status: 400 });
        }
        const { caption, permalink } = await ladeMedia(mediaId);
        return NextResponse.json({
          caption,
          permalink,
          istAktionsReel: istAktionsReel(caption),
          sprache: spracheAusCaption(caption),
        });
      }

      case "name": {
        const text = params.get("text") ?? "";
        const handle = params.get("handle") ?? undefined;
        const ausText = leseNameAusText(text);
        return NextResponse.json({
          text,
          handle,
          ausText,
          ausHandle: leseNameAusHandle(handle),
          ergebnis: ausText ?? leseNameAusHandle(handle),
        });
      }

      case "antwort": {
        const name = params.get("name") ?? "Lars";
        const sprache = params.get("sprache") === "de" ? "de" : "en";
        const dmGelungen = params.get("dm") !== "0";

        // Dreimal, damit sich beurteilen lässt, ob die Antworten tatsächlich
        // auseinandergehen - eine einzelne sagt darüber nichts.
        const antworten: string[] = [];
        for (let i = 0; i < 3; i++) {
          antworten.push(
            await formuliereAntwort({ name, sprache, zuletzt: antworten, dmGelungen }),
          );
        }

        return NextResponse.json({
          dm: formuliereDm(name, name.toUpperCase(), GUTSCHEIN.prozent),
          antworten,
        });
      }

      default:
        return NextResponse.json({ error: `Unbekannte Prüfung: ${pruefe}` }, { status: 400 });
    }
  } catch (fehler) {
    return NextResponse.json(
      { error: fehler instanceof Error ? fehler.message : String(fehler) },
      { status: 500 },
    );
  }
}
