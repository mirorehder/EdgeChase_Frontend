import React from "react";
import { AbsoluteFill, continueRender, delayRender, OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { z } from "zod";
import { NUNITO_BLACK_WOFF2 } from "./assets/nunito";

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
export const textStyleSchema = z.enum(["banner", "reference"]);

export const promoVideoSchema = z.object({
  hookText: z.string(),
  scenes: z.array(sceneSchema).min(1),
  textStyle: textStyleSchema.optional(),
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
  paddingTopRatio: number;
  fontSizeMin: number;
  fontSizeMax: number;
  maxLines: number;
  strokePx: number;
  lineHeight: number;
}

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
  // Nachbau der Referenz: schmalerer Satzspiegel, mehr Zeilen, deutlich
  // kraeftigere Kontur, Textblock etwas hoeher als die Bildmitte.
  reference: {
    fontFamily: "Nunito, Arial, sans-serif",
    fontWeight: 900,
    maxWidthRatio: 0.72,
    paddingTopRatio: 0.22,
    fontSizeMin: 40,
    fontSizeMax: 66,
    maxLines: 7,
    strokePx: 7,
    lineHeight: 1.2,
  },
};

/** Bettet die Schrift ein und haelt den Render an, bis sie geladen ist -
 *  sonst wird das erste Bild mit der Ersatzschrift gezeichnet. */
const useEmbeddedFont = (enabled: boolean) => {
  const [handle] = React.useState(() => (enabled ? delayRender("Schrift laden") : null));

  React.useEffect(() => {
    if (!enabled || handle === null) return;
    const font = new FontFace("Nunito", `url(${NUNITO_BLACK_WOFF2})`, { weight: "900" });
    font
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [enabled, handle]);
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

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: `${spec.paddingTopRatio * 100}%`,
      }}
    >
      <div style={{ width: maxWidth, textAlign: "center" }}>
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

export const PromoVideo: React.FC<PromoVideoProps> = ({ hookText, scenes, textStyle }) => {
  const { fps } = useVideoConfig();
  const spec = TEXT_STYLES[textStyle ?? "banner"];
  useEmbeddedFont(spec.fontFamily.startsWith("Nunito"));
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
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </Sequence>
        );
      })}
      {hookText.trim() ? <HookTextOverlay text={hookText} spec={spec} /> : null}
    </AbsoluteFill>
  );
};
