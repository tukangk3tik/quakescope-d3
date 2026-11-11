import { describe, expect, test } from "vitest";
import { calculateSubsolarPoint, calculateSunDirection, illuminationTimestamp, isDynamicIlluminationActive, solarIncidence } from "./solar";
describe("solar position", () => {
  test("puts the equinox Sun near the equator and Greenwich at noon UTC", () => {
    const point = calculateSubsolarPoint(new Date("2024-03-20T12:00:00Z"));
    expect(Math.abs(point.latitude)).toBeLessThan(0.5);
    expect(Math.abs(point.longitude)).toBeLessThan(3);
  });
  test("tracks seasonal declination at the solstices", () => {
    expect(calculateSubsolarPoint(new Date("2024-06-20T20:51:00Z")).latitude).toBeCloseTo(23.44, 1);
    expect(calculateSubsolarPoint(new Date("2024-12-21T09:21:00Z")).latitude).toBeCloseTo(-23.44, 1);
  });
  test("identifies opposite day and night hemispheres", () => {
    const date = new Date("2024-03-20T12:00:00Z");
    const point = calculateSubsolarPoint(date), sun = calculateSunDirection(date);
    expect(solarIncidence(point.latitude, point.longitude, sun)).toBeGreaterThan(0.999);
    expect(solarIncidence(-point.latitude, point.longitude + 180, sun)).toBeLessThan(-0.999);
  });
  test("is deterministic for an absolute UTC instant", () => {
    const instant = new Date("2024-03-21T12:00:00.000Z");
    expect(calculateSunDirection(new Date(instant.getTime()))).toEqual(calculateSunDirection(instant));
  });
});
describe("time machine illumination clock", () => {
  test("uses wall-clock UTC in live mode and simulated UTC in replay", () => {
    const now = new Date("2025-01-02T03:04:05Z");
    expect(illuminationTimestamp("live", "2000-01-01T00:00:00Z", now)).toBe(now);
    expect(illuminationTimestamp("replay", "2000-01-01T00:00:00Z", now).toISOString()).toBe("2000-01-01T00:00:00.000Z");
  });
  test("suspends the material effect for X-Ray without changing its preference", () => {
    expect(isDynamicIlluminationActive(true, false)).toBe(true);
    expect(isDynamicIlluminationActive(true, true)).toBe(false);
    expect(isDynamicIlluminationActive(true, false)).toBe(true);
    expect(isDynamicIlluminationActive(false, false)).toBe(false);
  });
});
