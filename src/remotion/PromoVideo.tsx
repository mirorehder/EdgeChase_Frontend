import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { z } from "zod";

export const sceneSchema = z.object({
  /** Öffentlich per HTTP erreichbare URL des Rohclips (siehe lib/renderStage.ts). */
  src: z.string(),
  startMs: z.number(),
  durationMs: z.number(),
});

export const promoVideoSchema = z.object({
  hookText: z.string(),
  scenes: z.array(sceneSchema).min(1),
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

function wrapLines(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const { width } = measureText({
      text: candidate,
      fontFamily: FONT_FAMILY,
      fontWeight: String(FONT_WEIGHT),
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
  return lines;
}

function fitWrappedText(text: string, maxWidth: number): { fontSize: number; lines: string[] } {
  for (let fontSize = FONT_SIZE_MAX; fontSize >= FONT_SIZE_MIN; fontSize -= 2) {
    const lines = wrapLines(text, fontSize, maxWidth);
    if (lines.length <= MAX_LINES) {
      return { fontSize, lines };
    }
  }
  return { fontSize: FONT_SIZE_MIN, lines: wrapLines(text, FONT_SIZE_MIN, maxWidth) };
}

/** Text-Overlay, das während des ganzen Videos sichtbar bleibt (Auftrag 5.3). */
const HookTextOverlay: React.FC<{ text: string }> = ({ text }) => {
  const { width } = useVideoConfig();
  const maxWidth = width * MAX_TEXT_WIDTH_RATIO;
  const { fontSize, lines } = fitWrappedText(text, maxWidth);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: "12%",
      }}
    >
      <div style={{ width: maxWidth, textAlign: "center" }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: FONT_FAMILY,
              fontWeight: FONT_WEIGHT,
              fontSize,
              lineHeight: LINE_HEIGHT,
              color: "white",
              WebkitTextStroke: "3px black",
              textShadow: "0 0 12px rgba(0,0,0,0.6), 0 0 4px rgba(0,0,0,0.8)",
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const PromoVideo: React.FC<PromoVideoProps> = ({ hookText, scenes }) => {
  const { fps } = useVideoConfig();
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
      <HookTextOverlay text={hookText} />
    </AbsoluteFill>
  );
};
