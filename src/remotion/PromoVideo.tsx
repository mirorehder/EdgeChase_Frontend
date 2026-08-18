import React from "react";
import { AbsoluteFill, continueRender, delayRender, OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { z } from "zod";
import { NUNITO_BLACK_WOFF2 } from "./assets/nunito";
import {
  BALOO_700,
  FREDOKA_600,
  NUNITO_700,
  QUICKSAND_700,
} from "./assets/rundschriften";

export const sceneSchema = z.object({
  /** Öffentlich per HTTP erreichbare URL des Rohclips (siehe lib/renderStage.ts). */
  src: z.string(),
  startMs: z.number(),
  durationMs: z.number(),
});

/**
 * Zwei Textgestaltungen: "banner" ist die bisherige - kurzer Hook, grosse
 * Schrift, oberes Bilddrittel. "handwritten" bildet den Stil nach, den der
 * Nutzer als Referenz vorgegeben hat: laengerer Fliesstext ueber mehrere
 * Zeilen, abgerundete fette Schrift, kraeftige schwarze Kontur.
 */
export const textStyleSchema = z.enum([
  "banner",
  "reference",
  // Vorschlaege fuer die Parkour-Edits: runde Schrift, weiss mit leichter
  // schwarzer Kontur, mittig knapp oberhalb der Bildmitte, eher klein.
  "rund-nunito",
  "rund-quicksand",
  "rund-baloo",
  "rund-fredoka",
]);

/**
 * Eine Textphase auf der Zeitachse des Videos.
 *
 * Manche Videos brauchen mehrere Texte nacheinander, damit sie ueberhaupt Sinn
 * ergeben: erst ein unterstellter Vorwurf, dann die Antwort, die die folgende
 * Montage beweist. Ein einziger durchgehender Text kann das nicht leisten.
 */
export const textPhaseSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  durationMs: z.number(),
});

export const promoVideoSchema = z.object({
  hookText: z.string(),
  scenes: z.array(sceneSchema).min(1),
  textStyle: textStyleSchema.optional(),
  /** Originalton der Clips, 0 (stumm) bis 1. Ohne Angabe voll hörbar. */
  videoVolume: z.number().min(0).max(4).optional(),
  /** Leer bedeutet: hookText steht über der ganzen Länge. */
  textPhases: z.array(textPhaseSchema).optional(),
});

export type PromoVideoProps = z.infer<typeof promoVideoSchema>;

const FONT_FAMILY = "Arial, Helvetica, sans-serif";
const FONT_WEIGHT = 800;
const MAX_TEXT_WIDTH_RATIO = 0.84; // Auftrag: "nie an den Rand stoßen"
const LINE_HEIGHT = 1.15;

// Ein einzeiliger Fit (Breite ausnutzen -> Schriftgröße ergibt sich aus der
// Zeichenzahl) macht längere Hook-Texte auf einem 1080px breiten Video
// unlesbar klein. Stattdessen wird auf bis zu drei Zeilen umgebrochen und
// die größtmögliche Schriftgröße in einem festen, gut lesbaren Bereich
// gesucht, die dabei noch in max. drei Zeilen passt.
const FONT_SIZE_MIN = 46;
const FONT_SIZE_MAX = 88;
const MAX_LINES = 3;

interface TextStyleSpec {
  fontFamily: string;
  fontWeight: number;
  maxWidthRatio: number;
  /**
   * Wo die MITTE des Textblocks sitzt, als Anteil der Bildhoehe.
   *
   * Frueher wurde die Oberkante gesetzt (paddingTopRatio). Damit wandert der
   * Block je nach Zeilenzahl nach unten - ein einzeiliger Text sitzt ganz
   * woanders als ein vierzeiliger. Ueber die Mitte bleibt die Lage stabil,
   * egal wie lang der Text ist.
   */
  centerYRatio?: number;
  paddingTopRatio?: number;
  fontSizeMin: number;
  fontSizeMax: number;
  maxLines: number;
  strokePx: number;
  lineHeight: number;
  /** Woher die eingebettete Schrift kommt; leer heisst Systemschrift. */
  fontSource?: { family: string; weight: string; data: string };
}

/**
 * Gemeinsame Grundlage der vier Vorschlaege fuer die Parkour-Edits.
 *
 * Alle teilen: weiss, leichte schwarze Kontur, mittig, knapp oberhalb der
 * Bildmitte, eher klein - gross genug zum Lesen, klein genug, um das Bild
 * nicht zuzudecken.
 */
const RUND_BASIS = {
  maxWidthRatio: 0.78,
  centerYRatio: 0.42,
  // Ein Fuenftel groesser als der erste Entwurf - so gewaehlt an den
  // Musterbildern, die ueber echtem Material gerendert wurden.
  fontSizeMin: 40,
  fontSizeMax: 68,
  maxLines: 4,
  strokePx: 3,
  lineHeight: 1.25,
} as const;

const TEXT_STYLES: Record<z.infer<typeof textStyleSchema>, TextStyleSpec> = {
  banner: {
    fontFamily: FONT_FAMILY,
    fontWeight: FONT_WEIGHT,
    maxWidthRatio: MAX_TEXT_WIDTH_RATIO,
    paddingTopRatio: 0.12,
    fontSizeMin: FONT_SIZE_MIN,
    fontSizeMax: FONT_SIZE_MAX,
    maxLines: MAX_LINES,
    strokePx: 3,
    lineHeight: LINE_HEIGHT,
  },
  // Nachbau der Referenz: mehr Zeilen, deutlich kraeftigere Kontur, Textblock
  // etwas hoeher als die Bildmitte.
  //
  // Der Satzspiegel war zunaechst auf 72 % der Breite gesetzt. An einem echten
  // Render gemessen war das zu schmal: ein Text, dessen Verfasser drei Zeilen
  // gesetzt hat, wurde auf fuenf zerfranste Zeilen umbrochen, weil jede
  // gesetzte Zeile nochmals nicht passte. Mit 84 % bleiben die gesetzten
  // Umbrueche stehen.
  reference: {
    fontFamily: "Nunito, Arial, sans-serif",
    fontWeight: 900,
    maxWidthRatio: 0.84,
    paddingTopRatio: 0.22,
    fontSizeMin: 40,
    fontSizeMax: 72,
    maxLines: 7,
    strokePx: 7,
    lineHeight: 1.2,
  },

  "rund-nunito": {
    ...RUND_BASIS,
    fontFamily: "NunitoRund, Arial, sans-serif",
    fontWeight: 700,
    fontSource: { family: "NunitoRund", weight: "700", data: NUNITO_700 },
  },
  "rund-quicksand": {
    ...RUND_BASIS,
    fontFamily: "Quicksand, Arial, sans-serif",
    fontWeight: 700,
    // Quicksand laeuft schmaler, ein Hauch mehr Groesse gleicht das aus.
    fontSizeMax: 72,
    fontSource: { family: "Quicksand", weight: "700", data: QUICKSAND_700 },
  },
  "rund-baloo": {
    ...RUND_BASIS,
    fontFamily: "Baloo2, Arial, sans-serif",
    fontWeight: 700,
    fontSource: { family: "Baloo2", weight: "700", data: BALOO_700 },
  },
  "rund-fredoka": {
    ...RUND_BASIS,
    fontFamily: "Fredoka, Arial, sans-serif",
    fontWeight: 600,
    fontSource: { family: "Fredoka", weight: "600", data: FREDOKA_600 },
  },
};

/** Bettet die Schrift ein und haelt den Render an, bis sie geladen ist -
 *  sonst wird das erste Bild mit der Ersatzschrift gezeichnet. */
const useEmbeddedFont = (quelle: TextStyleSpec["fontSource"] | null) => {
  const [handle] = React.useState(() => (quelle ? delayRender("Schrift laden") : null));

  React.useEffect(() => {
    if (!quelle || handle === null) return;
    const font = new FontFace(quelle.family, `url(${quelle.data})`, { weight: quelle.weight });
    font
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [quelle, handle]);
};

/**
 * Bricht den Text auf die verfügbare Breite um.
 *
 * Enthält der Text eigene Zeilenumbrüche, werden sie als gesetzte Umbrüche
 * übernommen - dann bestimmt der Verfasser den Satzspiegel. Der automatische
 * Umbruch greift nur noch innerhalb einer zu breiten Zeile. Ohne eigene
 * Umbrüche wird wie bisher rein automatisch umbrochen.
 */
function wrapLines(
  text: string,
  fontSize: number,
  maxWidth: number,
  spec: TextStyleSpec,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const { width } = measureText({
        text: candidate,
        fontFamily: spec.fontFamily,
        fontWeight: String(spec.fontWeight),
        fontSize,
      });

      if (width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

function fitWrappedText(
  text: string,
  maxWidth: number,
  spec: TextStyleSpec,
): { fontSize: number; lines: string[] } {
  // Hat der Verfasser den Text selbst umbrochen, ist diese Zeilenzahl das
  // Ziel, nicht nur die Obergrenze.
  //
  // Ohne diese Unterscheidung sucht die Schleife bloss die groesste Schrift,
  // die irgendwie unter maxLines bleibt - und zerlegt dabei jede gesetzte
  // Zeile weiter. An einem echten Render beobachtet: aus drei gesetzten
  // Zeilen wurden sechs zerfranste, weil sechs eben auch noch unter sieben
  // liegt. Passt die gesetzte Aufteilung selbst bei kleinster Schrift nicht,
  // greift die alte Regel.
  const gesetzteZeilen = text.split("\n").map((l) => l.trim()).filter(Boolean).length;

  if (gesetzteZeilen > 1) {
    for (let fontSize = spec.fontSizeMax; fontSize >= spec.fontSizeMin; fontSize -= 2) {
      const lines = wrapLines(text, fontSize, maxWidth, spec);
      if (lines.length === gesetzteZeilen) {
        return { fontSize, lines };
      }
    }
  }

  for (let fontSize = spec.fontSizeMax; fontSize >= spec.fontSizeMin; fontSize -= 2) {
    const lines = wrapLines(text, fontSize, maxWidth, spec);
    if (lines.length <= spec.maxLines) {
      return { fontSize, lines };
    }
  }
  return { fontSize: spec.fontSizeMin, lines: wrapLines(text, spec.fontSizeMin, maxWidth, spec) };
}

/** Text-Overlay, das während des ganzen Videos sichtbar bleibt (Auftrag 5.3). */
const HookTextOverlay: React.FC<{ text: string; spec: TextStyleSpec }> = ({ text, spec }) => {
  const { width } = useVideoConfig();
  const maxWidth = width * spec.maxWidthRatio;
  const { fontSize, lines } = fitWrappedText(text, maxWidth, spec);

  // Zwei Arten, die Lage zu bestimmen: ueber die Mitte des Textblocks (neu,
  // stabil unabhaengig von der Zeilenzahl) oder ueber die Oberkante (die
  // bisherigen Stile, damit sie sich nicht veraendern).
  const ueberMitte = spec.centerYRatio !== undefined;

  return (
    <AbsoluteFill
      style={
        ueberMitte
          ? { justifyContent: "center", alignItems: "center" }
          : {
              justifyContent: "flex-start",
              alignItems: "center",
              paddingTop: `${(spec.paddingTopRatio ?? 0.12) * 100}%`,
            }
      }
    >
      <div
        style={{
          width: maxWidth,
          textAlign: "center",
          // Aus der Bildmitte um die Differenz nach oben schieben. 0.5 waere
          // genau die Mittellinie, 0.42 sitzt knapp darueber.
          ...(ueberMitte
            ? { transform: `translateY(${((spec.centerYRatio ?? 0.5) - 0.5) * 100}vh)` }
            : {}),
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: spec.fontFamily,
              fontWeight: spec.fontWeight,
              fontSize,
              lineHeight: spec.lineHeight,
              color: "white",
              // paintOrder sorgt dafuer, dass die Kontur hinter der Fuellung
              // liegt - sonst frisst eine breite Kontur die Buchstabenform auf.
              WebkitTextStroke: `${spec.strokePx}px black`,
              paintOrder: "stroke fill",
              textShadow: "0 0 12px rgba(0,0,0,0.5)",
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const PromoVideo: React.FC<PromoVideoProps> = ({
  hookText,
  scenes,
  textStyle,
  videoVolume,
  textPhases,
}) => {
  const { fps } = useVideoConfig();
  const volume = videoVolume ?? 1;
  const spec = TEXT_STYLES[textStyle ?? "banner"];
  // Der alte Referenz-Stil bringt seine Schrift noch ueber den frueheren Weg
  // mit; die neuen tragen ihre Quelle selbst.
  useEmbeddedFont(
    spec.fontSource ??
      (spec.fontFamily.startsWith("Nunito,")
        ? { family: "Nunito", weight: "900", data: NUNITO_BLACK_WOFF2 }
        : null),
  );
  let startFrame = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {scenes.map((scene, index) => {
        const durationInFrames = Math.max(1, Math.round((scene.durationMs / 1000) * fps));
        const startFromFrame = Math.round((scene.startMs / 1000) * fps);
        const sequenceStart = startFrame;
        startFrame += durationInFrames;

        return (
          // Harte Schnitte: keine Overlap-Sequences, keine Überblendung.
          <Sequence
            key={index}
            from={sequenceStart}
            durationInFrames={durationInFrames}
          >
            <OffthreadVideo
              src={scene.src}
              startFrom={startFromFrame}
              // Originalton der Aufnahme. Der Auftrag schliesst nur das
              // Hinzufuegen von Musik aus - vorhandener Ton der Clips bleibt.
              volume={volume}
              muted={volume === 0}
              // Ohne das ignoriert Remotion Werte ueber 1. Das Rohmaterial ist
              // teils sehr leise (an echten Clips gemessen: Spitzen um 3 % der
              // Vollaussteuerung), da hilft nur Verstaerken.
              allowAmplificationDuringRender
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </Sequence>
        );
      })}
      {/* Ohne Phasenangabe steht der eine Text ueber der ganzen Laenge - so
          verhalten sich alle bisherigen Auftraege unveraendert weiter. */}
      {textPhases?.length
        ? textPhases
            .filter((phase) => phase.text.trim())
            .map((phase, i) => (
              <Sequence
                key={`text-${i}`}
                from={Math.round((phase.startMs / 1000) * fps)}
                durationInFrames={Math.max(1, Math.round((phase.durationMs / 1000) * fps))}
                layout="none"
              >
                <HookTextOverlay text={phase.text} spec={spec} />
              </Sequence>
            ))
        : hookText.trim()
          ? <HookTextOverlay text={hookText} spec={spec} />
          : null}
    </AbsoluteFill>
  );
};
