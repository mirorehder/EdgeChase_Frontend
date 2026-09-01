import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { trackFromValue } from "@/lib/trackParam";
import { audioIdAus, soundEingabePruefen, type SoundArt, type SoundStatus } from "@/lib/sound";

export const dynamic = "force-dynamic";

/**
 * Den Sound eines Konzepts setzen.
 *
 * Zwei Aufrufer mit verschiedenem Wissensstand, deshalb zwei Formen:
 *
 * 1. Aus dem Dashboard kommt nur { url }. Mehr weiss die Anwendung nicht -
 *    sie hat keinen Instagram-Zugang, der MCP hängt an Claude. Sie liest die
 *    audio_id aus dem Link und legt das Konzept auf "offen".
 *
 * 2. Nach der Prüfung kommt { audioId, kind, title, artist, status, note }.
 *    Dann steht fest, ob der Sound an der richtigen Stelle beginnt, und das
 *    Konzept geht auf "geprueft" - oder auf "ohne", wenn sich kein
 *    brauchbarer Zuschnitt finden liess.
 */
interface Eingang {
  url?: string | null;
  audioId?: string | null;
  kind?: string | null;
  title?: string | null;
  artist?: string | null;
  status?: string | null;
  note?: string | null;
}

const STATUS: SoundStatus[] = ["offen", "geprueft", "ohne"];
const ARTEN: SoundArt[] = ["original_sound", "music"];

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const eingang = (await request.json()) as Eingang;
    const concept = await prisma.concept.findUnique({ where: { id: params.id } });
    if (!concept) {
      return NextResponse.json({ error: "Konzept nicht gefunden." }, { status: 404 });
    }

    // Leerer Link heisst: Sound entfernen. Das ist kein Fehler, sondern die
    // Art, ein Konzept wieder auf den Trend-Sound zu stellen.
    if (eingang.url !== undefined && !(eingang.url ?? "").trim() && !eingang.audioId) {
      const geleert = await prisma.concept.update({
        where: { id: params.id },
        data: {
          soundUrl: null,
          soundAudioId: null,
          soundKind: null,
          soundTitle: null,
          soundArtist: null,
          soundStatus: "ohne",
          soundNote: null,
          soundCheckedAt: null,
        },
      });
      await logActivity(`Sound von Konzept "${concept.title}" entfernt - es gilt der Trend-Sound.`, {
        track: trackFromValue(concept.track),
      });
      return NextResponse.json(geleert);
    }

    // Woher die ID kommt: entweder ausdrücklich mitgeschickt (nach der
    // Prüfung) oder aus dem eingefügten Link gelesen.
    let audioId = (eingang.audioId ?? "").trim() || null;
    if (!audioId && eingang.url) {
      const gelesen = soundEingabePruefen(eingang.url);
      if (gelesen.fehler) {
        return NextResponse.json({ error: gelesen.fehler }, { status: 400 });
      }
      audioId = gelesen.audioId;
    }
    if (audioId && !audioIdAus(audioId)) {
      return NextResponse.json({ error: "Das ist keine gültige Sound-ID." }, { status: 400 });
    }
    if (!audioId) {
      return NextResponse.json({ error: "Kein Sound angegeben." }, { status: 400 });
    }

    const art = ARTEN.includes(eingang.kind as SoundArt) ? (eingang.kind as SoundArt) : null;
    const status: SoundStatus = STATUS.includes(eingang.status as SoundStatus)
      ? (eingang.status as SoundStatus)
      // Ohne ausdrückliche Angabe: geprüft ist nur, was schon geprüft war und
      // sich nicht geändert hat. Ein neuer Link faellt zurueck auf "offen".
      : audioId === concept.soundAudioId
        ? (concept.soundStatus as SoundStatus)
        : "offen";

    const aktualisiert = await prisma.concept.update({
      where: { id: params.id },
      data: {
        // Der eingefügte Link bleibt stehen, wenn nur die geprüfte ID
        // nachgereicht wird - sonst waere hinterher nicht mehr erkennbar,
        // welcher Sound urspruenglich gemeint war.
        soundUrl: eingang.url !== undefined ? (eingang.url?.trim() || null) : concept.soundUrl,
        soundAudioId: audioId,
        soundKind: art ?? (audioId === concept.soundAudioId ? concept.soundKind : null),
        soundTitle: eingang.title?.trim() || (audioId === concept.soundAudioId ? concept.soundTitle : null),
        soundArtist: eingang.artist?.trim() || (audioId === concept.soundAudioId ? concept.soundArtist : null),
        soundStatus: status,
        soundNote: eingang.note !== undefined ? (eingang.note?.trim() || null) : concept.soundNote,
        soundCheckedAt: status === "geprueft" ? new Date() : concept.soundCheckedAt,
      },
    });

    const name = [aktualisiert.soundTitle, aktualisiert.soundArtist].filter(Boolean).join(" - ");
    await logActivity(
      `Sound für Konzept "${concept.title}": ${name || audioId} (${status}).`,
      { track: trackFromValue(concept.track) },
    );
    return NextResponse.json(aktualisiert);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
