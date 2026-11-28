import { prisma } from "../db";
import { sendePush } from "../push";
import { erstelleGutscheinMitAblauf } from "../wix/coupons";
import {
  type EingehendeInteraktionNachricht,
  type EingehendeNachricht,
  ladeNutzerProfil,
  sendeDirektNachricht,
} from "./graph";
import {
  formuliereInteraktionCode,
  formuliereInteraktionFallback,
  formuliereInteraktionFolge,
} from "./interaktion_antwort";
import { leseNameAusHandle, leseNameAusText } from "./namen";

/** Wix-Tag für Interaktions-Codes. */
const GUTSCHEIN_TAG = "Instagram-Interaktion";

/** Standard-Vorgaben, falls die Config-Zeile fehlt. */
const RABATT_VORGABE = 25;
const STUNDEN_VORGABE = 24;

/** Ist die Interaktions-Kampagne eingeschaltet? */
export async function istInteraktionEingeschaltet(): Promise<boolean> {
  const cfg = await prisma.interaktionConfig.findUnique({ where: { id: "default" } });
  return cfg?.enabled ?? true;
}

async function holeConfig(): Promise<{ rabattProzent: number; gueltigStunden: number }> {
  const cfg = await prisma.interaktionConfig.findUnique({ where: { id: "default" } });
  return {
    rabattProzent: cfg?.rabattProzent ?? RABATT_VORGABE,
    gueltigStunden: cfg?.gueltigStunden ?? STUNDEN_VORGABE,
  };
}

/** Eindeutiger 6-stelliger Code im Format EC-XXXX. */
function zufallsCode(): string {
  const zeichen = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += zeichen[Math.floor(Math.random() * zeichen.length)];
  }
  return `EC-${code}`;
}

/**
 * Verarbeitet ein geteiltes Reel als DM.
 *
 * Ablauf:
 *   1. Doppelsperre (messageId + igScopedId/mediaId)
 *   2. Reel als Interaktions-Kampagne erkannt?
 *   3. Nutzerprofil laden (Name + Follow-Status)
 *   4. Follow-Prüfung:
 *      - Following     → direkt Code senden (Schritt 5)
 *      - Not following → Folge-DM, Status "wartet_auf_folge"
 *      - Unknown       → Fallback-DM, Status "wartet_auf_folge_fallback"
 *   5. Gutschein bei Wix anlegen, Code-DM senden
 */
export async function verarbeiteInteraktionDm(
  nachricht: EingehendeInteraktionNachricht,
): Promise<void> {
  // Kampagne eingeschaltet?
  if (!(await istInteraktionEingeschaltet())) return;

  // Ist das ein bekanntes Interaktions-Reel?
  const media = await prisma.instagramMedia.findUnique({
    where: { id: nachricht.reelMediaId },
    select: {
      id: true,
      kampagne: true,
      sprache: true,
      interaktionRabatt: true,
      interaktionGueltigStunden: true,
    },
  });
  if (!media || media.kampagne !== "interaktion") return;

  // Doppelsperre 1: Message-ID (Meta-Wiederzustellung)
  const bestehendeNachricht = await prisma.interaktionTeilnahme.findUnique({
    where: { messageId: nachricht.messageId },
  });
  if (bestehendeNachricht) return;

  // Doppelsperre 2: Person hat für dieses Reel schon einen Eintrag
  const bestehend = await prisma.interaktionTeilnahme.findUnique({
    where: { igScopedId_mediaId: { igScopedId: nachricht.senderId, mediaId: media.id } },
  });
  if (bestehend) {
    // Stilles Ignorieren: Eintrag existiert bereits. Trotzdem messageId-Sperre
    // anlegen, damit Wiederzustellungen keinen zweiten Insert versuchen.
    await prisma.interaktionTeilnahme.create({
      data: {
        igScopedId: `${nachricht.senderId}_dup`,
        mediaId: media.id,
        messageId: nachricht.messageId,
        status: "uebersprungen",
        hinweis: "Duplikat: Person hat schon einen Eintrag für dieses Reel.",
      },
    }).catch(() => {}); // Kann scheitern, wenn sogar die dup-ID existiert
    return;
  }

  const globalCfg = await holeConfig();
  const rabatt = media.interaktionRabatt ?? globalCfg.rabattProzent;
  const stunden = media.interaktionGueltigStunden ?? globalCfg.gueltigStunden;
  const sprache = (media.sprache === "de" ? "de" : "en") as "de" | "en";

  // Nutzerprofil: Name + Follow-Status
  let nameRaw: string | null = null;
  let isFollowing: boolean | null = null;
  try {
    const profil = await ladeNutzerProfil(nachricht.senderId);
    isFollowing = profil.isFollowing ?? null;
    nameRaw =
      (profil.name ? leseNameAusText(profil.name) : null) ??
      leseNameAusHandle(profil.username);
  } catch {
    // Profil nicht abrufbar — weiter ohne Name und mit unbekanntem Follow-Status
  }

  // Zeile anlegen (nicht-unique messageId ist hier ok, weil obige Prüfung
  // schon sichergestellt hat, dass keine Zeile mit dieser messageId existiert)
  const teilnahme = await prisma.interaktionTeilnahme.create({
    data: {
      igScopedId: nachricht.senderId,
      mediaId: media.id,
      messageId: nachricht.messageId,
      status: "neu",
      name: nameRaw,
      folgeStatus:
        isFollowing === true
          ? "following"
          : isFollowing === false
            ? "not_following"
            : "unknown",
    },
  });

  // Follow-Prüfung → Pfad entscheiden
  if (isFollowing === false) {
    const dm = formuliereInteraktionFolge(nameRaw, rabatt, sprache);
    try {
      await sendeDirektNachricht(nachricht.senderId, dm);
      await prisma.interaktionTeilnahme.update({
        where: { id: teilnahme.id },
        data: { status: "wartet_auf_folge" },
      });
    } catch (err) {
      await prisma.interaktionTeilnahme.update({
        where: { id: teilnahme.id },
        data: {
          status: "fehler",
          hinweis: `Folge-DM fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
    return;
  }

  if (isFollowing === null) {
    const dm = formuliereInteraktionFallback(nameRaw, rabatt, sprache);
    try {
      await sendeDirektNachricht(nachricht.senderId, dm);
      await prisma.interaktionTeilnahme.update({
        where: { id: teilnahme.id },
        data: { status: "wartet_auf_folge_fallback" },
      });
    } catch (err) {
      await prisma.interaktionTeilnahme.update({
        where: { id: teilnahme.id },
        data: {
          status: "fehler",
          hinweis: `Fallback-DM fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
    return;
  }

  // isFollowing === true → Code senden
  await sendeInteraktionsCode(teilnahme.id, nachricht.senderId, nameRaw, rabatt, stunden, sprache);

  // Push ans Dashboard
  await sendePush({
    titel: "Neue Interaktion",
    rumpf: `${nameRaw ?? nachricht.senderId} hat am Interaktions-Gewinnspiel teilgenommen.`,
    url: "/",
  }).catch(() => {});
}

/**
 * Erstellt den Wix-Coupon und sendet die Code-DM.
 * Wird sowohl beim Erst-DM (follow bestätigt) als auch beim Follow-up genutzt.
 */
export async function sendeInteraktionsCode(
  teilnahmeId: string,
  igScopedId: string,
  name: string | null,
  rabatt: number,
  stunden: number,
  sprache: "de" | "en",
): Promise<void> {
  const gueltigBis = new Date(Date.now() + stunden * 60 * 60 * 1000);
  const codeVorschlag = zufallsCode();

  let gutschein: { id: string; code: string };
  try {
    gutschein = await erstelleGutscheinMitAblauf({
      code: codeVorschlag,
      prozent: rabatt,
      ablaufZeitpunkt: gueltigBis,
      tag: GUTSCHEIN_TAG,
    });
  } catch (err) {
    await prisma.interaktionTeilnahme.update({
      where: { id: teilnahmeId },
      data: {
        status: "fehler",
        hinweis: `Gutschein konnte nicht erstellt werden: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
    return;
  }

  const dm = formuliereInteraktionCode(name, gutschein.code, rabatt, gueltigBis, sprache);

  let dmFehler: string | undefined;
  try {
    await sendeDirektNachricht(igScopedId, dm);
  } catch (err) {
    dmFehler = err instanceof Error ? err.message : String(err);
  }

  await prisma.interaktionTeilnahme.update({
    where: { id: teilnahmeId },
    data: {
      status: dmFehler ? "fehler" : "code_gesendet",
      code: gutschein.code,
      codeId: gutschein.id,
      codeGueltigBis: gueltigBis,
      codeGesendetAm: dmFehler ? null : new Date(),
      hinweis: dmFehler ? `Code erstellt (${gutschein.code}), DM fehlgeschlagen: ${dmFehler}` : null,
    },
  });
}

/**
 * Verarbeitet eine Folge-Antwort (Textnachricht nach Folge-DM oder Fallback).
 *
 * Schaut, ob die Person einen offenen Interaktions-Eintrag hat und ob die
 * Antwort wie "done", "ja", "yes" o. Ä. aussieht.
 */
export async function verarbeiteInteraktionAntwort(
  nachricht: EingehendeNachricht,
): Promise<boolean> {
  if (!(await istInteraktionEingeschaltet())) return false;

  // Ist es eine Bestätigungs-Antwort?
  const bestaetigt = /\b(done|ja|yes|folge|follow|ok|yep|si|oui)\b/i.test(nachricht.text.trim());
  if (!bestaetigt) return false;

  // Offene Teilnahme suchen
  const offen = await prisma.interaktionTeilnahme.findFirst({
    where: {
      igScopedId: nachricht.senderId,
      status: { in: ["wartet_auf_folge", "wartet_auf_folge_fallback"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!offen) return false;

  const media = await prisma.instagramMedia.findUnique({
    where: { id: offen.mediaId },
    select: { sprache: true, interaktionRabatt: true, interaktionGueltigStunden: true },
  });

  const globalCfg = await holeConfig();
  const rabatt = media?.interaktionRabatt ?? globalCfg.rabattProzent;
  const stunden = media?.interaktionGueltigStunden ?? globalCfg.gueltigStunden;
  const sprache = (media?.sprache === "de" ? "de" : "en") as "de" | "en";

  // Bei Fallback-Status erneut Follow-Status prüfen, bevor der Code gesendet wird
  if (offen.status === "wartet_auf_folge_fallback") {
    let isFollowing: boolean | null = null;
    try {
      const profil = await ladeNutzerProfil(nachricht.senderId);
      isFollowing = profil.isFollowing ?? null;
    } catch {
      // Weiter, wenn Profil nicht abrufbar
    }

    if (isFollowing === false) {
      // Immer noch kein Follow — erneut freundlich darauf hinweisen
      const dm = formuliereInteraktionFolge(offen.name, rabatt, sprache);
      await sendeDirektNachricht(nachricht.senderId, dm).catch(() => {});
      await prisma.interaktionTeilnahme.update({
        where: { id: offen.id },
        data: { status: "wartet_auf_folge", folgeStatus: "not_following" },
      });
      return true;
    }
  }

  await sendeInteraktionsCode(
    offen.id,
    nachricht.senderId,
    offen.name,
    rabatt,
    stunden,
    sprache,
  );

  // Push ans Dashboard
  await sendePush({
    titel: "Interaktion: Code gesendet",
    rumpf: `${offen.name ?? nachricht.senderId} hat bestätigt, Code wurde verschickt.`,
    url: "/",
  }).catch(() => {});

  return true;
}
