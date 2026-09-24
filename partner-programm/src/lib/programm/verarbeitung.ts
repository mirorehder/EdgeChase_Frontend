import { prisma } from "../db";
import { env } from "../env";
import {
  antworteAufKommentar,
  ladeKommentareVonMedia,
  ladeKontoMedien,
  ladeKonversationen,
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

/**
 * Wie weit der allererste Poll-Lauf zurückschaut (danach steuert der
 * Wasserstand). Bewusst kurz gehalten: der Automat geht frisch live und soll
 * nicht die ganze Kommentar-Historie alter Reels nachträglich anschreiben.
 */
const ERSTLAUF_RUECKBLICK_MS = 30 * 60 * 1000;

/**
 * Überlappung: der Poller schaut ein Stück über den letzten Wasserstand hinaus
 * zurück, damit an der Zeitgrenze nichts durchrutscht. Doppelte fängt ohnehin
 * die Doppelsperre ab (igMessageId, triggerCommentId, igUserId).
 */
const UEBERLAPP_MS = 3 * 60 * 1000;

/** So viele der jüngsten Medien werden je Lauf nach neuen Kommentaren abgesucht. */
const MEDIEN_JE_LAUF = 15;

/**
 * Wie oft die (teure) Kommentar-Suche höchstens läuft. DMs holt jeder Lauf ab -
 * das ist ein einziger Aufruf und hält die Konversation minutenschnell. Die
 * Kommentar-Suche geht über viele Reels (ein Aufruf je Reel) und läuft deshalb
 * nur in diesem Takt, damit ein Poller, der jede Minute angestossen wird (z.B.
 * ein externer Cron-Dienst statt Vercel-Pro), nicht in Instagrams Rate-Limit
 * läuft. Neue Kommentierende landen so mit bis zu 10 Min Verzug - das reicht,
 * die eigentliche Konversation danach ist wieder minutenschnell.
 */
const KOMMENTAR_INTERVALL_MS = 10 * 60 * 1000;

/** Ist der Automat eingeschaltet? Fehlt die Zeile, gilt er als eingeschaltet. */
export async function istEingeschaltet(): Promise<boolean> {
  const config = await prisma.partnerConfig.findUnique({ where: { id: "default" } });
  return config?.enabled ?? true;
}

/**
 * Gilt das Reel als Partner-Aufruf?
 *
 * Manuelle Markierung (`ueberschreibung`) geht IMMER vor. Ohne Markierung
 * entscheidet der Modus: im Allowlist-Modus (autoErkennung=false, Vorgabe) zählt
 * ein Reel NIE von selbst - erst die manuelle Freigabe im Dashboard macht es zum
 * Partner-Aufruf, vorher wird garantiert keine DM verschickt. Im Auto-Modus
 * zählt zusätzlich die KI-Erkennung (`istAufruf`).
 */
export function istEffektivAufruf(
  media: { istAufruf: boolean; ueberschreibung: boolean | null },
  autoErkennung = false,
): boolean {
  if (media.ueberschreibung !== null) return media.ueberschreibung;
  return autoErkennung ? media.istAufruf : false;
}

/**
 * Einschätzung eines Reels, aus dem Zwischenspeicher oder frisch von Meta.
 * Beim ersten Auftauchen: Video-Analyse mit Gemini, Text-Erkennung als
 * Fallback, plus eine Push ans Dashboard.
 */
async function medienInfo(mediaId: string, autoErkennung: boolean) {
  const bekannt = await prisma.partnerMedia.findUnique({ where: { id: mediaId } });

  if (bekannt && Date.now() - bekannt.aktualisiertAm.getTime() < MEDIA_FRISCH_MS) {
    return bekannt;
  }

  const { caption, permalink, videoUrl, mediaType } = await ladeMedia(mediaId);

  const istErstAnalyse = bekannt === null;
  let istAufruf = bekannt?.istAufruf ?? false;
  let analyseHinweis = bekannt?.analyseHinweis ?? null;

  if (istErstAnalyse && autoErkennung) {
    // Auto-Modus: die KI schaut sich das Video an.
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
  } else if (istErstAnalyse) {
    // Allowlist-Modus: keine KI, das Reel wartet auf die manuelle Markierung.
    analyseHinweis = "Wartet auf manuelle Markierung";
  }

  const captionDaten = { caption, permalink, sprache: spracheAusCaption(caption) };
  const media = await prisma.partnerMedia.upsert({
    where: { id: mediaId },
    create: { id: mediaId, ...captionDaten, istAufruf, analyseHinweis },
    update: captionDaten,
  });

  if (istErstAnalyse) {
    const kopfzeile = caption.split("\n")[0].slice(0, 80).trim() || "(ohne Text)";
    const titel = autoErkennung
      ? `Neues Reel: ${istAufruf ? "als Partner-Aufruf erkannt" : "nicht als Partner-Aufruf erkannt"}`
      : "Neues kommentiertes Reel — im Dashboard prüfen";
    await sendePush({
      titel,
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
  const config = await prisma.partnerConfig.findUnique({ where: { id: "default" } });
  if (!(config?.enabled ?? true)) return 0;
  const autoErkennung = config?.autoErkennung ?? false;

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

      const media = await medienInfo(partner.triggerMediaId, autoErkennung);
      if (!istEffektivAufruf(media, autoErkennung)) {
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

/**
 * Holt neue Kommentare unter den jüngsten und den bekannten Partner-Reels ab und
 * legt daraus - über denselben Weg wie der Webhook (nimmKommentareAuf) - die
 * "neu"-Zeilen an. Nur Kommentare jünger als der Wasserstand werden betrachtet;
 * die eigentliche Doppelsperre bleibt der Unique-Constraint.
 */
async function polleKommentare(cutoffMs: number, autoErkennung: boolean): Promise<number> {
  const [juengste, medien] = await Promise.all([
    ladeKontoMedien(MEDIEN_JE_LAUF).catch((fehler) => {
      console.error("Medienliste lesen fehlgeschlagen", fehler);
      return [] as string[];
    }),
    prisma.partnerMedia.findMany(),
  ]);

  // Jüngste Medien plus bereits freigegebene Reels (auch ältere, die noch
  // Kommentare bekommen) - als Menge, damit keine Media-ID doppelt abgefragt wird.
  const freigegebeneIds = medien.filter((m) => istEffektivAufruf(m, autoErkennung)).map((m) => m.id);
  const mediaIds = Array.from(new Set([...juengste, ...freigegebeneIds]));

  const gesammelt: WebhookKommentar[] = [];
  for (const mediaId of mediaIds) {
    try {
      const kommentare = await ladeKommentareVonMedia(mediaId);
      const neue = kommentare.filter((k) => k.erstelltMs === null || k.erstelltMs >= cutoffMs);
      if (neue.length === 0) continue;

      // Jedes kommentierte Reel registrieren, damit es im Dashboard auftaucht
      // (und dort markiert werden kann). ABER nur Kommentare auf freigegebenen
      // Reels lösen Onboarding aus - auf nicht-freigegebenen Reels wird keine
      // Person gespeichert (Zweckbindung: keine Daten ohne Partner-Bezug).
      const media = await medienInfo(mediaId, autoErkennung);
      if (istEffektivAufruf(media, autoErkennung)) {
        gesammelt.push(...neue);
      }
    } catch (fehler) {
      console.error(`Kommentare/Reel ${mediaId} verarbeiten fehlgeschlagen`, fehler);
    }
  }

  return nimmKommentareAuf(gesammelt);
}

/**
 * Holt die eingehenden DMs der jüngsten Konversationen ab und schickt jede - in
 * zeitlicher Reihenfolge, damit der Zustandsautomat sauber fortschreitet - durch
 * verarbeiteEingehendeNachricht. Eigene Nachrichten werden übergangen; die
 * igMessageId-Doppelsperre fängt bereits verarbeitete DMs ab.
 */
async function polleNachrichten(cutoffMs: number): Promise<number> {
  let nachrichten;
  try {
    nachrichten = await ladeKonversationen();
  } catch (fehler) {
    console.error("Konversationen lesen fehlgeschlagen", fehler);
    return 0;
  }

  const relevant = nachrichten
    .filter((n) => n.senderId && n.senderId !== env.igUserId)
    .filter((n) => n.erstelltMs === null || n.erstelltMs >= cutoffMs)
    .sort((a, b) => (a.erstelltMs ?? 0) - (b.erstelltMs ?? 0));

  let verarbeitet = 0;
  for (const nachricht of relevant) {
    try {
      const ergebnis = await verarbeiteEingehendeNachricht({
        senderId: nachricht.senderId,
        text: nachricht.text,
        messageId: nachricht.messageId,
        timestamp: nachricht.erstelltMs ?? undefined,
      });
      if (ergebnis.ergebnis !== "doppelt") verarbeitet += 1;
    } catch (fehler) {
      console.error(`DM ${nachricht.messageId} verarbeiten fehlgeschlagen`, fehler);
    }
  }
  return verarbeitet;
}

/**
 * Der Poll-Lauf: der Ersatz für den Webhook, den diese App wegen der geteilten
 * Meta-App nicht bekommen kann. Fragt Kommentare und DMs aktiv ab und schiebt
 * sie durch dieselben Verarbeitungswege. Ist der Automat ausgeschaltet, wird
 * gar nicht erst abgefragt und der Wasserstand nicht bewegt - so werden die
 * Ereignisse beim Wiedereinschalten erneut gesehen statt still übersprungen.
 */
export async function polleEingaenge(): Promise<{ kommentare: number; nachrichten: number }> {
  if (!(await istEingeschaltet())) return { kommentare: 0, nachrichten: 0 };

  const config = await prisma.partnerConfig.findUnique({ where: { id: "default" } });
  const autoErkennung = config?.autoErkennung ?? false;
  const jetzt = Date.now();
  const stand = new Date(jetzt);

  // DMs jeden Lauf (ein Aufruf) - die laufende Konversation soll nicht warten.
  const dmCutoff = config?.letzterDmScan
    ? config.letzterDmScan.getTime() - UEBERLAPP_MS
    : jetzt - ERSTLAUF_RUECKBLICK_MS;
  const nachrichten = await polleNachrichten(dmCutoff);

  // Kommentar-Suche nur, wenn seit dem letzten Mal genug Zeit vergangen ist -
  // sie geht über viele Reels und wäre bei jedem Minuten-Lauf zu teuer.
  const kommentarFaellig =
    !config?.letzterKommentarScan ||
    jetzt - config.letzterKommentarScan.getTime() >= KOMMENTAR_INTERVALL_MS;

  let kommentare = 0;
  if (kommentarFaellig) {
    const kommentarCutoff = config?.letzterKommentarScan
      ? config.letzterKommentarScan.getTime() - UEBERLAPP_MS
      : jetzt - ERSTLAUF_RUECKBLICK_MS;
    kommentare = await polleKommentare(kommentarCutoff, autoErkennung);
  }

  // Wasserstände getrennt fortschreiben: den Kommentar-Stand nur, wenn diesmal
  // wirklich gesucht wurde (sonst würde der Takt bei jedem Lauf zurückgesetzt).
  await prisma.partnerConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      letzterDmScan: stand,
      letzterKommentarScan: kommentarFaellig ? stand : null,
    },
    update: {
      letzterDmScan: stand,
      ...(kommentarFaellig ? { letzterKommentarScan: stand } : {}),
    },
  });

  return { kommentare, nachrichten };
}
