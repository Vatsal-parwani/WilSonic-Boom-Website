/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import './robot-arena.css';

// ── Customisable physics & gameplay constants ──
const GRAVITY = 9.81;        // m/s^2 downward acceleration
const DEFAULT_SPEED = 6.6;   // m/s default flywheel launch speed
const MIN_SPEED = 4.6;
const MAX_SPEED = 9.0;
const MAX_AIR_BALLS = 9;     // max pollen balls active at once
const BALL_RADIUS = 0.055;   // ~4 inch BioBuzz pollen ball
const ARENA_HALF = 4.6;      // 9.2m x 9.2m terrain
const ROBOT_RADIUS = 0.28;   // collision radius of robot
const DRIVE_SPEED = 2.25;    // m/s max drive speed
const TURN_SPEED = 2.75;     // rad/s max turn speed
const DEFAULT_AIM_DEG = 42;  // starting shooter elevation angle
const MATCH_SECONDS = 30;    // 30-second challenge duration
const FREEZE_DURATION = 3.0; // seconds frozen when hitting a buried mine
const MINE_COUNT = 5;        // active buried mines on terrain
const BEST_SCORE_KEY = 'wilsonic_boom_best_score_v1';

// Analytical bumpy terrain height (meters) — keeps spawn pad near (0, 1.6) smooth
function getTerrainHeight(x, z) {
  const dStart = Math.hypot(x, z - 1.6);
  const spawnMask = Math.min(1, Math.max(0, (dStart - 0.7) / 1.15));
  const hills =
    0.20 * Math.sin(x * 0.78) * Math.cos(z * 0.72) +
    0.12 * Math.sin(x * 1.55 + 1.0) * Math.sin(z * 1.35 - 0.5) +
    0.09 * Math.cos((x + z) * 0.95);
  return Math.max(-0.22, hills * spawnMask);
}

function getTerrainSlope(THREE, x, z, outNormal) {
  const eps = 0.08;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  outNormal.set(hL - hR, 2 * eps, hD - hU).normalize();
  return outNormal;
}

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

export default function RobotArena({ fallbackSrc, fallbackAlt, modelUrl = null }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);

  const [webglOk, setWebglOk] = useState(true);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [followCam, setFollowCam] = useState(true);
  const [soundOn, setSoundOn] = useState(false);

  const [mode, setMode] = useState('free'); // 'free' | 'match' | 'summary'
  const [timeLeft, setTimeLeft] = useState(MATCH_SECONDS);
  const [freezeLeft, setFreezeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [superShots, setSuperShots] = useState(0);
  const [shotsFired, setShotsFired] = useState(0);
  const [hitsLanded, setHitsLanded] = useState(0);

  const [aimDeg, setAimDeg] = useState(DEFAULT_AIM_DEG);
  const [powerPct, setPowerPct] = useState(45);
  const [callout, setCallout] = useState({ text: '', danger: false });
  const [statusMsg, setStatusMsg] = useState('Robot ready. Click Interact to explore the course.');

  const interactingRef = useRef(false);
  const hasInteractedRef = useRef(false);
  const followCamRef = useRef(true);
  const soundOnRef = useRef(false);
  const modeRef = useRef('free');
  const timeLeftRef = useRef(MATCH_SECONDS);
  const freezeRef = useRef(0);
  const scoreRef = useRef(0);
  const streakRef = useRef(0);
  const superShotsRef = useRef(0);
  const shotsFiredRef = useRef(0);
  const hitsLandedRef = useRef(0);
  const aimDegRef = useRef(DEFAULT_AIM_DEG);
  const speedRef = useRef(DEFAULT_SPEED);
  const controlsRef = useRef(null);
  const calloutTimerRef = useRef(0);
  const audioCtxRef = useRef(null);

  const inputRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    aimUp: false,
    aimDown: false,
  });

  const shootFnRef = useRef(() => {});
  const resetFnRef = useRef(() => {});
  const startMatchFnRef = useRef(() => {});

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(BEST_SCORE_KEY) || '0');
      if (Number.isFinite(saved) && saved > 0) setBestScore(saved);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    interactingRef.current = isInteracting;
    const ctrl = controlsRef.current;
    if (ctrl) {
      ctrl.enableZoom = isInteracting;
      ctrl.enableRotate = isInteracting;
      if (isInteracting) {
        hasInteractedRef.current = true;
        ctrl.autoRotate = false;
      }
    }
  }, [isInteracting]);

  useEffect(() => {
    followCamRef.current = followCam;
  }, [followCam]);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  function showCallout(text, danger = false) {
    setCallout({ text, danger });
    if (calloutTimerRef.current) clearTimeout(calloutTimerRef.current);
    calloutTimerRef.current = setTimeout(() => setCallout({ text: '', danger: false }), 1400);
  }

  function playTone(kind, extra = 0) {
    if (!soundOnRef.current) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (kind === 'shoot') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.09);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (kind === 'hit') {
        osc.type = 'sine';
        const base = 460 + Math.min(extra, 6) * 75;
        osc.frequency.setValueAtTime(base, now);
        osc.frequency.exponentialRampToValueAtTime(base * 1.45, now + 0.14);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (kind === 'pickup') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.06);
        osc.frequency.setValueAtTime(784, now + 0.12);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.start(now);
        osc.stop(now + 0.24);
      } else if (kind === 'mine') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(48, now + 0.35);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.start(now);
        osc.stop(now + 0.38);
      } else if (kind === 'end') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(520, now + 0.12);
        osc.frequency.setValueAtTime(880, now + 0.24);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.45);
      }
    } catch {
      // ignore Web Audio restrictions
    }
  }

  async function toggleExpand() {
    const el = rootRef.current;
    if (!el) return;

    if (!isExpanded) {
      setIsInteracting(true);
      if (el.requestFullscreen) {
        try {
          await el.requestFullscreen();
          setIsExpanded(true);
          return;
        } catch {
          // fallback to CSS overlay
        }
      }
      setIsExpanded(true);
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        try {
          await document.exitFullscreen();
        } catch {
          // ignore
        }
      }
      setIsExpanded(false);
    }
  }

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setIsExpanded(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (!isInteracting) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (isExpanded) setIsExpanded(false);
        else setIsInteracting(false);
      }
    };

    const onDocPointerDown = (e) => {
      if (!isExpanded && rootRef.current && !rootRef.current.contains(e.target)) {
        setIsInteracting(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onDocPointerDown);
    };
  }, [isInteracting, isExpanded]);

  useEffect(() => {
    if (!supportsWebGL()) {
      setWebglOk(false);
      return;
    }

    let disposed = false;
    let rafId = 0;
    let renderer = null;
    let scene = null;
    let controls = null;
    let resizeObserver = null;
    let intersectionObserver = null;
    let motionQuery = null;
    let onMotionChange = null;
    let onVisibilityChange = null;
    let onKeyDown = null;
    let onKeyUp = null;
    let onCanvasPointerDown = null;
    let onCanvasPointerUp = null;
    let onControlsStart = null;
    let onControlsEnd = null;

    async function init() {
      const container = rootRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      try {
        const [THREE, { OrbitControls }, { loadRobotModel }] = await Promise.all([
          import('three'),
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('./robotModel.js'),
        ]);

        if (disposed) return;

        // ── Scene & Camera ──
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x101012);
        scene.fog = new THREE.Fog(0x101012, 11.5, 25);

        const width = Math.max(container.clientWidth, 320);
        const height = Math.max(container.clientHeight, 320);
        const camera = new THREE.PerspectiveCamera(48, width / height, 0.08, 45);
        camera.position.set(1.9, 1.55, 3.25);

        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.18;

        // ── OrbitControls ──
        controls = new OrbitControls(camera, canvas);
        controls.target.set(0, 0.35, 0.9);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = false;
        controls.enableZoom = false;
        controls.enableRotate = false;
        controls.minDistance = 1.1;
        controls.maxDistance = 10.5;
        controls.minPolarAngle = 0.18;
        controls.maxPolarAngle = Math.PI / 2 - 0.04;

        let isOrbitDragging = false;
        let manualLookTimer = 0;

        onControlsStart = () => {
          isOrbitDragging = true;
          manualLookTimer = 1.6;
        };
        onControlsEnd = () => {
          isOrbitDragging = false;
        };
        controls.addEventListener('start', onControlsStart);
        controls.addEventListener('end', onControlsEnd);

        motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        let reducedMotion = motionQuery.matches;
        controls.autoRotate = !reducedMotion;
        controls.autoRotateSpeed = 0.55;
        controlsRef.current = controls;

        onMotionChange = (e) => {
          reducedMotion = e.matches;
          controls.autoRotate = !reducedMotion && !hasInteractedRef.current;
        };
        motionQuery.addEventListener('change', onMotionChange);

        // ── Lighting ──
        scene.add(new THREE.HemisphereLight(0xf6f1e6, 0x1a1b1f, 1.05));

        const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.25);
        keyLight.position.set(4.5, 7.2, 4.2);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 22;
        keyLight.shadow.camera.left = -5.8;
        keyLight.shadow.camera.right = 5.8;
        keyLight.shadow.camera.top = 5.8;
        keyLight.shadow.camera.bottom = -5.8;
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0xefc069, 0.95);
        rimLight.position.set(-4.5, 3.0, -4.5);
        scene.add(rimLight);

        // ── Large Bumpy Terrain Mesh + Contour Grid ──
        const segs = 64;
        const terrainGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2, segs, segs);
        terrainGeo.rotateX(-Math.PI / 2);

        const tPos = terrainGeo.attributes.position;
        const tColors = new Float32Array(tPos.count * 3);
        const lowCol = new THREE.Color(0x131417);
        const highCol = new THREE.Color(0x272623);
        const tmpCol = new THREE.Color();

        for (let i = 0; i < tPos.count; i++) {
          const vx = tPos.getX(i);
          const vz = tPos.getZ(i);
          const vy = getTerrainHeight(vx, vz);
          tPos.setY(i, vy);

          const blend = THREE.MathUtils.clamp((vy + 0.22) / 0.52, 0, 1);
          tmpCol.copy(lowCol).lerp(highCol, blend);
          tColors[i * 3] = tmpCol.r;
          tColors[i * 3 + 1] = tmpCol.g;
          tColors[i * 3 + 2] = tmpCol.b;
        }
        terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
        terrainGeo.computeVertexNormals();

        const terrainMesh = new THREE.Mesh(
          terrainGeo,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.88,
            metalness: 0.1,
          })
        );
        terrainMesh.receiveShadow = true;
        scene.add(terrainMesh);

        const gridGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2, 18, 18);
        gridGeo.rotateX(-Math.PI / 2);
        const gPos = gridGeo.attributes.position;
        for (let i = 0; i < gPos.count; i++) {
          const gx = gPos.getX(i);
          const gz = gPos.getZ(i);
          gPos.setY(i, getTerrainHeight(gx, gz) + 0.005);
        }
        const terrainGrid = new THREE.Mesh(
          gridGeo,
          new THREE.MeshBasicMaterial({
            color: 0xc89434,
            wireframe: true,
            transparent: true,
            opacity: 0.16,
          })
        );
        scene.add(terrainGrid);

        // Perimeter walls + polycarbonate shields
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.55, metalness: 0.45 });
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x9bb3c7,
          roughness: 0.15,
          metalness: 0.1,
          transparent: true,
          opacity: 0.12,
        });
        const wallLen = ARENA_HALF * 2 + 0.08;
        [
          [0, 0.04, -ARENA_HALF, wallLen, 0.36, 0.07],
          [0, 0.04, ARENA_HALF, wallLen, 0.36, 0.07],
          [-ARENA_HALF, 0.04, 0, 0.07, 0.36, wallLen],
          [ARENA_HALF, 0.04, 0, 0.07, 0.36, wallLen],
        ].forEach(([wx, wy, wz, sx, sy, sz]) => {
          const base = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
          base.position.set(wx, wy, wz);
          base.receiveShadow = true;
          scene.add(base);

          const shield = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.22, sz), glassMat);
          shield.position.set(wx, wy + 0.29, wz);
          scene.add(shield);
        });

        // ── Solid Course Obstacles (Barriers, Crates & Pillars) ──
        const obsSpecs = [
          { type: 'box', x: -1.45, z: -0.45, w: 1.15, h: 0.44, d: 0.30, rotY: 0.35 },
          { type: 'box', x: 1.50, z: -0.35, w: 1.15, h: 0.48, d: 0.30, rotY: -0.30 },
          { type: 'cyl', x: 0.0, z: -1.35, r: 0.30, h: 0.65 },
          { type: 'box', x: -2.25, z: 0.65, w: 0.60, h: 0.42, d: 0.60, rotY: 0.22 },
          { type: 'box', x: 2.25, z: 1.45, w: 0.65, h: 0.46, d: 0.65, rotY: -0.25 },
          { type: 'cyl', x: -1.25, z: 2.65, r: 0.32, h: 0.48 },
          { type: 'cyl', x: 1.35, z: 2.80, r: 0.30, h: 0.52 },
        ];

        const obsBodyMat = new THREE.MeshStandardMaterial({ color: 0x212328, roughness: 0.52, metalness: 0.45 });
        const obsTrimMat = new THREE.MeshStandardMaterial({ color: 0xc89434, roughness: 0.34, metalness: 0.82 });

        const obstacles = obsSpecs.map((spec) => {
          const groundY = getTerrainHeight(spec.x, spec.z);
          const group = new THREE.Group();
          const embed = 0.24;

          if (spec.type === 'box') {
            const totalH = spec.h + embed;
            const body = new THREE.Mesh(new THREE.BoxGeometry(spec.w, totalH, spec.d), obsBodyMat);
            body.castShadow = true;
            body.receiveShadow = true;
            group.add(body);

            const cap = new THREE.Mesh(
              new THREE.BoxGeometry(spec.w + 0.02, 0.04, spec.d + 0.02),
              obsTrimMat
            );
            cap.position.y = totalH / 2 - 0.02;
            cap.castShadow = true;
            group.add(cap);

            group.position.set(spec.x, groundY + (spec.h - embed) / 2, spec.z);
            group.rotation.y = spec.rotY;
            scene.add(group);

            return {
              ...spec,
              topY: groundY + spec.h,
              halfW: spec.w / 2,
              halfD: spec.d / 2,
              cos: Math.cos(spec.rotY),
              sin: Math.sin(spec.rotY),
            };
          } else {
            const totalH = spec.h + embed;
            const body = new THREE.Mesh(
              new THREE.CylinderGeometry(spec.r, spec.r, totalH, 18),
              obsBodyMat
            );
            body.castShadow = true;
            body.receiveShadow = true;
            group.add(body);

            const cap = new THREE.Mesh(
              new THREE.CylinderGeometry(spec.r + 0.015, spec.r + 0.015, 0.045, 18),
              obsTrimMat
            );
            cap.position.y = totalH / 2 - 0.02;
            cap.castShadow = true;
            group.add(cap);

            group.position.set(spec.x, groundY + (spec.h - embed) / 2, spec.z);
            scene.add(group);

            return {
              ...spec,
              topY: groundY + spec.h,
            };
          }
        });

        function resolveObstacleCollision(pos, entityRadius, entityY, normalOut) {
          let hit = false;
          for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            if (entityY > o.topY + entityRadius) continue;

            if (o.type === 'cyl') {
              const dx = pos.x - o.x;
              const dz = pos.z - o.z;
              const dist = Math.hypot(dx, dz);
              const minD = o.r + entityRadius;
              if (dist < minD) {
                const nx = dist > 0.0001 ? dx / dist : 1;
                const nz = dist > 0.0001 ? dz / dist : 0;
                pos.x = o.x + nx * minD;
                pos.z = o.z + nz * minD;
                if (normalOut) normalOut.set(nx, 0, nz);
                hit = true;
              }
            } else {
              const dx = pos.x - o.x;
              const dz = pos.z - o.z;
              const lx = dx * o.cos - dz * o.sin;
              const lz = dx * o.sin + dz * o.cos;

              const clx = THREE.MathUtils.clamp(lx, -o.halfW, o.halfW);
              const clz = THREE.MathUtils.clamp(lz, -o.halfD, o.halfD);

              const dlx = lx - clx;
              const dlz = lz - clz;
              const distSq = dlx * dlx + dlz * dlz;

              if (distSq < entityRadius * entityRadius) {
                let lnx = 0;
                let lnz = 0;
                let newLx = lx;
                let newLz = lz;

                if (distSq > 0.000001) {
                  const dist = Math.sqrt(distSq);
                  lnx = dlx / dist;
                  lnz = dlz / dist;
                  newLx = clx + lnx * entityRadius;
                  newLz = clz + lnz * entityRadius;
                } else {
                  const penX = o.halfW - Math.abs(lx);
                  const penZ = o.halfD - Math.abs(lz);
                  if (penX < penZ) {
                    lnx = lx >= 0 ? 1 : -1;
                    newLx = lnx * (o.halfW + entityRadius);
                  } else {
                    lnz = lz >= 0 ? 1 : -1;
                    newLz = lnz * (o.halfD + entityRadius);
                  }
                }

                pos.x = o.x + (newLx * o.cos + newLz * o.sin);
                pos.z = o.z + (-newLx * o.sin + newLz * o.cos);
                if (normalOut) {
                  normalOut.set(lnx * o.cos + lnz * o.sin, 0, -lnx * o.sin + lnz * o.cos);
                }
                hit = true;
              }
            }
          }
          return hit;
        }

        // ── Load Robot inside Carrier + Terrain-Tilt Wrapper ──
        const robot = await loadRobotModel(THREE, modelUrl);
        if (disposed) return;

        const robotCarrier = new THREE.Group();
        const robotTilt = new THREE.Group();
        robotCarrier.add(robotTilt);
        robotTilt.add(robot.root);
        scene.add(robotCarrier);

        const baseRingMat = new THREE.MeshBasicMaterial({
          color: 0xc89434,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.65,
        });
        const baseRing = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.27, 28), baseRingMat);
        baseRing.rotation.x = -Math.PI / 2;
        baseRing.position.y = 0.01;
        robotTilt.add(baseRing);

        const noseChevron = new THREE.Mesh(
          new THREE.ConeGeometry(0.048, 0.095, 3),
          new THREE.MeshBasicMaterial({ color: 0xefc069 })
        );
        noseChevron.rotation.x = Math.PI / 2;
        noseChevron.position.set(0, 0.015, 0.33);
        robotTilt.add(noseChevron);

        let robotHeading = Math.PI;
        let forwardVel = 0;
        let turnVel = 0;
        let recoilOffset = 0;
        let currentPitch = 0;
        let currentRoll = 0;

        robotCarrier.position.set(0, getTerrainHeight(0, 1.6), 1.6);
        robotCarrier.rotation.y = robotHeading;

        // ── 6 Moving Hoops in 3 Speed / Point Tiers ──
        const hoopSpecs = [
          { x: -3.40, hAbove: 0.72, z: 1.25, rotY: Math.PI / 2 - 0.2, radius: 0.25, axis: 'z', amp: 0.80, speed: 0.95, points: 1, phase: 0.4 },
          { x: 0.10, hAbove: 0.68, z: 3.55, rotY: Math.PI, radius: 0.25, axis: 'x', amp: 0.90, speed: 1.05, points: 1, phase: 2.1 },
          { x: -2.85, hAbove: 0.78, z: -2.55, rotY: 0.55, radius: 0.23, axis: 'x', amp: 0.78, speed: 1.75, points: 2, phase: 1.2 },
          { x: 3.40, hAbove: 0.92, z: 0.55, rotY: -Math.PI / 2 + 0.15, radius: 0.23, axis: 'z', amp: 0.85, speed: 1.85, points: 2, phase: 3.0 },
          { x: 2.75, hAbove: 0.88, z: -2.70, rotY: -0.55, radius: 0.21, axis: 'x', amp: 0.85, speed: 2.75, points: 3, phase: 0.8 },
          { x: 0.0, hAbove: 1.15, z: -3.45, rotY: 0, radius: 0.21, axis: 'x', amp: 1.15, speed: 2.65, points: 3, phase: 2.5 },
        ];

        const postMat = new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.45, metalness: 0.75 });
        const targets = hoopSpecs.map((cfg, idx) => {
          const groundY = getTerrainHeight(cfg.x, cfg.z);
          const hoopY = groundY + cfg.hAbove;

          const tierRingColor = cfg.points === 3 ? 0xff5a36 : cfg.points === 2 ? 0xffd147 : 0xc89434;
          const tierCoreColor = cfg.points === 3 ? 0xff8c66 : cfg.points === 2 ? 0xffe485 : 0xefc069;
          const tierEmissive = cfg.points === 3 ? 0x9e250b : cfg.points === 2 ? 0x7a5508 : 0x5c3f09;

          const group = new THREE.Group();
          group.position.set(cfg.x, hoopY, cfg.z);
          group.rotation.y = cfg.rotY;

          const postLen = cfg.hAbove + 0.48;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, postLen, 10), postMat);
          post.position.y = -postLen / 2;
          post.castShadow = true;
          group.add(post);

          const ringMat = new THREE.MeshStandardMaterial({
            color: tierRingColor,
            emissive: cfg.points === 3 ? 0x451005 : 0x000000,
            roughness: 0.28,
            metalness: 0.82,
          });
          const ring = new THREE.Mesh(new THREE.TorusGeometry(cfg.radius, 0.028, 12, 28), ringMat);
          ring.castShadow = true;
          group.add(ring);

          const coreMat = new THREE.MeshStandardMaterial({
            color: tierCoreColor,
            emissive: tierEmissive,
            emissiveIntensity: cfg.points === 3 ? 0.9 : 0.65,
            roughness: 0.38,
            metalness: 0.2,
          });
          const core = new THREE.Mesh(
            new THREE.CylinderGeometry(cfg.radius * 0.72, cfg.radius * 0.72, 0.028, 20),
            coreMat
          );
          core.rotation.x = Math.PI / 2;
          group.add(core);

          let halo = null;
          if (cfg.points >= 2) {
            const haloMat = new THREE.MeshBasicMaterial({
              color: cfg.points === 3 ? 0xff8a65 : 0xffe47a,
              transparent: true,
              opacity: cfg.points === 3 ? 0.9 : 0.55,
              side: THREE.DoubleSide,
            });
            halo = new THREE.Mesh(new THREE.RingGeometry(cfg.radius + 0.045, cfg.radius + 0.08, 28), haloMat);
            group.add(halo);
          }

          scene.add(group);
          return {
            idx,
            baseX: cfg.x,
            baseZ: cfg.z,
            hAbove: cfg.hAbove,
            axis: cfg.axis,
            amp: cfg.amp,
            speed: cfg.speed,
            points: cfg.points,
            phase: cfg.phase,
            group,
            coreMat,
            halo,
            hitFlash: 0,
            cooldown: 0,
            radius: cfg.radius + BALL_RADIUS * 1.15,
            worldPos: new THREE.Vector3(cfg.x, hoopY, cfg.z),
          };
        });

        // ── Random Buried Ground Mines ──
        function pickSafeRandomSpot(avoidList = []) {
          for (let attempt = 0; attempt < 30; attempt++) {
            const rx = (Math.random() * 2 - 1) * (ARENA_HALF - 0.75);
            const rz = (Math.random() * 2 - 1) * (ARENA_HALF - 0.75);

            if (Math.hypot(rx - robotCarrier.position.x, rz - robotCarrier.position.z) < 1.35) continue;

            let hitsObs = false;
            for (let i = 0; i < obstacles.length; i++) {
              const o = obstacles[i];
              const obsR = o.type === 'cyl' ? o.r + 0.55 : Math.hypot(o.halfW, o.halfD) + 0.45;
              if (Math.hypot(rx - o.x, rz - o.z) < obsR) {
                hitsObs = true;
                break;
              }
            }
            if (hitsObs) continue;

            let tooClose = false;
            for (let i = 0; i < avoidList.length; i++) {
              if (Math.hypot(rx - avoidList[i].x, rz - avoidList[i].z) < 1.25) {
                tooClose = true;
                break;
              }
            }
            if (tooClose) continue;

            return { x: rx, z: rz };
          }
          return { x: (Math.random() * 2 - 1) * 2.5, z: -2.0 };
        }

        const mineCapGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.04, 14);
        const mineLedGeo = new THREE.SphereGeometry(0.032, 10, 8);
        const mineRingGeo = new THREE.RingGeometry(0.17, 0.21, 20);

        const mines = [];
        for (let i = 0; i < MINE_COUNT; i++) {
          const spot = pickSafeRandomSpot(mines);
          const groundY = getTerrainHeight(spot.x, spot.z);

          const group = new THREE.Group();
          group.position.set(spot.x, groundY - 0.005, spot.z);

          const cap = new THREE.Mesh(
            mineCapGeo,
            new THREE.MeshStandardMaterial({ color: 0x2a1414, roughness: 0.7, metalness: 0.4 })
          );
          group.add(cap);

          const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3b1f });
          const led = new THREE.Mesh(mineLedGeo, ledMat);
          led.position.y = 0.018;
          group.add(led);

          const warnRingMat = new THREE.MeshBasicMaterial({
            color: 0xff3b1f,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
          });
          const warnRing = new THREE.Mesh(mineRingGeo, warnRingMat);
          warnRing.rotation.x = -Math.PI / 2;
          warnRing.position.y = 0.016;
          group.add(warnRing);

          scene.add(group);
          mines.push({
            x: spot.x,
            z: spot.z,
            group,
            ledMat,
            warnRingMat,
            relocateTimer: 7 + Math.random() * 8,
            phase: Math.random() * Math.PI * 2,
          });
        }

        function relocateMine(mine) {
          const others = mines.filter((m) => m !== mine);
          const spot = pickSafeRandomSpot(others);
          mine.x = spot.x;
          mine.z = spot.z;
          mine.group.position.set(spot.x, getTerrainHeight(spot.x, spot.z) - 0.005, spot.z);
          mine.relocateTimer = 7 + Math.random() * 8;
        }

        // ── Collectible Super-Pollen Pods Scattered Across Terrain ──
        const pickupSpots = [
          [-2.35, -1.25],
          [2.35, -1.15],
          [0.0, -0.15],
          [-2.05, 2.05],
          [2.45, 2.45],
          [0.0, -2.40],
        ];
        const pickupGeo = new THREE.OctahedronGeometry(0.095, 1);
        const pickupRingGeo = new THREE.RingGeometry(0.12, 0.15, 20);
        const pickups = [0, 1, 2, 3].map((i) => {
          const [px, pz] = pickupSpots[i];
          const py = getTerrainHeight(px, pz) + 0.16;
          const group = new THREE.Group();
          group.position.set(px, py, pz);

          const orb = new THREE.Mesh(
            pickupGeo,
            new THREE.MeshStandardMaterial({
              color: 0xffd54a,
              emissive: 0x996b00,
              emissiveIntensity: 0.9,
              roughness: 0.25,
              metalness: 0.35,
            })
          );
          group.add(orb);

          const ring = new THREE.Mesh(
            pickupRingGeo,
            new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = -0.13;
          group.add(ring);

          scene.add(group);
          return { group, orb, baseY: py, active: true, respawnTimer: 0, spotIdx: i };
        });

        // ── Pooled Sparks & Shockwaves ──
        const sparkGeo = new THREE.SphereGeometry(0.02, 6, 6);
        const goldSparkMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
        const redSparkMat = new THREE.MeshBasicMaterial({ color: 0xff5a36 });
        const sparks = Array.from({ length: 48 }, () => {
          const m = new THREE.Mesh(sparkGeo, goldSparkMat);
          m.visible = false;
          scene.add(m);
          return { mesh: m, vel: new THREE.Vector3(), life: 0, maxLife: 0.5 };
        });

        function spawnBurst(origin, count = 12, danger = false) {
          let spawned = 0;
          for (let i = 0; i < sparks.length && spawned < count; i++) {
            const s = sparks[i];
            if (s.life > 0) continue;
            s.mesh.material = danger ? redSparkMat : goldSparkMat;
            s.mesh.position.copy(origin);
            s.mesh.scale.setScalar(1);
            s.mesh.visible = true;
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.4 + Math.random() * 2.6;
            s.vel.set(Math.cos(angle) * speed, 1.2 + Math.random() * 2.4, Math.sin(angle) * speed);
            s.maxLife = 0.4 + Math.random() * 0.22;
            s.life = s.maxLife;
            spawned++;
          }
        }

        const waveGeo = new THREE.RingGeometry(0.20, 0.25, 28);
        const shockwaves = Array.from({ length: 6 }, () => {
          const mat = new THREE.MeshBasicMaterial({
            color: 0xffe47a,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
          });
          const m = new THREE.Mesh(waveGeo, mat);
          m.visible = false;
          scene.add(m);
          return { mesh: m, mat, life: 0 };
        });

        function spawnWave(pos, rotX = 0, rotY = 0, color = 0xffe47a) {
          const w = shockwaves.find((item) => item.life <= 0) || shockwaves[0];
          w.mesh.position.copy(pos);
          w.mesh.rotation.set(rotX, rotY, 0);
          w.mesh.scale.setScalar(1);
          w.mesh.visible = true;
          w.mat.color.setHex(color);
          w.mat.opacity = 0.95;
          w.life = 0.38;
        }

        // ── Aim Trajectory Preview Arc ──
        const ARC_STEPS = 26;
        const arcGeo = new THREE.BufferGeometry();
        arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_STEPS * 3), 3));
        const arcMat = new THREE.LineDashedMaterial({
          color: 0xefc069,
          dashSize: 0.08,
          gapSize: 0.06,
          transparent: true,
          opacity: 0.65,
        });
        const arcLine = new THREE.Line(arcGeo, arcMat);
        scene.add(arcLine);

        // ── Pollen Ball Geometry & Materials ──
        const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 16, 14);
        const normalBallMat = new THREE.MeshStandardMaterial({
          color: 0xf4c430,
          emissive: 0x594106,
          emissiveIntensity: 0.35,
          roughness: 0.7,
          metalness: 0.08,
        });
        const superBallMat = new THREE.MeshStandardMaterial({
          color: 0xfff08a,
          emissive: 0xc89434,
          emissiveIntensity: 0.85,
          roughness: 0.35,
          metalness: 0.3,
        });

        const activeBalls = [];
        let flywheelBoost = 0;

        const tmpQuat = new THREE.Quaternion();
        const tmpDir = new THREE.Vector3();
        const tmpYawQuat = new THREE.Quaternion();
        const upAxis = new THREE.Vector3(0, 1, 0);
        const slopeNormal = new THREE.Vector3();
        const obsNormal = new THREE.Vector3();
        const desiredCamPos = new THREE.Vector3();
        const desiredTarget = new THREE.Vector3();

        function computeLaunchState(outPos, outVel, yawOffset = 0, speedScale = 1) {
          const aimRad = THREE.MathUtils.degToRad(aimDegRef.current);
          robot.shooterPivot.rotation.x = -aimRad;
          robotCarrier.updateMatrixWorld(true);
          robot.muzzleAnchor.getWorldPosition(outPos);
          robot.shooterPivot.getWorldQuaternion(tmpQuat);

          tmpDir.set(0, 0, 1).applyQuaternion(tmpQuat);
          if (yawOffset !== 0) {
            tmpYawQuat.setFromAxisAngle(upAxis, yawOffset);
            tmpDir.applyQuaternion(tmpYawQuat);
          }

          const speed = speedRef.current * speedScale;
          outVel.copy(tmpDir).multiplyScalar(speed);
        }

        function updateAimArc() {
          const startPos = new THREE.Vector3();
          const startVel = new THREE.Vector3();
          computeLaunchState(startPos, startVel);

          const attr = arcGeo.getAttribute('position');
          for (let i = 0; i < ARC_STEPS; i++) {
            const t = i * 0.045;
            const px = startPos.x + startVel.x * t;
            const pz = startPos.z + startVel.z * t;
            const floorY = getTerrainHeight(px, pz) + 0.02;
            const py = Math.max(floorY, startPos.y + startVel.y * t - 0.5 * GRAVITY * t * t);
            attr.setXYZ(i, px, py, pz);
          }
          attr.needsUpdate = true;
          arcLine.computeLineDistances();
          arcMat.color.setHex(
            freezeRef.current > 0 ? 0xff5a36 : superShotsRef.current > 0 ? 0xfff08a : 0xefc069
          );
        }

        function spawnSingleBall(yawOffset, isSuper) {
          if (activeBalls.length >= MAX_AIR_BALLS) {
            const oldest = activeBalls.shift();
            scene.remove(oldest.mesh);
          }

          const spawnPos = new THREE.Vector3();
          const launchVel = new THREE.Vector3();
          computeLaunchState(spawnPos, launchVel, yawOffset, isSuper ? 1.04 : 1);

          const mesh = new THREE.Mesh(ballGeo, isSuper ? superBallMat : normalBallMat);
          mesh.position.copy(spawnPos);
          mesh.castShadow = true;
          scene.add(mesh);

          activeBalls.push({
            mesh,
            vel: launchVel,
            isSuper,
            bounces: 0,
            landed: false,
            landedTimer: 0,
            scored: false,
          });
        }

        function firePollenBall() {
          if (modeRef.current === 'summary' || freezeRef.current > 0) return;

          hasInteractedRef.current = true;
          controls.autoRotate = false;

          const isSuper = superShotsRef.current > 0;
          if (isSuper) {
            superShotsRef.current -= 1;
            setSuperShots(superShotsRef.current);
            spawnSingleBall(-0.11, true);
            spawnSingleBall(0, true);
            spawnSingleBall(0.11, true);
            setStatusMsg('Super pollen volley fired!');
          } else {
            spawnSingleBall(0, false);
            setStatusMsg('Pollen ball launched.');
          }

          shotsFiredRef.current += 1;
          setShotsFired(shotsFiredRef.current);
          flywheelBoost = 1.0;
          recoilOffset = 0.025;
          playTone('shoot');
        }

        function resetGame(nextMode = 'free') {
          robotHeading = Math.PI;
          forwardVel = 0;
          turnVel = 0;
          recoilOffset = 0;
          currentPitch = 0;
          currentRoll = 0;
          manualLookTimer = 0;
          isOrbitDragging = false;
          freezeRef.current = 0;
          setFreezeLeft(0);
          baseRingMat.color.setHex(0xc89434);

          const startY = getTerrainHeight(0, 1.6);
          robotCarrier.position.set(0, startY, 1.6);
          robotCarrier.rotation.y = robotHeading;
          robotTilt.rotation.set(0, 0, 0);

          aimDegRef.current = DEFAULT_AIM_DEG;
          setAimDeg(DEFAULT_AIM_DEG);
          speedRef.current = DEFAULT_SPEED;
          setPowerPct(45);

          while (activeBalls.length > 0) {
            scene.remove(activeBalls.pop().mesh);
          }

          scoreRef.current = 0;
          streakRef.current = 0;
          superShotsRef.current = 0;
          shotsFiredRef.current = 0;
          hitsLandedRef.current = 0;
          timeLeftRef.current = MATCH_SECONDS;
          modeRef.current = nextMode;

          setScore(0);
          setStreak(0);
          setSuperShots(0);
          setShotsFired(0);
          setHitsLanded(0);
          setTimeLeft(MATCH_SECONDS);
          setMode(nextMode);
          setCallout({ text: '', danger: false });

          pickups.forEach((p, idx) => {
            const [px, pz] = pickupSpots[idx];
            const py = getTerrainHeight(px, pz) + 0.16;
            p.active = true;
            p.respawnTimer = 0;
            p.spotIdx = idx;
            p.baseY = py;
            p.group.position.set(px, py, pz);
            p.group.visible = true;
          });

          mines.forEach((m) => relocateMine(m));

          targets.forEach((t) => {
            t.hitFlash = 0;
            t.cooldown = 0;
            t.coreMat.emissiveIntensity = t.points === 3 ? 0.9 : 0.65;
            t.group.scale.setScalar(1);
          });

          if (followCamRef.current && hasInteractedRef.current) {
            camera.position.set(0, startY + 1.02, 1.6 + 1.95);
            controls.target.set(0, startY + 0.44, 1.6 - 1.45);
          } else {
            camera.position.set(1.9, 1.55, 3.25);
            controls.target.set(0, 0.35, 0.9);
          }
          controls.update();
          updateAimArc();
        }

        function startMatch() {
          hasInteractedRef.current = true;
          controls.autoRotate = false;
          resetGame('match');
          setIsInteracting(true);
          showCallout('30s Match — Go!');
          setStatusMsg('30 second challenge started!');
        }

        shootFnRef.current = firePollenBall;
        resetFnRef.current = () => {
          resetGame('free');
          setStatusMsg('Arena reset.');
        };
        startMatchFnRef.current = startMatch;
        updateAimArc();

        // ── Keyboard & Canvas Tap Controls ──
        onKeyDown = (e) => {
          const activeInside =
            interactingRef.current ||
            (document.activeElement && container.contains(document.activeElement));
          if (!activeInside) return;

          const code = e.code;
          if (code === 'KeyW' || code === 'ArrowUp') {
            e.preventDefault();
            inputRef.current.forward = true;
            hasInteractedRef.current = true;
            controls.autoRotate = false;
          } else if (code === 'KeyS' || code === 'ArrowDown') {
            e.preventDefault();
            inputRef.current.backward = true;
            hasInteractedRef.current = true;
            controls.autoRotate = false;
          } else if (code === 'KeyA' || code === 'ArrowLeft') {
            e.preventDefault();
            inputRef.current.left = true;
            hasInteractedRef.current = true;
            controls.autoRotate = false;
          } else if (code === 'KeyD' || code === 'ArrowRight') {
            e.preventDefault();
            inputRef.current.right = true;
            hasInteractedRef.current = true;
            controls.autoRotate = false;
          } else if (code === 'KeyQ') {
            inputRef.current.aimDown = true;
          } else if (code === 'KeyE') {
            inputRef.current.aimUp = true;
          } else if (code === 'Space') {
            if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
            e.preventDefault();
            firePollenBall();
          }
        };

        onKeyUp = (e) => {
          const code = e.code;
          if (code === 'KeyW' || code === 'ArrowUp') inputRef.current.forward = false;
          else if (code === 'KeyS' || code === 'ArrowDown') inputRef.current.backward = false;
          else if (code === 'KeyA' || code === 'ArrowLeft') inputRef.current.left = false;
          else if (code === 'KeyD' || code === 'ArrowRight') inputRef.current.right = false;
          else if (code === 'KeyQ') inputRef.current.aimDown = false;
          else if (code === 'KeyE') inputRef.current.aimUp = false;
        };

        let downX = 0;
        let downY = 0;
        onCanvasPointerDown = (e) => {
          downX = e.clientX;
          downY = e.clientY;
        };
        onCanvasPointerUp = (e) => {
          if (!interactingRef.current) return;
          if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
            firePollenBall();
          }
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        canvas.addEventListener('pointerdown', onCanvasPointerDown);
        canvas.addEventListener('pointerup', onCanvasPointerUp);

        resizeObserver = new ResizeObserver(() => {
          if (!container || !renderer) return;
          const w = Math.max(container.clientWidth, 300);
          const h = Math.max(container.clientHeight, 300);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        });
        resizeObserver.observe(container);

        // ── Main Render & Physics Loop ──
        let isVisible = true;
        let lastTime = performance.now();
        let elapsed = 0;

        const loop = (now) => {
          if (disposed || !isVisible || document.hidden) {
            rafId = 0;
            return;
          }

          const dt = Math.min((now - lastTime) / 1000, 0.05);
          lastTime = now;
          elapsed += dt;

          if (modeRef.current === 'match') {
            const nextTime = Math.max(0, timeLeftRef.current - dt);
            if (Math.ceil(nextTime) !== Math.ceil(timeLeftRef.current)) {
              setTimeLeft(Math.ceil(nextTime));
            }
            timeLeftRef.current = nextTime;
            if (nextTime <= 0) {
              modeRef.current = 'summary';
              setMode('summary');
              playTone('end');
              setStatusMsg(`Match complete! Final score: ${scoreRef.current}.`);
              try {
                const prevBest = Number(localStorage.getItem(BEST_SCORE_KEY) || '0');
                if (scoreRef.current > prevBest) {
                  localStorage.setItem(BEST_SCORE_KEY, String(scoreRef.current));
                  setBestScore(scoreRef.current);
                }
              } catch {
                // ignore
              }
            }
          }

          // Update mine freeze countdown
          if (freezeRef.current > 0) {
            const nextFreeze = Math.max(0, freezeRef.current - dt);
            if (Math.ceil(nextFreeze * 10) !== Math.ceil(freezeRef.current * 10)) {
              setFreezeLeft(Number(nextFreeze.toFixed(1)));
            }
            freezeRef.current = nextFreeze;
            if (nextFreeze <= 0) {
              baseRingMat.color.setHex(0xc89434);
              setStatusMsg('Robot unfrozen!');
            }
          }

          // 1. Robot driving (locked while frozen by a mine)
          const isFrozen = freezeRef.current > 0;
          const inp = inputRef.current;
          const targetTurn = isFrozen ? 0 : ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * TURN_SPEED;
          const targetMove = isFrozen ? 0 : ((inp.forward ? 1 : 0) - (inp.backward ? 1 : 0)) * DRIVE_SPEED;

          if (isFrozen) {
            turnVel = 0;
            forwardVel = 0;
          } else {
            turnVel += (targetTurn - turnVel) * Math.min(1, dt * 12);
            forwardVel += (targetMove - forwardVel) * Math.min(1, dt * 10);
          }

          if (Math.abs(turnVel) > 0.005) {
            robotHeading += turnVel * dt;
            robotCarrier.rotation.y = robotHeading;
          }

          if (Math.abs(forwardVel) > 0.005) {
            robotCarrier.position.x += Math.sin(robotHeading) * forwardVel * dt;
            robotCarrier.position.z += Math.cos(robotHeading) * forwardVel * dt;
          }

          const bound = ARENA_HALF - ROBOT_RADIUS - 0.08;
          robotCarrier.position.x = THREE.MathUtils.clamp(robotCarrier.position.x, -bound, bound);
          robotCarrier.position.z = THREE.MathUtils.clamp(robotCarrier.position.z, -bound, bound);

          resolveObstacleCollision(robotCarrier.position, ROBOT_RADIUS, robotCarrier.position.y, null);

          // Sample terrain height & slope under the robot
          const rx = robotCarrier.position.x;
          const rz = robotCarrier.position.z;
          const groundH = getTerrainHeight(rx, rz);

          const sinH = Math.sin(robotHeading);
          const cosH = Math.cos(robotHeading);
          const span = 0.22;
          const hFront = getTerrainHeight(rx + sinH * span, rz + cosH * span);
          const hBack = getTerrainHeight(rx - sinH * span, rz - cosH * span);
          const hPosX = getTerrainHeight(rx + cosH * span, rz - sinH * span);
          const hNegX = getTerrainHeight(rx - cosH * span, rz + sinH * span);

          const targetPitch = -Math.atan2(hFront - hBack, span * 2);
          const targetRoll = Math.atan2(hPosX - hNegX, span * 2);

          currentPitch += (targetPitch - currentPitch) * Math.min(1, dt * 14);
          currentRoll += (targetRoll - currentRoll) * Math.min(1, dt * 14);

          recoilOffset = Math.max(0, recoilOffset - dt * 0.14);
          robotCarrier.position.y = groundH + recoilOffset * 0.25;
          robotTilt.rotation.x = currentPitch;
          robotTilt.rotation.z = currentRoll;

          // Car-game third-person chase camera behind robot looking forward downrange
          if (followCamRef.current && hasInteractedRef.current) {
            const isDriving = Math.abs(forwardVel) > 0.08 || Math.abs(turnVel) > 0.08;
            if (!isOrbitDragging && manualLookTimer > 0) {
              manualLookTimer = Math.max(0, manualLookTimer - dt * (isDriving ? 3.5 : 1));
            }
            if (!isOrbitDragging && manualLookTimer <= 0) {
              const chaseDist = 1.95;
              const lookAhead = 1.45;
              const camX = rx - sinH * chaseDist;
              const camZ = rz - cosH * chaseDist;
              const camGroundY = getTerrainHeight(camX, camZ);
              const camY = Math.max(robotCarrier.position.y + 1.02, camGroundY + 0.55);

              desiredCamPos.set(camX, camY, camZ);
              desiredTarget.set(
                rx + sinH * lookAhead,
                robotCarrier.position.y + 0.44,
                rz + cosH * lookAhead
              );

              const posBlend = 1 - Math.exp(-6.5 * dt);
              const tgtBlend = 1 - Math.exp(-8.5 * dt);
              camera.position.lerp(desiredCamPos, posBlend);
              controls.target.lerp(desiredTarget, tgtBlend);
            }
          }

          const wheelSpin = (forwardVel * 7.5 + turnVel * 3.5) * dt;
          if (Math.abs(wheelSpin) > 0.0005) {
            robot.wheels.forEach((w) => { w.rotation.x += wheelSpin; });
            if (robot.intakeAxle) robot.intakeAxle.rotation.x += forwardVel * 9 * dt;
          }

          // 2. Aiming & Trajectory Arc
          if (!isFrozen) {
            const aimDelta = (inp.aimUp ? 1 : 0) - (inp.aimDown ? 1 : 0);
            if (aimDelta !== 0) {
              const nextAim = THREE.MathUtils.clamp(aimDegRef.current + aimDelta * 45 * dt, 22, 62);
              aimDegRef.current = nextAim;
              setAimDeg(Math.round(nextAim));
            }
          }
          updateAimArc();

          flywheelBoost = Math.max(0, flywheelBoost - dt * 1.6);
          const fwSpin = isFrozen ? 0 : (4 + flywheelBoost * 28) * dt;
          robot.flywheelMeshes.forEach((fw) => { fw.rotation.x += fwSpin; });

          // 3. Move ALL 6 Hoops at their 3 Speed Tiers
          targets.forEach((t) => {
            const speedScale = reducedMotion ? 0.35 : 1;
            const offset = Math.sin(elapsed * t.speed * speedScale + t.phase) * t.amp;
            const nx = t.axis === 'x' ? t.baseX + offset : t.baseX;
            const nz = t.axis === 'z' ? t.baseZ + offset : t.baseZ;
            const ny = getTerrainHeight(nx, nz) + t.hAbove;

            t.group.position.set(nx, ny, nz);
            t.worldPos.set(nx, ny, nz);

            if (t.halo && !reducedMotion) {
              t.halo.rotation.z += dt * t.speed * 0.9;
              t.halo.scale.setScalar(1 + Math.sin(elapsed * (3 + t.points * 2)) * 0.06);
            }
            if (t.cooldown > 0) t.cooldown = Math.max(0, t.cooldown - dt);
            if (t.hitFlash > 0) {
              t.hitFlash = Math.max(0, t.hitFlash - dt * 2.5);
              t.coreMat.emissiveIntensity = (t.points === 3 ? 0.9 : 0.65) + t.hitFlash * 2.4;
              t.group.scale.setScalar(1 + t.hitFlash * 0.16);
            }
          });

          // 4. Random Buried Mines (pulse beneath ground, relocate periodically, freeze 3s on trigger)
          mines.forEach((m) => {
            const blink = 0.45 + 0.55 * Math.sin(elapsed * 6.5 + m.phase);
            m.ledMat.color.setRGB(1, 0.15 * blink, 0.08 * blink);
            m.warnRingMat.opacity = 0.12 + 0.25 * blink;

            m.relocateTimer -= dt;
            if (m.relocateTimer <= 0) {
              relocateMine(m);
            }

            if (!isFrozen) {
              const dist = Math.hypot(robotCarrier.position.x - m.x, robotCarrier.position.z - m.z);
              if (dist < 0.38) {
                freezeRef.current = FREEZE_DURATION;
                setFreezeLeft(FREEZE_DURATION);
                baseRingMat.color.setHex(0xff5a36);
                spawnBurst(m.group.position, 20, true);
                spawnWave(
                  new THREE.Vector3(m.x, getTerrainHeight(m.x, m.z) + 0.04, m.z),
                  -Math.PI / 2,
                  0,
                  0xff5a36
                );
                playTone('mine');
                showCallout('Mine Hit! Frozen 3s', true);
                setStatusMsg('Hit a buried mine! Robot frozen for 3 seconds.');
                relocateMine(m);
              }
            }
          });

          // 5. Super-Pollen Field Pickups
          pickups.forEach((p) => {
            if (p.active) {
              if (!reducedMotion) {
                p.orb.rotation.y += dt * 2.2;
                p.group.position.y = p.baseY + Math.sin(elapsed * 3.5 + p.spotIdx) * 0.03;
              }
              const d = Math.hypot(
                robotCarrier.position.x - p.group.position.x,
                robotCarrier.position.z - p.group.position.z
              );
              if (d < 0.42) {
                p.active = false;
                p.respawnTimer = 6.0;
                p.group.visible = false;
                superShotsRef.current = Math.min(superShotsRef.current + 3, 6);
                setSuperShots(superShotsRef.current);
                spawnBurst(p.group.position, 14, false);
                playTone('pickup');
                showCallout('Super Pollen! 3× Spread Shot');
                setStatusMsg('Collected super pollen: 3 spread shots ready.');
              }
            } else {
              p.respawnTimer -= dt;
              if (p.respawnTimer <= 0) {
                const nextSpot = (p.spotIdx + 2) % pickupSpots.length;
                const [nx, nz] = pickupSpots[nextSpot];
                const ny = getTerrainHeight(nx, nz) + 0.16;
                p.spotIdx = nextSpot;
                p.baseY = ny;
                p.group.position.set(nx, ny, nz);
                p.active = true;
                p.group.visible = true;
              }
            }
          });

          // 6. Pollen Ball Physics (Bumpy Terrain + Obstacle Ricochets + Speed-Tier Scoring)
          for (let i = activeBalls.length - 1; i >= 0; i--) {
            const b = activeBalls[i];

            if (!b.landed) {
              b.vel.y -= GRAVITY * dt;
              b.mesh.position.addScaledVector(b.vel, dt);
              b.mesh.rotation.x += dt * 7;

              const wallBound = ARENA_HALF - BALL_RADIUS - 0.06;
              if (Math.abs(b.mesh.position.x) > wallBound) {
                b.mesh.position.x = Math.sign(b.mesh.position.x) * wallBound;
                b.vel.x *= -0.55;
              }
              if (Math.abs(b.mesh.position.z) > wallBound) {
                b.mesh.position.z = Math.sign(b.mesh.position.z) * wallBound;
                b.vel.z *= -0.55;
              }

              if (resolveObstacleCollision(b.mesh.position, BALL_RADIUS, b.mesh.position.y, obsNormal)) {
                const vn = b.vel.dot(obsNormal);
                if (vn < 0) {
                  b.vel.addScaledVector(obsNormal, -1.55 * vn);
                }
              }

              if (!b.scored) {
                for (let tIdx = 0; tIdx < targets.length; tIdx++) {
                  const t = targets[tIdx];
                  if (t.cooldown > 0) continue;
                  if (b.mesh.position.distanceTo(t.worldPos) <= t.radius) {
                    b.scored = true;
                    b.vel.multiplyScalar(0.32);
                    b.vel.y = Math.min(b.vel.y, -0.4);
                    t.hitFlash = 1.0;
                    t.cooldown = 0.45;

                    streakRef.current += 1;
                    setStreak(streakRef.current);

                    const mult = streakRef.current >= 4 ? 3 : streakRef.current >= 2 ? 2 : 1;
                    const pts = t.points * mult;

                    scoreRef.current += pts;
                    setScore(scoreRef.current);
                    hitsLandedRef.current += 1;
                    setHitsLanded(hitsLandedRef.current);

                    spawnBurst(t.worldPos, t.points === 3 ? 18 : 11, false);
                    spawnWave(
                      t.worldPos,
                      0,
                      t.group.rotation.y,
                      t.points === 3 ? 0xff8a65 : 0xffe47a
                    );
                    playTone('hit', streakRef.current + t.points);

                    showCallout(
                      `+${pts} (${t.points}pt Hoop${mult > 1 ? ` × ${mult} Streak` : ''})`
                    );
                    setStatusMsg(`Hit ${t.points} point hoop! Score ${scoreRef.current}.`);
                    break;
                  }
                }
              }

              const floorY = getTerrainHeight(b.mesh.position.x, b.mesh.position.z) + BALL_RADIUS;
              if (b.mesh.position.y <= floorY) {
                b.mesh.position.y = floorY;
                if (b.bounces < 2 && b.vel.lengthSq() > 1.8) {
                  getTerrainSlope(THREE, b.mesh.position.x, b.mesh.position.z, slopeNormal);
                  const vn = b.vel.dot(slopeNormal);
                  if (vn < 0) {
                    b.vel.addScaledVector(slopeNormal, -1.45 * vn);
                  }
                  b.vel.multiplyScalar(0.76);
                  b.bounces += 1;
                } else {
                  b.landed = true;
                  b.vel.set(0, 0, 0);
                  if (!b.scored && !b.isSuper && streakRef.current > 0) {
                    streakRef.current = 0;
                    setStreak(0);
                  }
                }
              }
            } else {
              b.landedTimer += dt;
              const fade = Math.max(0.01, 1 - b.landedTimer / 0.85);
              b.mesh.scale.setScalar(fade);
              if (b.landedTimer >= 0.85) {
                scene.remove(b.mesh);
                activeBalls.splice(i, 1);
              }
            }
          }

          // 7. Animate Sparks & Shockwaves
          sparks.forEach((s) => {
            if (s.life <= 0) return;
            s.life -= dt;
            if (s.life <= 0) {
              s.mesh.visible = false;
              return;
            }
            s.vel.y -= GRAVITY * 0.65 * dt;
            s.mesh.position.addScaledVector(s.vel, dt);
            s.mesh.scale.setScalar(Math.max(0.05, s.life / s.maxLife));
          });

          shockwaves.forEach((w) => {
            if (w.life <= 0) return;
            w.life -= dt;
            if (w.life <= 0) {
              w.mesh.visible = false;
              w.mat.opacity = 0;
              return;
            }
            const progress = 1 - w.life / 0.38;
            w.mesh.scale.setScalar(1 + progress * 1.5);
            w.mat.opacity = (1 - progress) * 0.9;
          });

          controls.update();
          renderer.render(scene, camera);
          rafId = requestAnimationFrame(loop);
        };

        const startLoop = () => {
          if (!rafId && !disposed && isVisible && !document.hidden) {
            lastTime = performance.now();
            rafId = requestAnimationFrame(loop);
          }
        };

        const stopLoop = () => {
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
        };

        intersectionObserver = new IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            isVisible = !!entry && entry.isIntersecting;
            if (isVisible) startLoop();
            else stopLoop();
          },
          { threshold: 0.05 }
        );
        intersectionObserver.observe(container);

        onVisibilityChange = () => {
          if (document.hidden) stopLoop();
          else startLoop();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        startLoop();
      } catch (err) {
        console.error('[RobotArena] WebGL init failed:', err);
        if (!disposed) setWebglOk(false);
      }
    }

    init();

    return () => {
      disposed = true;
      if (calloutTimerRef.current) clearTimeout(calloutTimerRef.current);
      if (rafId) cancelAnimationFrame(rafId);
      if (intersectionObserver) intersectionObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      if (motionQuery && onMotionChange) motionQuery.removeEventListener('change', onMotionChange);
      if (onVisibilityChange) document.removeEventListener('visibilitychange', onVisibilityChange);
      if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
      if (onKeyUp) window.removeEventListener('keyup', onKeyUp);
      if (canvasRef.current && onCanvasPointerDown) {
        canvasRef.current.removeEventListener('pointerdown', onCanvasPointerDown);
      }
      if (canvasRef.current && onCanvasPointerUp) {
        canvasRef.current.removeEventListener('pointerup', onCanvasPointerUp);
      }
      if (controls) {
        if (onControlsStart) controls.removeEventListener('start', onControlsStart);
        if (onControlsEnd) controls.removeEventListener('end', onControlsEnd);
        controls.dispose();
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
      }

      if (scene) {
        scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          }
        });
      }
      if (renderer) renderer.dispose();
    };
  }, [modelUrl]);

  const holdDrive = (key) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      hasInteractedRef.current = true;
      if (controlsRef.current) controlsRef.current.autoRotate = false;
      inputRef.current[key] = true;
    },
    onPointerUp: () => { inputRef.current[key] = false; },
    onPointerLeave: () => { inputRef.current[key] = false; },
    onPointerCancel: () => { inputRef.current[key] = false; },
  });

  const nudgeAim = (delta) => {
    const next = Math.min(62, Math.max(22, aimDegRef.current + delta));
    aimDegRef.current = next;
    setAimDeg(Math.round(next));
  };

  const nudgePower = (deltaPct) => {
    const nextPct = Math.min(100, Math.max(0, powerPct + deltaPct));
    setPowerPct(nextPct);
    speedRef.current = MIN_SPEED + (nextPct / 100) * (MAX_SPEED - MIN_SPEED);
  };

  if (!webglOk) {
    return (
      <div class="ra-fallback">
        <img src={fallbackSrc} alt={fallbackAlt} decoding="async" />
        <p class="ra-fallback__note">Interactive 3D view unavailable on this browser. Showing robot photo.</p>
      </div>
    );
  }

  const accuracy = shotsFired > 0 ? Math.round((hitsLanded / shotsFired) * 100) : 0;
  const isFrozen = freezeLeft > 0;

  return (
    <div
      class={`ra-root ${isExpanded ? 'ra-root--expanded' : ''}`}
      ref={rootRef}
      role="region"
      aria-label="Interactive 3D competition robot obstacle course"
    >
      <div class="ra-canvas-wrap">
        <canvas
          ref={canvasRef}
          class={`ra-canvas ${isInteracting ? 'ra-canvas--active' : 'ra-canvas--locked'}`}
          aria-label="3D view of the WilSonic Boom robot"
        />
      </div>

      {/* Top HUD */}
      <div class="ra-hud-top">
        <div class="ra-hud-group">
          <div class="ra-badge" aria-live="polite">
            <span>Score</span>
            <strong>{score}</strong>
          </div>

          {streak >= 2 && (
            <div class="ra-badge ra-badge--hot">
              <span>Streak</span>
              <strong>{streak >= 4 ? '3×' : '2×'}</strong>
            </div>
          )}

          {mode === 'match' && (
            <div class={`ra-badge ${timeLeft <= 5 ? 'ra-badge--warn' : 'ra-badge--hot'}`}>
              <span>Time</span>
              <strong>{timeLeft}s</strong>
            </div>
          )}

          {isFrozen && (
            <div class="ra-badge ra-badge--frozen" aria-live="assertive">
              <span>Frozen</span>
              <strong>{freezeLeft.toFixed(1)}s</strong>
            </div>
          )}

          {bestScore > 0 && (
            <div class="ra-badge">
              <span>Best</span>
              <strong>{bestScore}</strong>
            </div>
          )}
        </div>

        <div class="ra-hud-group">
          <button
            type="button"
            class={`ra-btn ${mode === 'match' ? 'ra-btn--active' : 'ra-btn--gold'}`}
            aria-label="Start 30 second target challenge"
            onClick={() => startMatchFnRef.current()}
          >
            {mode === 'match' ? 'Restart 30s' : '30s Match'}
          </button>

          <button
            type="button"
            class={`ra-btn ${followCam ? 'ra-btn--active' : ''}`}
            aria-pressed={followCam}
            aria-label="Toggle chase camera behind robot"
            onClick={() => setFollowCam((v) => !v)}
          >
            Follow
          </button>

          <button
            type="button"
            class={`ra-btn ${soundOn ? 'ra-btn--active' : ''}`}
            aria-pressed={soundOn}
            aria-label="Toggle game sound effects"
            onClick={() => setSoundOn((v) => !v)}
          >
            {soundOn ? 'Sound On' : 'Sound Off'}
          </button>

          <button
            type="button"
            class={`ra-btn ${isInteracting ? 'ra-btn--active' : ''}`}
            aria-pressed={isInteracting}
            aria-label={isInteracting ? 'Release 3D view to scroll the page' : 'Interact with 3D robot'}
            onClick={() => setIsInteracting((v) => !v)}
          >
            {isInteracting ? 'Done (Esc)' : 'Interact'}
          </button>

          <button
            type="button"
            class={`ra-btn ${isExpanded ? 'ra-btn--active' : ''}`}
            aria-pressed={isExpanded}
            aria-label={isExpanded ? 'Exit fullscreen' : 'Expand 3D game to fullscreen'}
            onClick={toggleExpand}
          >
            {isExpanded ? 'Exit Full' : 'Expand'}
          </button>

          <button
            type="button"
            class="ra-btn"
            aria-label="Reset robot position and score"
            onClick={() => resetFnRef.current()}
          >
            Reset
          </button>
        </div>
      </div>

      {callout.text && (
        <div class={`ra-callout ${callout.danger ? 'ra-callout--danger' : ''}`}>
          {callout.text}
        </div>
      )}

      {/* End-of-Match Summary */}
      {mode === 'summary' && (
        <div class="ra-center-card" role="dialog" aria-label="Match results">
          <p class="ra-center-card__title">Match Complete</p>
          <div class="ra-center-card__stats">
            <div class="ra-stat-item">
              <span>Score</span>
              <strong>{score}</strong>
            </div>
            <div class="ra-stat-item">
              <span>Best</span>
              <strong>{Math.max(bestScore, score)}</strong>
            </div>
            <div class="ra-stat-item">
              <span>Accuracy</span>
              <strong>{accuracy}%</strong>
            </div>
          </div>
          <div class="ra-center-card__actions">
            <button
              type="button"
              class="ra-btn ra-btn--gold"
              onClick={() => startMatchFnRef.current()}
            >
              Play Again
            </button>
            <button
              type="button"
              class="ra-btn"
              onClick={() => resetFnRef.current()}
            >
              Free Play
            </button>
          </div>
        </div>
      )}

      {/* Scroll-safe prompt shown until Interact is clicked */}
      {!isInteracting && mode !== 'summary' && (
        <div class="ra-lock-prompt">
          <button
            type="button"
            class="ra-btn ra-btn--gold"
            aria-label="Click to orbit, zoom, and drive the 3D robot"
            onClick={() => setIsInteracting(true)}
          >
            Interact with 3D Robot
          </button>
          <p class="ra-lock-hint">
            1pt / 2pt / 3pt moving hoops · Watch out for red buried mines (3s freeze!)
          </p>
        </div>
      )}

      {/* Bottom Controls */}
      <div class="ra-controls">
        <div class="ra-dpad" role="group" aria-label="Drive robot">
          <button
            type="button"
            class="ra-btn ra-dpad__btn ra-dpad__up"
            aria-label="Drive forward"
            title="Drive forward (W or Up arrow)"
            disabled={isFrozen}
            {...holdDrive('forward')}
          >
            ▲
          </button>
          <button
            type="button"
            class="ra-btn ra-dpad__btn ra-dpad__left"
            aria-label="Turn left"
            title="Turn left (A or Left arrow)"
            disabled={isFrozen}
            {...holdDrive('left')}
          >
            ◀
          </button>
          <button
            type="button"
            class="ra-btn ra-dpad__btn ra-dpad__down"
            aria-label="Drive backward"
            title="Drive backward (S or Down arrow)"
            disabled={isFrozen}
            {...holdDrive('backward')}
          >
            ▼
          </button>
          <button
            type="button"
            class="ra-btn ra-dpad__btn ra-dpad__right"
            aria-label="Turn right"
            title="Turn right (D or Right arrow)"
            disabled={isFrozen}
            {...holdDrive('right')}
          >
            ▶
          </button>
        </div>

        <div class="ra-action-stack">
          <div class="ra-stepper" role="group" aria-label="Shooter aim angle">
            <button
              type="button"
              class="ra-btn"
              aria-label="Lower shooter aim angle"
              title="Aim lower (Q)"
              disabled={isFrozen}
              onClick={() => nudgeAim(-4)}
            >
              −
            </button>
            <span class="ra-stepper__label">Aim {aimDeg}°</span>
            <button
              type="button"
              class="ra-btn"
              aria-label="Raise shooter aim angle"
              title="Aim higher (E)"
              disabled={isFrozen}
              onClick={() => nudgeAim(4)}
            >
              +
            </button>
          </div>

          <div class="ra-stepper" role="group" aria-label="Shooter launch power">
            <button
              type="button"
              class="ra-btn"
              aria-label="Decrease shot power"
              disabled={isFrozen}
              onClick={() => nudgePower(-15)}
            >
              −
            </button>
            <span class="ra-stepper__label">Power {powerPct}%</span>
            <button
              type="button"
              class="ra-btn"
              aria-label="Increase shot power"
              disabled={isFrozen}
              onClick={() => nudgePower(15)}
            >
              +
            </button>
          </div>

          <button
            type="button"
            class={`ra-btn ra-btn--shoot ${superShots > 0 ? 'ra-btn--super' : 'ra-btn--gold'}`}
            aria-label="Shoot a pollen ball"
            title="Shoot pollen ball (Space)"
            disabled={isFrozen}
            onClick={() => shootFnRef.current()}
          >
            {isFrozen
              ? `Frozen (${freezeLeft.toFixed(1)}s)`
              : superShots > 0
                ? `3× Shoot (${superShots})`
                : 'Shoot'}
          </button>
        </div>
      </div>

      <span class="ra-sr-only" aria-live="polite">{statusMsg}</span>
    </div>
  );
}
