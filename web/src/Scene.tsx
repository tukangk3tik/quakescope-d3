import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, Stars } from "@react-three/drei";
import Globe from "r3f-globe";
import {
  Vector3,
  Quaternion,
  InstancedMesh,
  Object3D,
  Color,
  AdditiveBlending,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import type { OrbitControls as Controls } from "three-stdlib";
import { depthColor, markerSize, position, type Event } from "./earthquake";
import { useExplorer } from "./store";
import { loadBoundaries, type BoundaryPath } from "./tectonics";
import { hypocenterPosition } from "./interior";
import { equatorPoints } from "./equator";
import { calculateSunDirection, illuminationTimestamp, isDynamicIlluminationActive } from "./solar";
function Camera() {
  const controls = useRef<Controls>(null);
  const { camera } = useThree();
  const selected = useExplorer((s) => s.selected),
    reset = useExplorer((s) => s.reset),
    auto = useExplorer((s) => s.autoRotate);
  const target = useRef<Vector3 | null>(null);
  const idle = useRef(0);
  const interacting = useRef(false);
  const rotation = useRef(new Quaternion());
  const direction = useRef(new Vector3());
  const current = useRef(new Vector3());
  const step = useRef(new Quaternion());
  useEffect(() => {
    target.current = new Vector3(
      ...position(selected?.latitude ?? -5, selected?.longitude ?? 118),
    ).multiplyScalar(selected ? 2.35 : 2.8);
  }, [selected, reset]);
  useFrame((_, dt) => {
    if (target.current) {
      const alpha = 1 - Math.exp(-dt * 3);
      const radius = camera.position.length();
      direction.current.copy(target.current).normalize();
      current.current.copy(camera.position).normalize();
      step.current.setFromUnitVectors(current.current, direction.current);
      rotation.current.identity().slerp(step.current, alpha);
      camera.position
        .applyQuaternion(rotation.current)
        .setLength(radius + (target.current.length() - radius) * alpha);
      if (camera.position.distanceTo(target.current) < 0.1)
        target.current = null;
    }
    if (controls.current)
      controls.current.autoRotate =
        auto &&
        !interacting.current &&
        !target.current &&
        Date.now() > idle.current;
  });
  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      minDistance={120}
      maxDistance={470}
      autoRotateSpeed={0.22}
      enableDamping
      onStart={() => {
        interacting.current = true;
        target.current = null;
      }}
      onEnd={() => {
        interacting.current = false;
        idle.current = Date.now() + 4000;
      }}
    />
  );
}
function Halos({ events }: { events: Event[] }) {
  const ref = useRef<InstancedMesh>(null);
  const selected = useExplorer((s) => s.selected?.id);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const obj = new Object3D();
    const color = new Color();
    const times = events.map((event) => Date.parse(event.occurredAt));
    const newest = times.length ? Math.max(...times) : 0;
    const oldest = times.length ? Math.min(...times) : newest;
    const recentWindow = Math.max(60_000, (newest - oldest) * 0.12);
    events.forEach((e, i) => {
      obj.position
        .set(...position(e.latitude, e.longitude))
        .multiplyScalar(1.004);
      const recent = newest - Date.parse(e.occurredAt) <= recentWindow;
      obj.scale.setScalar(markerSize(e.magnitude) * (e.id === selected ? 3 : recent ? 1.8 : 1.15));
      obj.updateMatrix();
      ref.current!.setMatrixAt(i, obj.matrix);
      ref.current!.setColorAt(i, color.set(depthColor(e.depthKm)));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [events, selected]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, events.length]}
      raycast={() => {}}
    >
      <sphereGeometry args={[1, 12, 8]} />
      <meshBasicMaterial
        transparent
        opacity={0.22}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </instancedMesh>
  );
}
function EventPulse({ event }: { event?: Event }) {
  const ref = useRef<Mesh>(null);
  const started = useRef<number | null>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useFrame(({ clock }) => {
    if (!ref.current || reduced) return;
    if (started.current === null) started.current = clock.getElapsedTime();
    const phase = Math.min(1, (clock.getElapsedTime() - started.current) / 1.4);
    ref.current.scale.setScalar(1 + phase * 3);
    (ref.current.material as MeshBasicMaterial).opacity = (1 - phase) * 0.35;
  });
  if (!event) return null;
  return <mesh ref={ref} position={position(event.latitude, event.longitude).map((v) => v * 1.005) as [number, number, number]} scale={markerSize(event.magnitude) * 1.6}>
    <sphereGeometry args={[1, 16, 10]} />
    <meshBasicMaterial color={depthColor(event.depthKm)} transparent opacity={0.35} depthWrite={false} blending={AdditiveBlending} />
  </mesh>;
}
function InteriorFocus() {
  const enabled = useExplorer((s) => s.interiorMode);
  const scale = useExplorer((s) => s.depthScale);
  const selected = useExplorer((s) => s.selected);
  const [hovered, setHovered] = useState(false);
  if (!enabled || !selected) return null;
  const hypocenter = hypocenterPosition(selected.latitude, selected.longitude, selected.depthKm, scale);
  if (!hypocenter) return null;
  const epicenter = position(selected.latitude, selected.longitude);
  const color = depthColor(selected.depthKm);
  return <group>
    <Line points={[hypocenter, epicenter]} color={color} lineWidth={1} transparent opacity={0.72} depthTest={false} raycast={() => null} renderOrder={9} />
    <mesh
      position={hypocenter}
      scale={hovered ? 1.35 : 1}
      renderOrder={10}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
      onClick={(event) => event.stopPropagation()}
    >
      <sphereGeometry args={[1.45, 18, 12]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
    <mesh position={hypocenter} scale={hovered ? 3.2 : 2.45} renderOrder={9} raycast={() => {}}>
      <sphereGeometry args={[1, 16, 10]} />
      <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} depthTest={false} blending={AdditiveBlending} />
    </mesh>
  </group>;
}
const EQUATOR_POINTS = equatorPoints();
function EquatorLayer() {
  const visible = useExplorer((s) => s.equator);
  if (!visible) return null;
  return <group>
    <Line points={EQUATOR_POINTS} color="#bcefff" lineWidth={1} dashed dashSize={2.2} gapSize={1.4} transparent opacity={0.7} depthWrite={false} />
    <Line points={EQUATOR_POINTS} color="#42d9ff" lineWidth={3} transparent opacity={0.09} depthWrite={false} raycast={() => null} />
    <Html position={position(0, 0).map((value) => value * 1.018) as [number, number, number]} center occlude transform distanceFactor={170}>
      <span className="equator-label">EQUATOR — 0° LATITUDE</span>
    </Html>
  </group>;
}
function Earth({ events }: { events: Event[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const [hoveredBoundary, setHoveredBoundary] = useState<string | null>(null);
  const [boundaries, setBoundaries] = useState<BoundaryPath[]>([]);
  const plates = useExplorer((s) => s.tectonicPlates);
  const selected = useExplorer((s) => s.selected);
  const selectedBoundary = useExplorer((s) => s.selectedBoundary);
  const set = useExplorer((s) => s.set);
  const interior = useExplorer((s) => s.interiorMode);
  const dynamicDayNight = useExplorer((s) => s.dynamicDayNight);
  const cityLights = useExplorer((s) => s.cityLights);
  const mode = useExplorer((s) => s.mode);
  const currentTime = useExplorer((s) => s.currentTime);
  const nightTexture = useLoader(TextureLoader, "/earth-night.jpg");
  const globeMaterial = useRef(new MeshPhongMaterial());
  const sunDirection = useRef(new Vector3(0, 0, 1));
  const illuminationEnabled = useRef({ value: 1 });
  const cityLightsEnabled = useRef({ value: 1 });
  const sunUniform = useRef({ value: sunDirection.current });
  const nightUniform = useRef({ value: nightTexture });
  useEffect(() => {
    const updateSun = () => {
      const sun = calculateSunDirection(illuminationTimestamp(mode, currentTime));
      sunDirection.current.set(sun.x, sun.y, sun.z);
    };
    updateSun();
    if (mode !== "live") return;
    const timer = window.setInterval(updateSun, 30_000);
    return () => window.clearInterval(timer);
  }, [mode, currentTime]);

  useEffect(() => {
    illuminationEnabled.current.value = isDynamicIlluminationActive(dynamicDayNight, interior) ? 1 : 0;
    cityLightsEnabled.current.value = cityLights ? 1 : 0;
  }, [dynamicDayNight, cityLights, interior]);

  useEffect(() => {
    nightTexture.colorSpace = SRGBColorSpace;
    const material = globeMaterial.current;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.qsSunDirection = sunUniform.current;
      shader.uniforms.qsNightMap = nightUniform.current;
      shader.uniforms.qsIlluminationEnabled = illuminationEnabled.current;
      shader.uniforms.qsCityLightsEnabled = cityLightsEnabled.current;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 qsSurfaceNormal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nqsSurfaceNormal = normalize(position);");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 qsSurfaceNormal;\nuniform vec3 qsSunDirection;\nuniform sampler2D qsNightMap;\nuniform float qsIlluminationEnabled;\nuniform float qsCityLightsEnabled;",
        )
        .replace(
          "#include <map_fragment>",
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            #ifdef DECODE_VIDEO_TEXTURE
              sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
            #endif
            vec3 nightSample = texture2D(qsNightMap, vMapUv).rgb;
            float solarIncidence = dot(normalize(qsSurfaceNormal), normalize(qsSunDirection));
            float daylight = smoothstep(-0.14, 0.18, solarIncidence);
            float twilight = 1.0 - smoothstep(0.0, 0.18, abs(solarIncidence));
            vec3 darkGeography = sampledDiffuseColor.rgb * 0.065;
            vec3 artificialLight = nightSample * nightSample * 1.7 * qsCityLightsEnabled;
            vec3 nightColor = darkGeography + artificialLight;
            vec3 illuminatedColor = mix(nightColor, sampledDiffuseColor.rgb, daylight);
            illuminatedColor += vec3(0.025, 0.055, 0.085) * twilight;
            vec3 finalMap = mix(sampledDiffuseColor.rgb, illuminatedColor, qsIlluminationEnabled);
            diffuseColor *= vec4(finalMap, sampledDiffuseColor.a);
          #endif`,
        );
    };
    material.customProgramCacheKey = () => "quakescope-day-night-v1";
    material.needsUpdate = true;
    return () => {
      material.onBeforeCompile = () => {};
    };
  }, [nightTexture]);
  useEffect(() => {
    const material = globeMaterial.current;
    material.transparent = interior;
    material.opacity = interior ? 0.34 : 1;
    material.depthWrite = !interior;
    material.needsUpdate = true;
  }, [interior]);
  useFrame((_, delta) => {
    const material = globeMaterial.current;
    const target = interior ? 0.34 : 1;
    material.opacity += (target - material.opacity) * Math.min(1, delta * 7);
  });
  useEffect(() => () => globeMaterial.current.dispose(), []);
  useEffect(() => {
    let active = true;
    loadBoundaries()
      .then((data) => {
        if (active) {
          setBoundaries(data);
          set({ tectonicError: data.length ? null : "PB2002 contains no usable boundaries." });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setBoundaries([]);
          set({
            tectonicError:
              error instanceof Error
                ? `Tectonic data unavailable: ${error.message}`
                : "Tectonic data unavailable.",
          });
        }
      });
    return () => {
      active = false;
      document.body.style.cursor = "auto";
    };
  }, [set]);
  return (
    <Globe
      globeImageUrl="/earth.jpg"
      globeMaterial={globeMaterial.current}
      atmosphereColor="#59c8ff"
      atmosphereAltitude={0.12}
      globeCurvatureResolution={3}
      pointsData={events}
      pointLat="latitude"
      pointLng="longitude"
      pointAltitude={0.003}
      pointColor={(d: object) => depthColor((d as Event).depthKm)}
      pointRadius={(d: object) =>
        markerSize((d as Event).magnitude) *
        ((d as Event).id === hover || (d as Event).id === selected?.id
          ? 1.7
          : 1)
      }
      pointsTransitionDuration={0}
      pathsData={plates ? boundaries : []}
      pathPoints="points"
      pathPointLat="lat"
      pathPointLng="lng"
      pathPointAlt="alt"
      pathResolution={1}
      pathColor={(d: object) =>
        (d as BoundaryPath).id === selectedBoundary?.id ||
        (d as BoundaryPath).id === hoveredBoundary
          ? "#d7fbff"
          : "#55d9ed"
      }
      pathStroke={(d: object) =>
        (d as BoundaryPath).id === selectedBoundary?.id ||
        (d as BoundaryPath).id === hoveredBoundary
          ? 0.48
          : 0.2
      }
      pathTransitionDuration={240}
      onClick={(layer: string, d: object | undefined) => {
        if (!d) return;
        if (layer === "path")
          set({ selectedBoundary: d as BoundaryPath, selected: null });
        else if ("sourceId" in d)
          set({ selected: d as Event, selectedBoundary: null, isPlaying: false });
      }}
      onHover={(layer: string | undefined, d: object | undefined) => {
        setHover(d && "sourceId" in d ? String((d as Event).id) : null);
        setHoveredBoundary(layer === "path" && d ? (d as BoundaryPath).id : null);
        document.body.style.cursor = d ? "pointer" : "auto";
      }}
    />
  );
}
export default function Scene({ events }: { events: Event[] }) {
  const interior = useExplorer((s) => s.interiorMode);
  return (
    <Canvas
      camera={{
        position: position(-5, 118).map((v) => v * 2.8) as [
          number,
          number,
          number,
        ],
        near: 1,
        far: 3000,
        fov: 46,
      }}
      dpr={[1, 1.5]}
    >
      <color attach="background" args={["#030913"]} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[200, 150, 250]} intensity={2} />
      <Stars
        radius={900}
        depth={500}
        count={1800}
        factor={2}
        fade
        speed={0.1}
      />
      <Suspense fallback={null}>
        <Earth events={events} />
        <EquatorLayer />
        {interior && <mesh raycast={() => {}}>
          <sphereGeometry args={[100.35, 64, 48]} />
          <meshBasicMaterial color="#65d9ff" wireframe transparent opacity={0.055} depthWrite={false} />
        </mesh>}
        <InteriorFocus />
        <Halos events={events} />
        <EventPulse key={events.at(-1)?.id ?? "none"} event={events.at(-1)} />
      </Suspense>
      <Camera />
    </Canvas>
  );
}
