import { test, expect } from "vitest";
import { useExplorer } from "./store";
test("filter changes and accessible selection share state", () => {
  useExplorer
    .getState()
    .set({ source: "bmkg", timeRange: "7d", minMagnitude: 6 });
  expect(useExplorer.getState().source).toBe("bmkg");
  expect(useExplorer.getState().minMagnitude).toBe(6);
  useExplorer.getState().set({
    selected: {
      id: "test",
      source: "bmkg",
      sourceId: "test",
      latitude: -6,
      longitude: 110,
      magnitude: 6,
      depthKm: 10,
      location: "Test fixture",
      occurredAt: "2026-11-08T00:00:00Z",
    },
  });
  expect(useExplorer.getState().selected?.id).toBe("test");
  useExplorer.getState().set({ selected: null });
  expect(useExplorer.getState().selected).toBeNull();
});
test("equator and interior default off and toggle independently", () => {
  useExplorer.setState({ equator: false, interiorMode: false, depthScale: "true" });
  expect(useExplorer.getState().equator).toBe(false);
  expect(useExplorer.getState().interiorMode).toBe(false);
  useExplorer.getState().set({ equator: true });
  expect(useExplorer.getState().interiorMode).toBe(false);
  useExplorer.getState().set({ interiorMode: true, depthScale: "enhanced" });
  expect(useExplorer.getState().equator).toBe(true);
  expect(useExplorer.getState().depthScale).toBe("enhanced");
  useExplorer.setState({ equator: false, interiorMode: false, depthScale: "true" });
});
test("tectonic layer visibility is interaction state", () => {
  useExplorer.getState().set({ tectonicPlates: false });
  expect(useExplorer.getState().tectonicPlates).toBe(false);
  useExplorer.getState().set({ tectonicPlates: true });
});
test("tectonic selection does not alter earthquake filters or selection", () => {
  const before = useExplorer.getState();
  useExplorer.getState().set({
    selectedBoundary: {
      id: "boundary",
      name: "AA-BB",
      plateA: "AA",
      plateB: "BB",
      type: "",
      source: "PB2002",
      points: [],
    },
  });
  const after = useExplorer.getState();
  expect(after.source).toBe(before.source);
  expect(after.timeRange).toBe(before.timeRange);
  expect(after.minMagnitude).toBe(before.minMagnitude);
  expect(after.selected).toBe(before.selected);
  expect(after.selectedBoundary?.id).toBe("boundary");
  useExplorer.getState().set({ selectedBoundary: null });
});
test("interior controls remain independent from live and replay state", () => {
  const mode = useExplorer.getState().mode;
  useExplorer.getState().set({ interiorMode: true, depthScale: "enhanced" });
  expect(useExplorer.getState().mode).toBe(mode);
  expect(useExplorer.getState().interiorMode).toBe(true);
  expect(useExplorer.getState().depthScale).toBe("enhanced");
  useExplorer.getState().set({ interiorMode: false, depthScale: "true" });
});
test("day/night controls default on and retain the city-light preference", () => {
  useExplorer.setState({ dynamicDayNight: true, cityLights: true, interiorMode: false });
  expect(useExplorer.getState().dynamicDayNight).toBe(true);
  expect(useExplorer.getState().cityLights).toBe(true);
  useExplorer.getState().set({ dynamicDayNight: false });
  expect(useExplorer.getState().cityLights).toBe(true);
  useExplorer.getState().set({ interiorMode: true });
  expect(useExplorer.getState().dynamicDayNight).toBe(false);
  useExplorer.setState({ dynamicDayNight: true, cityLights: true, interiorMode: false });
});
