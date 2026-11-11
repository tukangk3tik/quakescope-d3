import { create } from "zustand";
import type { Event } from "./earthquake";
import type { BoundaryPath } from "./tectonics";
import type { DepthScale } from "./interior";
type State = {
  mode: "live" | "replay";
  source: string;
  timeRange: string;
  minMagnitude: number;
  autoRotate: boolean;
  tectonicPlates: boolean;
  tectonicError: string | null;
  equator: boolean;
  interiorMode: boolean;
  dynamicDayNight: boolean;
  cityLights: boolean;
  depthScale: DepthScale;
  selected: Event | null;
  selectedBoundary: BoundaryPath | null;
  reset: number;
  replayPreset: "24h" | "7d" | "30d";
  replayStart: string;
  replayEnd: string;
  replayMagnitude: number;
  currentTime: string;
  playbackSpeed: 1 | 5 | 10;
  isPlaying: boolean;
  replayEvents: Event[];
};
const replayEnd = new Date().toISOString();
const replayStart = new Date(Date.parse(replayEnd) - 24 * 3_600_000).toISOString();
export const useExplorer = create<State & { set: (v: Partial<State>) => void }>(
  (set) => ({
    mode: "live",
    source: "usgs",
    timeRange: "24h",
    minMagnitude: 2.5,
    autoRotate: true,
    tectonicPlates: true,
    tectonicError: null,
    equator: false,
    interiorMode: false,
    dynamicDayNight: true,
    cityLights: true,
    depthScale: "true",
    selected: null,
    selectedBoundary: null,
    reset: 0,
    replayPreset: "24h",
    replayStart,
    replayEnd,
    replayMagnitude: 2.5,
    currentTime: replayStart,
    playbackSpeed: 1,
    isPlaying: false,
    replayEvents: [],
    set,
  }),
);
