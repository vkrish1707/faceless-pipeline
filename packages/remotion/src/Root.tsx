import { Composition } from "remotion";
import { HelloVideo } from "./HelloVideo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="HelloVideo"
      component={HelloVideo}
      durationInFrames={60}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
