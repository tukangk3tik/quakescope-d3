const DEG = Math.PI / 180;
export type SubsolarPoint = { latitude: number; longitude: number };
export type SunDirection = { x: number; y: number; z: number };
const normalizeLongitude = (longitude: number) => (((longitude + 180) % 360) + 360) % 360 - 180;

/** Approximate apparent geocentric Sun position in Earth-fixed coordinates. */
export function calculateSubsolarPoint(date: Date): SubsolarPoint {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("A valid UTC timestamp is required");
  const julianDay = timestamp / 86_400_000 + 2_440_587.5;
  const centuries = (julianDay - 2_451_545) / 36_525;
  const meanLongitude = (280.46646 + centuries * (36_000.76983 + centuries * 0.0003032)) % 360;
  const meanAnomaly = (357.52911 + centuries * (35_999.05029 - 0.0001537 * centuries)) * DEG;
  const equationOfCenter = Math.sin(meanAnomaly) * (1.914602 - centuries * (0.004817 + 0.000014 * centuries)) + Math.sin(2 * meanAnomaly) * (0.019993 - 0.000101 * centuries) + Math.sin(3 * meanAnomaly) * 0.000289;
  const omega = (125.04 - 1934.136 * centuries) * DEG;
  const apparentLongitude = (meanLongitude + equationOfCenter - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const obliquity = (23 + (26 + (21.448 - centuries * (46.815 + centuries * (0.00059 - centuries * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega)) * DEG;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(apparentLongitude), Math.cos(apparentLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude));
  const gmst = 280.46061837 + 360.98564736629 * (julianDay - 2_451_545) + 0.000387933 * centuries * centuries - (centuries * centuries * centuries) / 38_710_000;
  return { latitude: declination / DEG, longitude: normalizeLongitude(rightAscension / DEG - gmst) };
}
export const calculateSolarPosition = calculateSubsolarPoint;

/** Matches the globe's [x,y,z] = [cos(lat) sin(lon), sin(lat), cos(lat) cos(lon)]. */
export function calculateSunDirection(date: Date): SunDirection {
  const { latitude, longitude } = calculateSubsolarPoint(date);
  const lat = latitude * DEG, lon = longitude * DEG;
  return { x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lon) };
}
export function solarIncidence(latitude: number, longitude: number, sun: SunDirection): number {
  const lat = latitude * DEG, lon = longitude * DEG;
  return Math.cos(lat) * Math.sin(lon) * sun.x + Math.sin(lat) * sun.y + Math.cos(lat) * Math.cos(lon) * sun.z;
}
export function illuminationTimestamp(mode: "live" | "replay", simulatedTimestamp: string, now = new Date()): Date {
  return mode === "replay" ? new Date(simulatedTimestamp) : now;
}
export function isDynamicIlluminationActive(preference: boolean, interiorMode: boolean): boolean {
  return preference && !interiorMode;
}
