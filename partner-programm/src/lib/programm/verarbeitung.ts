import { prisma } from "../db";
import { env } from "../env";
import {
  antworteAufKommentar,
  ladeMedia,
  sendeDirektNachricht,
  sendePrivateAntwort,
  type WebhookKommentar,
  type EingehendeNachricht,
} from "../instagram/graph";
import { istPartnerAufruf, spracheAusCaption } from "../instagram/reelerkennung";
import { analysiereVideo } from "../instagram/videoanalyse";
import { sendePush } from "../push";
import { deaktiviereGutschein, erstellePartnerGutschein } from "../wix/coupons";
import {
  entscheide,
  istPartnerInteresse,
  SICHERHEITS_SCHWELLE,
  type BotEntscheidung,
} from "./bot";
import {
  ABGELEHNT,
  AGB_VERSION,
  BEENDET,
  CODE_AUSLIEFERUNG,
  SPRACHFRAGE,
  UEBERGABE,
  WILLKOMMEN,
  type Sprache,
} from "./wissensbasis";

/**
 * Die Ablauflogik des Partner-Automaten - Vorbild: verarbeitung.ts +
 * wiedersendung.ts des Coupon-Automaten, hier zum Onboarding-Zustandsautomaten
 * zusammengeführt.
 *
 * Zwei Eingänge:
 *  - Kommentare unter Partner-Aufruf-Reels (nimmKommentareAuf → verarbeiteNeue)
 *  - eingehende DMs (verarbeiteEingehendeNachricht)
 *
 * Getrennt von der Webhook-Route, weil Meta binnen Sekunden eine Antwort
 * erwartet, die Arbeit (Video-Analyse, Gutschein-Anlage, DM) aber länger
 * dauert.
 */

const MEDIA_FRISCH_MS = 24 * 60 * 60 * 1000;

/** So viele frühere Nachrichten bekommt der Bot als Verlauf. */
const VERLAUF_LAENGE = 8;

/** Ist der Automat eingeschaltet? Fehlt die Zeile, gilt er als eingeschaltet. */
export async function istEingeschaltet(): Promise<boolean> {
  const config = await prisma.partnerConfig.findUnique({ where: { id: "default" } });
  return config?.enabled ?? true;
}

/** Gilt das Reel als Partner-Aufruf - Übersteuerung geht vor Erkennung. */
export function istEffektivAufruf(media: {
  istAufruf: boolean;
  ueberschreibung: boolean | null;
}): boolean {
  return media.ueberschreibung ?? media.istAufruf;
}

/**
 * Einschätzung eines Reels, aus dem Zwischenspeicher oder frisch von Meta.
 * Beim ersten Auftauchen: Video-Analyse mit Gemini, Text-Erkennung als
 * Fallback, plus eine Push ans Dashboard.
 */
async function medienInfo(mediaId: string) {
  const bekannt = await prisma.partnerMedia.findUnique({ where: { id: mediaId } });

  if (bekannt && Date.now() - bekannt.aktualisiertAm.getTime() < MEDIA_FRISCH_MS) {
    return bekannt;
  }

  const { caption, permalink, videoUrl, mediaType } = await ladeMedia(mediaId);

  const istErstAnalyse = bekannt === null;
  let istAufruf = bekannt?.istAufruf ?? false;
  let analyseHinweis = bekannt?.analyseHinweis ?? null;

  if (istErstAnalyse) {
    const videoAntwort =
      videoUrl && (mediaType === "VIDEO" || mediaType === "REELS")
        ? await analysiereVideo(videoUrl, caption)
        : null;

    if (videoAntwort) {
      istAufruf = videoAntwort.istAufruf;
      analyseHinweis = `Video-Analyse: ${videoAntwort.begruendung}`;
    } else {
      istAufruf = istPartnerAufruf(caption);
      analyseHinweis = "Text-Erkennung (Video nicht analysierbar)";
    }
  }

  const captionDaten = { caption, permalink, sprache: spracheAusCaption(caption) };
  const media = await prisma.partnerMedia.upsert({
    where: { id: mediaId },
    create: { id: mediaId, ...captionDaten, istAufruf, analyseHinweis },
    update: captionDaten,
  });

  if (istErstAnalyse) {
    const kopfzeile = caption.split("\n")[0].slice(0, 80).trim() || "(ohne Text)";
    const status = istAufruf ? "als Partner-Aufruf erkannt" : "nicht als Partner-Aufruf erkannt";
    await sendePush({
      titel: `Neues Reel: ${status}`,
      rumpf: kopfzeile,
      url: "/",
    }).catch((fehler) => console.error("Push für neues Reel fehlgeschlagen", fehler));
  }

  return media;
}

/**
 * Legt für neue Kommentare unter (potenziellen) Partner-Reels je Person eine
 * Partner-Zeile im Zustand "neu" an - die Warteschlange fürs Onboarding.
 *
 * Doppelsperren: `triggerCommentId` (unique) fängt den mehrfach zugestellten
 * Webhook ab, `igUserId` (unique) verhindert, dass dieselbe Person zweimal ins
 * Programm kommt. Die eigentliche Reel-Klassifikation passiert später in
 * verarbeiteNeue - hier wird nur schnell festgehalten, damit die Webhook-Route
 * kurz bleibt.
 */
export async function nimmKommentareAuf(kommentare: WebhookKommentar[]): Promise<number> {
  let neu = 0;

  for (const kommentar of kommentare) {
    // Eigenes Konto und Thread-Antworten übergehen - Letztere sind Gespräch,
    // kein Teilnahme-Signal.
    if (kommentar.authorId && kommentar.authorId === env.igUserId) continue;
    if (kommentar.parentId) continue;
    if (!kommentar.authorId) continue;

    // Schon als Partner bekannt? Dann nichts tun - die Person läuft bereits
    // durch ihren eigenen Zustand.
    const schon = await prisma.partner.findUnique({ where: { igUserId: kommentar.authorId } });
    if (schon) continue;

    try {
      await prisma.partner.create({
        data: {
          igUserId: kommentar.authorId,
          igUsername: kommentar.authorUsername ?? null,
          quelle: "kommentar",
          triggerMediaId: kommentar.mediaId,
          triggerCommentId: kommentar.id,
          status: "neu",
          provisionssatz: 0.15,
          kaeuferRabatt: 15,
        },
      });
      neu += 1;
    } catch (fehler) {
      // Unique-Verletzung (paralleler Webhook, dieselbe Person/Kommentar) ist
      // die gewollte Doppelsperre, kein Fehler.
      if (!/unique|P2002/i.test(fehler instanceof Error ? fehler.message : String(fehler))) {
        throw fehler;
      }
    }
  }

  return neu;
}

async function protokolliere(
  partnerId: string,
  richtung: "eingehend" | "ausgehend",
  text: string,
  extra?: { igMessageId?: string; klassifikation?: string; sicherheit?: number; eskaliert?: boolean },
) {
  await prisma.partnerNachricht.create({
    data: {
      partnerId,
      richtung,
      text,
      igMessageId: extra?.igMessageId ?? null,
      klassifikation: extra?.klassifikation ?? null,
      sicherheit: extra?.sicherheit ?? null,
      eskaliert: extra?.eskaliert ?? false,
    },
  });
}

async function eskaliere(
  partner: { id: string; name: string | null; igUsername: string | null },
  grund: string,
  eingang: string,
) {
  await prisma.partner.update({
    where: { id: partner.id },
    data: { status: "eskaliert", eskalationsGrund: grund, letzteBotAktion: "eskalation" },
  });
  await sendePush({
    titel: "🚨 Eskalation Partner-Bot",
    rumpf: `${partner.name ?? partner.igUsername ?? partner.id}: ${grund} — "${eingang.slice(0, 80)}"`,
    url: `/?partner=${partner.id}`,
  }).catch((f) => console.error("Push für Eskalation fehlgeschlagen", f));
}

/**
 * Arbeitet die Partner im Zustand "neu" ab: Reel klassifizieren, und bei einem
 * echten Partner-Aufruf die Sprachfrage als private Antwort auf den Kommentar
 * verschicken (öffnet das DM-Fenster). Kein Aufruf-Reel → verworfen.
 */
export async function verarbeiteNeue(hoechstens = 10): Promise<number> {
  if (!(await istEingeschaltet())) return 0;

  const offene = await prisma.partner.findMany({
    where: { status: "neu" },
    orderBy: { createdAt: "asc" },
    take: hoechstens,
  });

  let angeschrieben = 0;

  for (const partner of offene) {
    // Beanspruchen, damit ein paralleler Lauf dieselbe Zeile nicht doppelt
    // anschreibt.
    const beansprucht = await prisma.partner.updateMany({
      where: { id: partner.id, status: "neu" },
      data: { status: "inArbeit" },
    });
    if (beansprucht.count !== 1) continue;

    try {
      if (!partner.triggerMediaId || !partner.triggerCommentId) {
        await prisma.partner.update({
          where: { id: partner.id },
          data: { status: "verworfen", letzteBotAktion: "kein Auslöser" },
        });
        continue;
      }

      const media = await medienInfo(partner.triggerMediaId);
      if (!istEffektivAufruf(media)) {
        await prisma.partner.update({
          where: { id: partner.id },
          data: { status: "verworfen", letzteBotAktion: "kein Partner-Reel" },
        });
        continue;
      }

      await sendePrivateAntwort(partner.triggerCommentId, SPRACHFRAGE);
      await protokolliere(partner.id, "ausgehend", SPRACHFRAGE, { klassifikation: "sprachfrage" });
      await prisma.partner.update({
        where: { id: partner.id },
        data: { status: "sprache_offen", sprache: media.sprache, letzteBotAktion: "sprachfrage" },
      });
      angeschrieben += 1;
    } catch (fehler) {
      await prisma.partner.update({
        where: { id: partner.id },
        data: {
          status: "neu", // zurück in die Warteschlange für den nächsten Lauf
          letzteBotAktion: `Fehler: ${fehler instanceof Error ? fehler.message : String(fehler)}`.slice(0, 200),
        },
      });
    }
  }

  return angeschrieben;
}

async function letzteNachrichten(partnerId: string) {
  const zeilen = await prisma.partnerNachricht.findMany({
    where: { partnerId },
    orderBy: { createdAt: "desc" },
    take: VERLAUF_LAENGE,
  });
  return zeilen
    .reverse()
    .map((z) => ({ richtung: z.richtung as "eingehend" | "ausgehend", text: z.text }));
}

export type NachrichtErgebnis =
  | { ergebnis: "beantwortet"; aktion: string }
  | { ergebnis: "eskaliert"; grund: string }
  | { ergebnis: "kein_partner_anliegen" }
  | { ergebnis: "doppelt" }
  | { ergebnis: "pausiert" }
  | { ergebnis: "fehler"; hinweis: string };

/**
 * Verarbeitet eine einzelne eingehende DM gegen den Zustand der Person.
 *
 * Unbekannte Person → nur bei erkennbarem Partner-Anliegen wird ein Onboarding
 * gestartet. Bekannte Person → Bot entscheidet anhand von Zustand, Verlauf und
 * Wissensbasis; unter der Sicherheits-Schwelle wird eskaliert.
 */
export async function verarbeiteEingehendeNachricht(
  nachricht: EingehendeNachricht,
): Promise<NachrichtErgebnis> {
  // Doppelsperre über die Message-ID.
  const schon = await prisma.partnerNachricht.findUnique({
    where: { igMessageId: nachricht.messageId },
  });
  if (schon) return { ergebnis: "doppelt" };

  if (!(await istEingeschaltet())) return { ergebnis: "pausiert" };

  let partner = await prisma.partner.findUnique({ where: { igUserId: nachricht.senderId } });

  // Unbekannte Person: nur bei Partner-Anliegen ein Onboarding starten.
  if (!partner) {
    const interesse = await istPartnerInteresse(nachricht.text);
    if (interesse !== true) return { ergebnis: "kein_partner_anliegen" };

    partner = await prisma.partner.create({
      data: {
        igUserId: nachricht.senderId,
        quelle: "dm",
        status: "sprache_offen",
        provisionssatz: 0.15,
        kaeuferRabatt: 15,
      },
    });
    await protokolliere(partner.id, "eingehend", nachricht.text, {
      igMessageId: nachricht.messageId,
      klassifikation: "partner_interesse",
    });
    try {
      await sendeDirektNachricht(nachricht.senderId, SPRACHFRAGE);
      await protokolliere(partner.id, "ausgehend", SPRACHFRAGE, { klassifikation: "sprachfrage" });
      await prisma.partner.update({
        where: { id: partner.id },
        data: { letzteBotAktion: "sprachfrage" },
      });
      return { ergebnis: "beantwortet", aktion: "sprachfrage" };
    } catch (fehler) {
      return { ergebnis: "fehler", hinweis: fehler instanceof Error ? fehler.message : String(fehler) };
    }
  }

  // Eskaliert/beendet/abgelehnt: Bot pausiert für diese Person. Eingang
  // festhalten (damit der Mensch ihn im Dashboard sieht) und den Betreiber
  // anstupsen, aber nicht automatisch antworten.
  if (["eskaliert", "beendet", "abgelehnt"].includes(partner.status)) {
    await protokolliere(partner.id, "eingehend", nachricht.text, {
      igMessageId: nachricht.messageId,
      klassifikation: `eingang_bei_${partner.status}`,
      eskaliert: true,
    });
    await sendePush({
      titel: "Neue Nachricht (Bot pausiert)",
      rumpf: `${partner.name ?? partner.igUsername ?? partner.id} [${partner.status}]: "${nachricht.text.slice(0, 80)}"`,
      url: `/?partner=${partner.id}`,
    }).catch(() => {});
    return { ergebnis: "eskaliert", grund: `Bot pausiert (${partner.status})` };
  }

  const verlauf = await letzteNachrichten(partner.id);
  const entscheidung = await entscheide({
    status: partner.status,
    sprache: (partner.sprache as Sprache | null) ?? null,
    name: partner.name,
    verlauf,
    eingang: nachricht.text,
  });

  await protokolliere(partner.id, "eingehend", nachricht.text, {
    igMessageId: nachricht.messageId,
    klassifikation: entscheidung.aktion,
    sicherheit: entscheidung.sicherheit,
    eskaliert: entscheidung.sicherheit < SICHERHEITS_SCHWELLE,
  });

  try {
    return await wendeAnEntscheidung(partner, entscheidung, nachricht.text);
  } catch (fehler) {
    return { ergebnis: "fehler", hinweis: fehler instanceof Error ? fehler.message : String(fehler) };
  }
}

/** Führt die Bot-Entscheidung als konkrete Zustandsänderung + Nachricht aus. */
async function wendeAnEntscheidung(
  partner: {
    id: string;
    igUserId: string;
    igUsername: string | null;
    name: string | null;
    sprache: string | null;
    status: string;
    couponCode: string | null;
    wixCouponId: string | null;
    kaeuferRabatt: number;
  },
  entscheidung: BotEntscheidung,
  eingang: string,
): Promise<NachrichtErgebnis> {
  // Unter der Schwelle nie selbst handeln.
  if (entscheidung.sicherheit < SICHERHEITS_SCHWELLE) {
    await eskaliere(partner, `unsicher (${entscheidung.begruendung})`, eingang);
    return { ergebnis: "eskaliert", grund: "unter Sicherheits-Schwelle" };
  }

  const spr: Sprache = (partner.sprache as Sprache | null) ?? "de";
  const anrede = partner.name || partner.igUsername || (spr === "de" ? "du" : "there");

  const sende = async (text: string, aktion: string) => {
    await sendeDirektNachricht(partner.igUserId, text);
    await protokolliere(partner.id, "ausgehend", text, { klassifikation: aktion });
  };

  switch (entscheidung.aktion) {
    case "sprache_de":
    case "sprache_en": {
      const gewaehlt: Sprache = entscheidung.aktion === "sprache_de" ? "de" : "en";
      // Sprache setzen und - falls das der offene Schritt war - direkt die
      // Willkommens-DM nachschieben.
      await prisma.partner.update({
        where: { id: partner.id },
        data: { sprache: gewaehlt, letzteBotAktion: entscheidung.aktion },
      });
      if (partner.status === "sprache_offen" || partner.status === "neu") {
        const anredeNeu = partner.name || partner.igUsername || (gewaehlt === "de" ? "du" : "there");
        await sende(WILLKOMMEN[gewaehlt](anredeNeu), "willkommen");
        await prisma.partner.update({
          where: { id: partner.id },
          data: { status: "angeschrieben" },
        });
      }
      return { ergebnis: "beantwortet", aktion: entscheidung.aktion };
    }

    case "zustimmung": {
      // Schon ein Code da? Dann nur bestätigen, nicht doppelt anlegen.
      if (partner.couponCode) {
        await sende(
          spr === "de"
            ? `Du bist bereits dabei — dein Code ist ${partner.couponCode}. 🎉`
            : `You're already in — your code is ${partner.couponCode}. 🎉`,
          "zustimmung_bereits",
        );
        return { ergebnis: "beantwortet", aktion: "zustimmung_bereits" };
      }

      const basis = partner.name || partner.igUsername || "PARTNER";
      let gutschein: { id: string; code: string };
      try {
        gutschein = await erstellePartnerGutschein({ code: basis, prozent: partner.kaeuferRabatt });
      } catch (fehler) {
        await eskaliere(
          partner,
          `Gutschein-Anlage fehlgeschlagen: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
          eingang,
        );
        return { ergebnis: "eskaliert", grund: "Gutschein-Anlage fehlgeschlagen" };
      }

      const regeln = env.regelnUrl.startsWith("http")
        ? env.regelnUrl
        : `https://edgechase.com${env.regelnUrl}`;

      await prisma.partner.update({
        where: { id: partner.id },
        data: {
          couponCode: gutschein.code,
          wixCouponId: gutschein.id,
          status: "zustimmung_erhalten",
          zustimmungAm: new Date(),
          agbVersion: AGB_VERSION,
          letzteBotAktion: "zustimmung",
        },
      });

      await sende(
        CODE_AUSLIEFERUNG[spr]({ name: anrede, code: gutschein.code, regeln }),
        "code_ausgeliefert",
      );
      return { ergebnis: "beantwortet", aktion: "zustimmung" };
    }

    case "frage": {
      if (!entscheidung.antwort) {
        await eskaliere(partner, "Frage ohne Antworttext", eingang);
        return { ergebnis: "eskaliert", grund: "Frage ohne Antwort" };
      }
      await sende(entscheidung.antwort, "frage_beantwortet");
      // Nur bei bereits aktiven Partnern in "frage_offen" gehen - vor der
      // Zustimmung bleibt der Zustand, damit die Person noch zustimmen kann.
      if (partner.status === "zustimmung_erhalten" || partner.status === "frage_offen") {
        await prisma.partner.update({
          where: { id: partner.id },
          data: { status: "frage_offen", letzteBotAktion: "frage_beantwortet" },
        });
      } else {
        await prisma.partner.update({
          where: { id: partner.id },
          data: { letzteBotAktion: "frage_beantwortet" },
        });
      }
      return { ergebnis: "beantwortet", aktion: "frage" };
    }

    case "ablehnung": {
      await sende(ABGELEHNT[spr], "abgelehnt");
      await prisma.partner.update({
        where: { id: partner.id },
        data: { status: "abgelehnt", letzteBotAktion: "ablehnung" },
      });
      return { ergebnis: "beantwortet", aktion: "ablehnung" };
    }

    case "beenden": {
      if (partner.wixCouponId) {
        await deaktiviereGutschein(partner.wixCouponId).catch((f) =>
          console.error("Gutschein deaktivieren fehlgeschlagen", f),
        );
      }
      await sende(BEENDET[spr], "beendet");
      await prisma.partner.update({
        where: { id: partner.id },
        data: { status: "beendet", letzteBotAktion: "beenden" },
      });
      return { ergebnis: "beantwortet", aktion: "beenden" };
    }

    case "mensch": {
      await sende(UEBERGABE[spr], "uebergabe");
      await eskaliere(partner, "Mensch gewünscht", eingang);
      return { ergebnis: "eskaliert", grund: "Mensch gewünscht" };
    }

    case "missbrauch": {
      await sende(
        spr === "de"
          ? "Danke für die Meldung — ich gebe das sofort an Miro weiter, wir schauen uns das an. 🙏"
          : "Thanks for reporting — I'm passing this to Miro right away, we'll look into it. 🙏",
        "missbrauch_ack",
      );
      await eskaliere(partner, "Missbrauch gemeldet", eingang);
      return { ergebnis: "eskaliert", grund: "Missbrauch gemeldet" };
    }

    case "eskalation":
    default: {
      await eskaliere(partner, entscheidung.begruendung || "Eskalation", eingang);
      return { ergebnis: "eskaliert", grund: entscheidung.begruendung || "Eskalation" };
    }
  }
}
