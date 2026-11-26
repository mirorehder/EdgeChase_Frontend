import { prisma } from "./db";
import { logActivity } from "./activity";
import { igZugang, pruefeAudioId } from "./instagram";
import type { Track } from "./trackClient";
import { bewerteSound, waehleBestenSound, type VideoBeschreibung } from "./soundKi";
import {
  alterAusDownloadUrl,
  rangliste,
  WARTE_POSTS,
  WARTE_TAGE,
  type SoundKandidat,
} from "./soundRegeln";
import type { PromoVideo, SoundBibliothek } from "@prisma/client";

/** Was der Audio-Katalog pro Sound liefert (Feldnamen wie bei search_audio). */
export interface KatalogSound {
  audio_id: string;
  title?: string;
  display_artist?: string;
  ig_username?: string;
  duration_in_ms?: number;
  audio_type?: string;
  download_url?: string;
}

/** So lange gilt ein Sound als "im Trend", ohne erneut im Katalog zu erscheinen. */
const VERALTET_NACH_TAGEN = 21;
/** Pro Aufruf höchstens so viele neue Sounds bewerten (Zeit- und Kostengrenze). */
const MAX_NEU_BEWERTEN = 14;

const tage = (n: number) => n * 24 * 60 * 60 * 1000;

function alsKandidat(r: SoundBibliothek): SoundKandidat {
  return {
    audioId: r.audioId,
    titel: r.titel,
    kuenstler: r.kuenstler,
    dauerMs: r.dauerMs,
    alterTage: r.alterTage,
    druck: r.druck,
    startStaerke: r.startStaerke,
    saisonal: r.saisonal,
    tauglich: r.tauglich,
    vibeTags: r.vibeTags,
    vibeBeschreibung: r.vibeBeschreibung,
    bewertet: r.bewertetAt != null,
  };
}

// ---------------------------------------------------------------------------
// Zufluss: frische Sounds aufnehmen und bewerten
// ---------------------------------------------------------------------------

export interface AufnahmeErgebnis {
  erhalten: number;
  neu: number;
  bewertet: number;
  aktualisiert: number;
  uebersprungen: number;
  fehler: string[];
}

async function ladeAudio(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Eine Audiospur von höchstens ~75 s liegt weit unter 10 MB.
    return buf.length > 0 && buf.length < 12 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Nimmt Sounds aus dem Katalog in die Bibliothek auf. Bekannte werden nur als
 * "gerade gesehen" markiert; neue werden (wenn ihre Audiodatei erreichbar ist)
 * von Gemini gehört und bewertet.
 */
export async function nimmSoundsAuf(rohe: KatalogSound[]): Promise<AufnahmeErgebnis> {
  const ergebnis: AufnahmeErgebnis = {
    erhalten: rohe.length,
    neu: 0,
    bewertet: 0,
    aktualisiert: 0,
    uebersprungen: 0,
    fehler: [],
  };

  // Doppelte (derselbe Sound kommt mit und ohne Download-Adresse) zusammenführen.
  const nachId = new Map<string, KatalogSound>();
  for (const s of rohe) {
    const id = String(s?.audio_id ?? "").trim();
    if (!/^\d{5,}$/.test(id)) {
      ergebnis.uebersprungen++;
      continue;
    }
    const alt = nachId.get(id);
    nachId.set(id, { ...alt, ...s, audio_id: id, download_url: s.download_url || alt?.download_url });
  }

  const jetzt = new Date();
  let neuBewertet = 0;
  for (const s of nachId.values()) {
    const dauerMs = Math.round(Number(s.duration_in_ms) || 0);
    if (dauerMs < 3000) {
      ergebnis.uebersprungen++;
      continue;
    }
    const titel = (s.title ?? "").trim() || "Original-Audio";
    const kuenstler = (s.display_artist || s.ig_username || "").trim() || null;
    const alterTage = alterAusDownloadUrl(s.download_url);

    const vorhanden = await prisma.soundBibliothek.findUnique({ where: { audioId: s.audio_id } });
    if (vorhanden) {
      await prisma.soundBibliothek.update({
        where: { audioId: s.audio_id },
        data: {
          zuletztGesehenAt: jetzt,
          ...(alterTage != null && vorhanden.alterTage == null ? { alterTage } : {}),
          // Ein "veralteter" Sound, der wieder im Katalog auftaucht, ist wieder im Trend.
          ...(vorhanden.status === "veraltet" ? { status: "aktiv" } : {}),
        },
      });
      // Bisher unbewertet, jetzt mit Audio erreichbar: nachholen.
      if (vorhanden.bewertetAt == null && s.download_url && neuBewertet < MAX_NEU_BEWERTEN) {
        neuBewertet++;
        if (await bewerteUndSpeichere(s.audio_id, s.download_url, { titel, kuenstler, dauerMs }, ergebnis))
          ergebnis.bewertet++;
      }
      ergebnis.aktualisiert++;
      continue;
    }

    await prisma.soundBibliothek.create({
      data: {
        audioId: s.audio_id,
        titel,
        kuenstler,
        dauerMs,
        typ: s.audio_type === "music" ? "music" : "original_sound",
        alterTage,
        zuletztGesehenAt: jetzt,
        vibeTags: [],
      },
    });
    ergebnis.neu++;
    if (s.download_url && neuBewertet < MAX_NEU_BEWERTEN) {
      neuBewertet++;
      if (await bewerteUndSpeichere(s.audio_id, s.download_url, { titel, kuenstler, dauerMs }, ergebnis))
        ergebnis.bewertet++;
    }
  }

  await prisma.soundBibliothek.updateMany({
    where: { status: "aktiv", zuletztGesehenAt: { lt: new Date(Date.now() - tage(VERALTET_NACH_TAGEN)) } },
    data: { status: "veraltet" },
  });

  await logActivity(
    `Sound-Bibliothek: ${ergebnis.erhalten} Sounds erhalten, ${ergebnis.neu} neu, ` +
      `${ergebnis.bewertet} bewertet, ${ergebnis.fehler.length} Fehler.`,
    { level: ergebnis.fehler.length ? "error" : "info" },
  );
  return ergebnis;
}

async function bewerteUndSpeichere(
  audioId: string,
  url: string,
  info: { titel: string; kuenstler: string | null; dauerMs: number },
  ergebnis: AufnahmeErgebnis,
): Promise<boolean> {
  try {
    const audio = await ladeAudio(url);
    if (!audio) return false;
    const b = await bewerteSound(audio, info);
    await prisma.soundBibliothek.update({
      where: { audioId },
      data: {
        bewertetAt: new Date(),
        druck: b.druck,
        startStaerke: b.startStaerke,
        saisonal: b.saisonal,
        tauglich: b.tauglich,
        vibeTags: b.vibeTags,
        vibeBeschreibung: b.vibeBeschreibung || null,
      },
    });
    return true;
  } catch (err) {
    ergebnis.fehler.push(`${audioId}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wahl: der beste Sound für ein bestimmtes Video
// ---------------------------------------------------------------------------

/** Die zuletzt in dieser Sparte verwendeten Sounds, neueste zuerst. */
export async function zuletztVerwendeteSounds(track: Track): Promise<string[]> {
  const letzte = await prisma.promoVideo.findMany({
    where: { track, postedAt: { not: null }, postSoundAudioId: { not: null } },
    orderBy: { postedAt: "desc" },
    take: 60,
    select: { postSoundAudioId: true, postedAt: true },
  });
  const grenze = Date.now() - tage(WARTE_TAGE);
  const ids: string[] = [];
  letzte.forEach((v, i) => {
    const id = v.postSoundAudioId!;
    const imFenster = i < WARTE_POSTS || (v.postedAt != null && v.postedAt.getTime() >= grenze);
    if (imFenster && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

export function videoBeschreibung(
  track: Track,
  video: Pick<PromoVideo, "hookText" | "fileTitle" | "scenes">,
  thema: string | null,
  momente: string[],
): VideoBeschreibung {
  const szenen = Array.isArray(video.scenes) ? (video.scenes as { seconds?: number }[]) : [];
  const sekunden = Math.max(
    3,
    Math.round(szenen.reduce((a, s) => a + (Number(s.seconds) || 0), 0) * 10) / 10,
  );
  const art =
    track === "promo" || track === "clothing"
      ? "Streetwear-Werbevideo"
      : track === "coaching"
        ? "Parkour-Coaching-Reel"
        : track === "serie"
          ? "Parkour-Serie mit Zähler"
          : "schnell geschnittener Parkour-Edit";
  return { art, hookText: video.hookText, titel: video.fileTitle ?? "", thema, momente, sekunden };
}

export interface BibliotheksWahl {
  audioId: string;
  titel: string;
  grund: string;
}

/**
 * Wählt aus der Bibliothek den passendsten, wirklich verwendbaren Sound.
 *
 * Ablauf: Kandidaten filtern (Dauer, nicht saisonal, nicht in der Wartezeit) →
 * nach Druck/Start/Frische ordnen → Gemini sucht aus den besten sechs den
 * passendsten → bei Instagram prüfen, ob er verwendbar ist; wenn nicht, sperren
 * und den nächsten nehmen. Null, wenn nichts übrig bleibt.
 */
export async function waehleAusBibliothek(
  track: Track,
  video: VideoBeschreibung,
  opt: { zufall?: () => number } = {},
): Promise<BibliotheksWahl | null> {
  const zeilen = await prisma.soundBibliothek.findMany({ where: { status: "aktiv" } });
  if (zeilen.length === 0) return null;

  const verwendet = await zuletztVerwendeteSounds(track);
  let rang = rangliste(zeilen.map(alsKandidat), video.sekunden * 1000, verwendet, opt.zufall);
  const zugang = igZugang(track);

  for (let versuch = 0; versuch < 5 && rang.length > 0; versuch++) {
    const spitze = rang.slice(0, 6);
    const ki = await waehleBestenSound(video, spitze);
    const gewaehlt = spitze.find((k) => k.audioId === ki?.audioId) ?? spitze[0];

    // Ohne Zugangsdaten (Trockenlauf) gibt es nichts zu prüfen.
    const ok = zugang ? await pruefeAudioId(gewaehlt.audioId, zugang.igUserId, zugang.token) : true;
    if (ok) {
      return {
        audioId: gewaehlt.audioId,
        titel: gewaehlt.titel,
        grund: ki?.audioId === gewaehlt.audioId && ki.grund ? ki.grund : "bester Wert der Rangliste",
      };
    }

    // Bei Instagram nicht verwendbar. Nach drei Fehlschlägen wird der Sound
    // dauerhaft gesperrt - eine einzelne Störung soll ihn nicht verbrennen.
    const neu = await prisma.soundBibliothek.update({
      where: { audioId: gewaehlt.audioId },
      data: { fehlversuche: { increment: 1 } },
    });
    if (neu.fehlversuche >= 3) {
      await prisma.soundBibliothek.update({
        where: { audioId: gewaehlt.audioId },
        data: { status: "gesperrt", sperrGrund: "bei Instagram nicht verwendbar" },
      });
    }
    rang = rang.filter((k) => k.audioId !== gewaehlt.audioId);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Zustand der Bibliothek
// ---------------------------------------------------------------------------

export interface BibliotheksStand {
  aktiv: number;
  bewertet: number;
  brauchbar: number;
  gesperrt: number;
  veraltet: number;
  letzteAufnahme: Date | null;
}

export async function bibliotheksStand(): Promise<BibliotheksStand> {
  const [aktiv, bewertet, brauchbar, gesperrt, veraltet, letzte] = await Promise.all([
    prisma.soundBibliothek.count({ where: { status: "aktiv" } }),
    prisma.soundBibliothek.count({ where: { status: "aktiv", bewertetAt: { not: null } } }),
    prisma.soundBibliothek.count({
      where: { status: "aktiv", bewertetAt: { not: null }, tauglich: true, saisonal: false, druck: { gte: 0.5 } },
    }),
    prisma.soundBibliothek.count({ where: { status: "gesperrt" } }),
    prisma.soundBibliothek.count({ where: { status: "veraltet" } }),
    prisma.soundBibliothek.findFirst({ orderBy: { zuletztGesehenAt: "desc" }, select: { zuletztGesehenAt: true } }),
  ]);
  return {
    aktiv,
    bewertet,
    brauchbar,
    gesperrt,
    veraltet,
    letzteAufnahme: letzte?.zuletztGesehenAt ?? null,
  };
}
