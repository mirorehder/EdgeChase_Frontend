import { Type } from "@google/genai";
import { client, MODEL } from "./gemini";
import type { SoundKandidat } from "./soundRegeln";

/**
 * Die zwei KI-Aufgaben der Sound-Wahl:
 *
 *  1. bewerteSound: Gemini HÖRT den Sound (kurze Audiodatei aus dem Katalog)
 *     und beschreibt ihn - wie aggressiv, wie stark am Anfang, welche Stimmung.
 *     Das passiert einmal pro Sound beim Aufnehmen in die Bibliothek.
 *  2. waehleBestenSound: Gemini sucht aus den besten Kandidaten den, der zu
 *     DIESEM Video passt (Stimmung, Tempo, Thema).
 */

export interface SoundBewertung {
  druck: number;
  startStaerke: number;
  saisonal: boolean;
  tauglich: boolean;
  vibeTags: string[];
  vibeBeschreibung: string;
}

/**
 * Dein Geschmack als Maßstab. Zu Beginn steht hier, was du bisher gesagt hast;
 * sobald du in der Bibliothek Daumen vergibst, kommen deren Sounds dazu.
 */
export interface Geschmack {
  gut: string[];
  schlecht: string[];
}

export const START_GESCHMACK: Geschmack = {
  gut: [
    "Lala Miyagi - Chief Keef x M.IA mix (harter, treibender Rap-Beat)",
    "DROP IT LIKE ITS HOT x STAYIN ALIVE (ALTÉGO MIX) (wuchtiger, tanzbarer Mashup-Remix)",
  ],
  schlecht: [
    "Sparks by Evan Jacobson (viel zu chillig, gemütlich)",
    "unbekannte Phonk-Sounds von Kleinst-Creatorn (müllig, nicht bekannt)",
  ],
};

function geschmackText(g: Geschmack): string {
  const gut = g.gut.map((t) => `- ${t}`).join("\n");
  const schlecht = g.schlecht.map((t) => `- ${t}`).join("\n");
  return `Der Geschmack des Auftraggebers - daran misst du:
So soll es klingen (gut):
${gut || "- (noch keine Angabe)"}
So nicht (schlecht):
${schlecht || "- (noch keine Angabe)"}
Bewerte streng nach diesem Maßstab: ein Sound, der eher wie die guten klingt, bekommt hohe Werte; was eher wie die schlechten klingt (zu weich, zu verträumt, beliebig), bekommt niedrige.`;
}

const zahl01 = (v: unknown, standard: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : standard;
};

export async function bewerteSound(
  audio: Buffer,
  info: { titel: string; kuenstler: string | null; dauerMs: number },
  geschmack: Geschmack = START_GESCHMACK,
): Promise<SoundBewertung> {
  const ai = client();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "video/mp4", data: audio.toString("base64") } },
          {
            text: `Du bewertest einen Sound für Instagram Reels (Parkour-, Streetwear- und Coaching-Edits). Er wird unter Videos gelegt, die schnell geschnitten sind.

Titel: "${info.titel}"${info.kuenstler ? ` von ${info.kuenstler}` : ""}, Länge ${Math.round(info.dauerMs / 1000)} s.

Höre genau hin und bewerte:
- druck (0 bis 1): wie aggressiv, pushend und treibend. 1 = harter Beat, Bass, Energie, Adrenalin (Phonk, Drill, harter Techno, wuchtige Trap-Drops). 0 = sanft, ruhig, verträumt, romantisch.
- startStaerke (0 bis 1): wie stark der Sound sofort ab Sekunde 0 einsetzt. 1 = Beat/Drop/Hook von der ersten Sekunde an. 0 = langes ruhiges Intro, leises Aufbauen.
- saisonal: true bei Weihnachten, Silvester, Halloween oder klarem Sommerhit-Charakter - also nicht das ganze Jahr nutzbar.
- tauglich: false, wenn der Sound unter einem Sportvideo nicht funktioniert: gesprochener Text/Podcast/Rede, reine Geräusche, Gesang mit klar erkennbarem Text, der vom Video ablenkt und zu keinem Thema passt, schlechte Tonqualität. Instrumentale oder stark bearbeitete Beats sind tauglich.
- vibeTags: 2 bis 5 kurze englische Stichworte zur Stimmung, z. B. "aggressive", "dark", "phonk", "hype", "motivational", "bass-heavy", "cinematic", "chill", "emotional".
- vibeBeschreibung: ein Satz auf Deutsch, was der Sound auslöst und zu welchen Bildern er passt.

${geschmackText(geschmack)}\n\nSei streng bei druck und startStaerke - die meisten Sounds sind nicht hart.`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          druck: { type: Type.NUMBER },
          startStaerke: { type: Type.NUMBER },
          saisonal: { type: Type.BOOLEAN },
          tauglich: { type: Type.BOOLEAN },
          vibeTags: { type: Type.ARRAY, items: { type: Type.STRING } },
          vibeBeschreibung: { type: Type.STRING },
        },
        required: ["druck", "startStaerke", "saisonal", "tauglich", "vibeTags", "vibeBeschreibung"],
      },
    },
  });

  const roh = JSON.parse(response.text ?? "{}") as Partial<SoundBewertung>;
  return {
    druck: zahl01(roh.druck, 0.3),
    startStaerke: zahl01(roh.startStaerke, 0.3),
    saisonal: roh.saisonal === true,
    tauglich: roh.tauglich !== false,
    vibeTags: Array.isArray(roh.vibeTags)
      ? roh.vibeTags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 6)
      : [],
    vibeBeschreibung: String(roh.vibeBeschreibung ?? "").trim().slice(0, 300),
  };
}

export interface VideoBeschreibung {
  /** "Parkour-Edit", "Streetwear-Werbung", "Coaching" ... */
  art: string;
  hookText: string;
  titel: string;
  thema: string | null;
  /** Kurze Beschreibungen der gezeigten Momente. */
  momente: string[];
  sekunden: number;
}

/**
 * Wählt aus den besten Kandidaten den passendsten Sound für dieses Video.
 * Gibt die audioId zurück oder null (dann gilt der Spitzenreiter der Rangliste).
 */
export async function waehleBestenSound(
  video: VideoBeschreibung,
  kandidaten: SoundKandidat[],
  geschmack: Geschmack = START_GESCHMACK,
): Promise<{ audioId: string; grund: string } | null> {
  if (kandidaten.length === 0) return null;
  if (kandidaten.length === 1) {
    return { audioId: kandidaten[0].audioId, grund: "einziger Kandidat" };
  }
  try {
    const liste = kandidaten
      .map(
        (k, i) =>
          `${i + 1}. "${k.titel}"${k.kuenstler ? ` (${k.kuenstler})` : ""} - Druck ${(k.druck ?? 0).toFixed(1)}, ` +
          `Start ${(k.startStaerke ?? 0).toFixed(1)}, Stimmung: ${k.vibeTags.join(", ") || "unbekannt"}. ` +
          `${k.vibeBeschreibung ?? ""}`,
      )
      .join("\n");
    const momente = video.momente.slice(0, 8).map((m, i) => `${i + 1}. ${m}`).join("\n");

    const ai = client();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Du wählst den Sound für ein Instagram Reel. Es soll aggressiv und pushend wirken, und der Sound muss wirklich zum Video passen - zu Tempo, Stimmung und Thema.

Das Video: ${video.art}, ${video.sekunden} s.
Titel: ${video.titel || "-"}
Eingeblendeter Text: ${video.hookText.replace(/\n/g, " ") || "-"}
${video.thema ? `Thema/Regie: ${video.thema}\n` : ""}${momente ? `Gezeigte Momente:\n${momente}\n` : ""}
Kandidaten:
${liste}

${geschmackText(geschmack)}

Wähle den EINEN besten. Achte darauf, dass die Stimmung des Sounds zum Inhalt passt (z. B. hartes Training und krasse Tricks brauchen harten Druck, eine ironische Serie darf verspielter sein). Antworte mit der Nummer und einem kurzen Grund.`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { nummer: { type: Type.INTEGER }, grund: { type: Type.STRING } },
          required: ["nummer", "grund"],
        },
      },
    });
    const roh = JSON.parse(response.text ?? "{}") as { nummer?: number; grund?: string };
    const gewaehlt = kandidaten[Math.round(Number(roh.nummer)) - 1];
    if (gewaehlt) return { audioId: gewaehlt.audioId, grund: String(roh.grund ?? "").slice(0, 200) };
  } catch (err) {
    console.warn("Sound-Passung ohne Modell:", err instanceof Error ? err.message : err);
  }
  return null;
}
