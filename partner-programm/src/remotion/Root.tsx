import React from "react";
import { Composition } from "remotion";
import { PromoVideo, promoVideoSchema } from "./PromoVideo";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

// Platzhalter für die Remotion-Studio-Vorschau. Beim echten Render kommen
// die tatsächlichen Szenen als inputProps von der Pipeline (lib/render.ts).
const defaultProps = {
  hookText: "First 30 people to comment their name get a custom discount code",
  scenes: [
    { src: "https://remotion-assets.s3.amazonaws.com/example.mp4", startMs: 0, durationMs: 2500 },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="PromoVideo"
      component={PromoVideo}
      durationInFrames={Math.round((10000 / 1000) * FPS)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      schema={promoVideoSchema}
      defaultProps={defaultProps}
      calculateMetadata={async ({ props }) => {
        const totalMs = props.scenes.reduce((sum, s) => sum + s.durationMs, 0);
        return {
          durationInFrames: Math.max(1, Math.round((totalMs / 1000) * FPS)),
        };
      }}
    />
  );
};
