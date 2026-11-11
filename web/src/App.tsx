import { Component, type ReactNode, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Scene from "./Scene";
import { useExplorer } from "./store";
import { depthColor, type Event, type Status } from "./earthquake";
import { advanceTime, rangeForPreset, sortChronologically, visibleEventCount } from "./timeline";
import { depthCategory, validDepth } from "./interior";
type Response = {
  events: Event[];
  total: number;
  returned: number;
  truncated: boolean;
  freshness: Status[];
};
type HistoryResponse = Response & { source: string; attribution: string; suggestion?: string };
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal });
  if (!r.ok) throw new Error(`Server returned ${r.status}`);
  return r.json();
}
function usePlayback() {
  const mode = useExplorer((x) => x.mode), playing = useExplorer((x) => x.isPlaying);
  const frame = useRef<number | null>(null), previous = useRef<number | null>(null);
  useEffect(() => {
    if (mode !== "replay" || !playing) { previous.current = null; return; }
    const tick = (now: number) => {
      if (previous.current !== null) {
        const state = useExplorer.getState();
        const next = advanceTime(state.currentTime, state.replayStart, state.replayEnd, state.playbackSpeed, Math.min(now - previous.current, 250));
        state.set({ currentTime: next.currentTime, isPlaying: !next.complete });
      }
      previous.current = now;
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); previous.current = null; };
  }, [mode, playing]);
}
class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="webgl-error">
        3D rendering unavailable. Explore real events in the list below.
      </p>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const s = useExplorer();
  usePlayback();
  const live = useQuery({
    queryKey: ["earthquakes", s.source, s.timeRange, s.minMagnitude],
    queryFn: ({ signal }) =>
      get<Response>(
        `/api/v1/earthquakes?source=${s.source}&timeRange=${s.timeRange}&minMagnitude=${s.minMagnitude}&limit=1000`,
        signal,
      ),
    refetchInterval: s.mode === "live" ? 60000 : false,
    enabled: s.mode === "live",
  });
  const history = useQuery({
    queryKey: ["history", s.replayStart, s.replayEnd, s.replayMagnitude],
    queryFn: ({ signal }) => get<HistoryResponse>(`/api/v1/earthquakes/history?start=${encodeURIComponent(s.replayStart)}&end=${encodeURIComponent(s.replayEnd)}&minMagnitude=${s.replayMagnitude}&limit=1500`, signal),
    enabled: s.mode === "replay",
    retry: 1,
  });
  useEffect(() => {
    if (s.mode !== "replay" || !history.data) return;
    const replayEvents = sortChronologically(history.data.events);
    s.set({ replayEvents, currentTime: s.replayStart, isPlaying: replayEvents.length > 0, selected: null });
  }, [history.data, s.mode, s.replayStart, s.set]);
  const visibleCount = useMemo(() => visibleEventCount(s.replayEvents, s.currentTime), [s.replayEvents, s.currentTime]);
  const events = s.mode === "replay" ? s.replayEvents.slice(0, visibleCount) : (live.data?.events ?? []);
  useEffect(() => {
    if (s.mode === "replay" && s.selected && Date.parse(s.selected.occurredAt) > Date.parse(s.currentTime)) s.set({ selected: null });
  }, [s.currentTime, s.mode, s.selected, s.set]);
  const activeQuery = s.mode === "live" ? live : history;
  const statuses = live.data?.freshness ?? [];
  const stale = s.mode === "live" && statuses.some((x) => x.stale);
  const max = events.length
    ? Math.max(...events.map((e) => e.magnitude)).toFixed(1)
    : "—";
  const selected = s.selected;
  const boundary = s.selectedBoundary;
  return (
    <main>
      <div className="scene">
        <SceneBoundary>
          <Scene events={events} />
        </SceneBoundary>
      </div>
      <header>
        <a className="brand" href="/">
          ◉{" "}
          <span>
            QUAKESCOPE<small>EARTH OBSERVATORY / 3D</small>
          </span>
        </a>
        <div className="sync">
          <i className={stale || activeQuery.isError ? "warn" : ""} />
          {activeQuery.isPending
            ? "CONNECTING"
            : activeQuery.isError
              ? "CONNECTION FAILED"
              : stale
                ? "SOURCE STALE"
                : "SYNCHRONIZED"}
        </div>
        <nav aria-label="Mode and data source">
          <button aria-pressed={s.mode === "live"} onClick={() => s.set({ mode: "live", isPlaying: false, selected: null })}>LIVE</button>
          <button aria-pressed={s.mode === "replay"} onClick={() => { const r = rangeForPreset("24h"); s.set({ mode: "replay", replayPreset: "24h", replayStart: r.startTime, replayEnd: r.endTime, replayMagnitude: r.minMagnitude, currentTime: r.startTime, isPlaying: false, selected: null }); }}>TIME MACHINE</button>
          {s.mode === "live" && ["all", "usgs", "bmkg"].map((x) => (
            <button
              key={x}
              aria-pressed={s.source === x}
              onClick={() => s.set({ source: x, selected: null })}
            >
              {x.toUpperCase()}
            </button>
          ))}
        </nav>
      </header>
      <section className="intro">
        <p className="eyebrow">A PLANET IN MOTION</p>
        <h1>
          Feel the pulse
          <br />
          of Earth.
        </h1>
        <p>
          Explore seismic activity across
          <br />
          our ever-changing planet.
        </p>
      </section>
      <aside className="filters glass">
        <p className="eyebrow">EXPLORATION CONTROLS</p>
        {s.mode === "live" ? <>
        <label>Observation window</label>
        <div className="segments">
          {["24h", "7d"].map((x) => (
            <button
              key={x}
              aria-pressed={s.timeRange === x}
              onClick={() => s.set({ timeRange: x, selected: null })}
            >
              {x === "24h" ? "Past 24 hours" : "Past 7 days"}
            </button>
          ))}
        </div>
        <label>Minimum magnitude</label>
        <div className="segments">
          {[2.5, 4.5, 6].map((x) => (
            <button key={x} aria-pressed={s.minMagnitude === x} onClick={() => s.set({ minMagnitude: x, selected: null })}>M {x.toFixed(1)}+</button>
          ))}
        </div>
        </> : <>
          <label>Historical preset</label>
          <div className="segments">
            {(["24h", "7d", "30d"] as const).map((preset) => <button key={preset} aria-pressed={s.replayPreset === preset} onClick={() => { const r = rangeForPreset(preset); s.set({ replayPreset: preset, replayStart: r.startTime, replayEnd: r.endTime, replayMagnitude: r.minMagnitude, currentTime: r.startTime, isPlaying: false, selected: null }); }}>{preset}</button>)}
          </div>
          <label>Historical minimum magnitude</label>
          <div className="segments">
            {[2.5, 4, 4.5, 6].map((m) => <button key={m} aria-pressed={s.replayMagnitude === m} onClick={() => s.set({ replayMagnitude: m, isPlaying: false, selected: null })}>M {m}+</button>)}
          </div>
        </>}
        <label className="toggle">
          <input
            type="checkbox"
            checked={s.tectonicPlates}
            onChange={(e) =>
              s.set({
                tectonicPlates: e.target.checked,
                selectedBoundary: e.target.checked ? boundary : null,
              })
            }
          />{" "}
          Tectonic boundaries
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={s.interiorMode}
            onChange={(e) => s.set({ interiorMode: e.target.checked })}
          />{" "}
          Earth Interior / X-Ray
        </label>
        <label className="toggle">
          <input type="checkbox" checked={s.equator} onChange={(e) => s.set({ equator: e.target.checked })} />{" "}
          Equator
        </label>
        <label className="toggle">
          <input type="checkbox" checked={s.dynamicDayNight} onChange={(e) => s.set({ dynamicDayNight: e.target.checked })} />{" "}
          Dynamic Day/Night
        </label>
        <label className={`toggle${!s.dynamicDayNight ? " inactive" : ""}`}>
          <input type="checkbox" checked={s.cityLights} disabled={!s.dynamicDayNight} onChange={(e) => s.set({ cityLights: e.target.checked })} />{" "}
          City Lights {!s.dynamicDayNight && <small>(inactive)</small>}
        </label>
        {s.interiorMode && <>
          <label>Hypocenter visualization</label>
          <div className="segments" aria-label="Hypocenter depth scale">
            <button aria-pressed={s.depthScale === "true"} onClick={() => s.set({ depthScale: "true" })}>True scale</button>
            <button aria-pressed={s.depthScale === "enhanced"} onClick={() => s.set({ depthScale: "enhanced" })}>Enhanced</button>
          </div>
          <p className="scale-note">{s.depthScale === "true" ? "True depth scale" : "Enhanced depth · 8× visual exaggeration · not to scale"}</p>
        </>}
        <label className="toggle">
          <input
            type="checkbox"
            checked={s.autoRotate}
            onChange={(e) => s.set({ autoRotate: e.target.checked })}
          />{" "}
          Auto-rotate Earth
        </label>
        <button
          className="reset"
          onClick={() => s.set({ reset: s.reset + 1, selected: null })}
        >
          ↺ Reset view
        </button>
      </aside>
      <section className="summary glass">
        <div>
          <strong>{events.length}</strong>
          <small>DISPLAYED EVENTS</small>
        </div>
        <div>
          <strong>
            {max}
            <em> M</em>
          </strong>
          <small>MAX MAGNITUDE</small>
        </div>
        <div>
          <strong>
            {events.length
              ? (
                  events.reduce((a, e) => a + e.depthKm, 0) / events.length
                ).toFixed(0)
              : "—"}
            <em> km</em>
          </strong>
          <small>AVG DEPTH</small>
        </div>
      </section>
      <aside className="events glass">
        <p className="eyebrow">
          SEISMIC ACTIVITY <span>{s.mode === "replay" ? "USGS HISTORY" : s.timeRange.toUpperCase()}</span>
        </p>
        {activeQuery.isPending && <p role="status">Receiving observatory data…</p>}
        {activeQuery.isError && (
          <p role="alert">
            Unable to reach the backend.{" "}
            <button onClick={() => activeQuery.refetch()}>Retry</button>
          </p>
        )}
        {s.tectonicError && (
          <p className="notice" role="status">
            {s.tectonicError} Earthquake monitoring remains available.
          </p>
        )}
        {!activeQuery.isPending && !activeQuery.isError && !(s.mode === "replay" ? s.replayEvents : events).length && (
          <p>No events match these filters.</p>
        )}
        {(s.mode === "replay" ? history.data : live.data)?.truncated && (
          <p>
            Showing {(s.mode === "replay" ? history.data : live.data)?.returned} of {(s.mode === "replay" ? history.data : live.data)?.total} matching events. {history.data?.suggestion}
          </p>
        )}
        {s.mode === "live" && s.source !== "usgs" && (
          <p className="notice">
            BMKG publishes limited recent categories, not complete coverage of
            this time window. Sources may report the same event separately.
          </p>
        )}
        <div className="event-list">
          {events.map((e) => (
            <button
              className="event"
              key={e.id}
              aria-pressed={selected?.id === e.id}
              onClick={() => s.set({ selected: e, isPlaying: s.mode === "replay" ? false : s.isPlaying })}
            >
              <b style={{ color: depthColor(e.depthKm) }}>
                {e.magnitude.toFixed(1)}
              </b>
              <span>
                {e.location}
                <small>
                  {e.source.toUpperCase()} ·{" "}
                  {new Date(e.occurredAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              <span>↗</span>
            </button>
          ))}
        </div>
      </aside>
      {s.interiorMode && !selected && (
        <p className="interior-hint glass" role="status">Select an earthquake to explore its depth.</p>
      )}
      {selected && (
        <aside className="details glass" aria-label="Earthquake details">
          <button
            className="close"
            aria-label="Close details"
            onClick={() => s.set({ selected: null })}
          >
            ×
          </button>
          <p className="eyebrow">
            SELECTED EPICENTER / {selected.source.toUpperCase()}
          </p>
          <details open>
            <summary>
              <b style={{ color: depthColor(selected.depthKm) }}>
                M {selected.magnitude.toFixed(1)}
              </b>
              <h2>{selected.location}</h2>
            </summary>
            <dl>
              <dt>Depth</dt>
              <dd>{Number.isFinite(selected.depthKm) ? `${selected.depthKm} km` : "Unavailable (not reported)"}</dd>
              <dt>Depth class</dt>
              <dd>{depthCategory(selected.depthKm)} <small>· informational only</small></dd>
              <dt>Occurred</dt>
              <dd>
                {new Date(selected.occurredAt).toLocaleString()}
                <br />
                {selected.occurredAt} UTC
              </dd>
              <dt>Coordinates</dt>
              <dd>
                {selected.latitude.toFixed(3)}°, {selected.longitude.toFixed(3)}
                °
              </dd>
              <dt>Source</dt>
              <dd>{selected.source.toUpperCase()}</dd>
              {s.interiorMode && <>
                <dt>X-Ray position</dt>
                <dd>{validDepth(selected.depthKm) ? (s.depthScale === "true" ? "True depth scale" : "Enhanced 8× · visualization only · not to scale") : selected.depthKm < 0 ? `Unavailable: reported depth is ${selected.depthKm} km` : "Unavailable for invalid or missing depth"}</dd>
              </>}
            </dl>
            {selected.felt && <p>Felt: {selected.felt}</p>}
            {selected.tsunamiInformation && (
              <p>{selected.tsunamiInformation}</p>
            )}
            {selected.detailUrl && (
              <a href={selected.detailUrl} target="_blank" rel="noreferrer">
                Official source ↗
              </a>
            )}
          </details>
        </aside>
      )}
      {boundary && (
        <aside className="details glass" aria-label="Tectonic boundary details">
          <button
            className="close"
            aria-label="Close boundary details"
            onClick={() => s.set({ selectedBoundary: null })}
          >
            ×
          </button>
          <p className="eyebrow">SELECTED TECTONIC BOUNDARY / PB2002</p>
          <h2>{boundary.name || "Unnamed boundary"}</h2>
          <dl>
            {boundary.plateA && (
              <>
                <dt>Plate A</dt>
                <dd>{boundary.plateA}</dd>
              </>
            )}
            {boundary.plateB && (
              <>
                <dt>Plate B</dt>
                <dd>{boundary.plateB}</dd>
              </>
            )}
            {boundary.type && (
              <>
                <dt>Type</dt>
                <dd>{boundary.type}</dd>
              </>
            )}
            {boundary.source && (
              <>
                <dt>Source</dt>
                <dd>{boundary.source}</dd>
              </>
            )}
          </dl>
          <p className="model-note">
            Published geological model; not a real-time measurement of plate
            motion.
          </p>
        </aside>
      )}
      {s.mode === "replay" && (
        <section className="timeline glass" aria-label="Earthquake time machine controls">
          <div className="timeline-head">
            <span className="eyebrow">EARTHQUAKE TIME MACHINE · USGS CATALOG</span>
            <button onClick={() => s.set({ mode: "live", isPlaying: false, selected: null })}>EXIT TO LIVE</button>
          </div>
          <div className="timeline-controls">
            <button aria-label={s.isPlaying ? "Pause replay" : "Play replay"} disabled={history.isPending || !s.replayEvents.length} onClick={() => s.set({ isPlaying: !s.isPlaying, currentTime: !s.isPlaying && Date.parse(s.currentTime) >= Date.parse(s.replayEnd) ? s.replayStart : s.currentTime })}>{s.isPlaying ? "Ⅱ" : "▶"}</button>
            <button aria-label="Restart replay" onClick={() => s.set({ currentTime: s.replayStart, isPlaying: false, selected: null })}>↺</button>
            <time>{new Date(s.currentTime).toISOString().replace(".000", "")}</time>
            <div className="speed" aria-label="Playback speed">{([1, 5, 10] as const).map((speed) => <button key={speed} aria-pressed={s.playbackSpeed === speed} onClick={() => s.set({ playbackSpeed: speed })}>{speed}×</button>)}</div>
          </div>
          <input className="timeline-slider" aria-label="Simulated UTC time" type="range" min="0" max="1000" value={Math.round(1000 * (Date.parse(s.currentTime) - Date.parse(s.replayStart)) / Math.max(1, Date.parse(s.replayEnd) - Date.parse(s.replayStart)))} onChange={(e) => { const ratio = Number(e.target.value) / 1000; const next = new Date(Date.parse(s.replayStart) + ratio * (Date.parse(s.replayEnd) - Date.parse(s.replayStart))).toISOString(); s.set({ currentTime: next, isPlaying: false }); }} />
          <div className="timeline-range"><time>{new Date(s.replayStart).toISOString().slice(0, 16).replace("T", " ")} UTC</time><span>{visibleCount} / {s.replayEvents.length} events · speed compresses the selected range into a two-minute 1× visualization</span><time>{new Date(s.replayEnd).toISOString().slice(0, 16).replace("T", " ")} UTC</time></div>
        </section>
      )}
      <div className="legend">
        <p className="eyebrow">EPICENTER DEPTH</p>
        <span style={{ color: depthColor(0) }}>● &lt;70 km</span>
        <span style={{ color: depthColor(70) }}>● 70–299 km</span>
        <span style={{ color: depthColor(300) }}>● ≥300 km</span>
        {s.tectonicPlates && <span className="tectonic-key">━ PLATE BOUNDARY</span>}
        <small>
          Marker size indicates magnitude · Drag to orbit / scroll to zoom
        </small>
      </div>
      <footer>
        <span>
          DATA: <a href="https://earthquake.usgs.gov">USGS</a> +{" "}
          <a href="https://data.bmkg.go.id/gempabumi/">BMKG</a> · TECTONICS:{" "}
          <a href="https://github.com/fraxen/tectonicplates">
            PB2002 / Bird 2003
          </a>{" "}
          · IMAGERY: NASA BLUE MARBLE + BLACK MARBLE
        </span>
        <span>
          Data may be delayed or revised. Not an early-warning system.
        </span>
        <span>
          {statuses
            .map(
              (x) =>
                `${x.source.toUpperCase()}: ${x.lastSuccessfulSync ? new Date(x.lastSuccessfulSync).toLocaleTimeString() : "awaiting sync"}${x.stale ? " (stale)" : ""}${x.error ? " · " + x.error : ""}`,
            )
            .join(" / ")}
        </span>
      </footer>
    </main>
  );
}
