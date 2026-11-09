// Runs the face-spike calibration off the main thread. The solve is ~0.5 s on a desktop and
// several times that on a Quest; on the main thread it would freeze the headset view, which in
// passthrough AR is both jarring and a nausea trigger.
import { calibrate } from "./faceSpike";
import type { CalSample, CamParams } from "./faceSpike";

export interface CalRequest {
  samples: CalSample[];
  start: CamParams;
  eyeSpanM: number;
  aspect: number;
}

self.onmessage = (e: MessageEvent<CalRequest>) => {
  const { samples, start, eyeSpanM, aspect } = e.data;
  self.postMessage(calibrate(samples, start, eyeSpanM, aspect));
};
