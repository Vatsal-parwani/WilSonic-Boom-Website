/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import './robot-arena.css';

const GRAVITY = 9.81;
const DEFAULT_SPEED = 6.6;
const MIN_SPEED = 4.6;
const MAX_SPEED = 9.0;
const MAX_AIR_BALLS = 12;
const DRIVE_SPEED = 2.25;
const TURN_SPEED = 2.75;
const DEFAULT_AIM_DEG = 42;
const SOLO_MATCH_SECONDS = 30;
const PVP_MATCH_SECONDS = 120;
const MAX_HP = 100;
const HIT_DAMAGE = 20;
const SUPER_HIT_DAMAGE = 15;
const RESPAWN_SECONDS = 7.0;
const FREEZE_DURATION = 3.0;
const BEST_SCORE_KEY = 'wilsonic_boom_best_score_v1';

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
}

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')));
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

  const [mode, setMode] = useState('free');
  const [timeLeft, setTimeLeft] = useState(SOLO_MATCH_SECONDS);
  const [freezeLeft, setFreezeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [superShots, setSuperShots] = useState(0);
  const [shotsFired, setShotsFired] = useState(0);
  const [hitsLanded, setHitsLanded] = useState(0);

  const [myHp, setMyHp] = useState(MAX_HP);
  const [oppHp, setOppHp] = useState(MAX_HP);
  const [myKos, setMyKos] = useState(0);
  const [oppKos, setOppKos] = useState(0);
  const [respawnLeft, setRespawnLeft] = useState(0);
  const [oppRespawning, setOppRespawning] = useState(false);
  const [pvpStatus, setPvpStatus] = useState('');

  const [aimDeg, setAimDeg] = useState(DEFAULT_AIM_DEG);
  const [powerPct, setPowerPct] = useState(45);
  const [callout, setCallout] = useState({ text: '', danger: false });
  const [statusMsg, setStatusMsg] = useState('Robot ready. Click Interact to explore the course.');

  const interactingRef = useRef(false);
  const hasInteractedRef = useRef(false);
  const followCamRef = useRef(true);
  const soundOnRef = useRef(false);
  const modeRef = useRef('free');
  const timeLeftRef = useRef(SOLO_MATCH_SECONDS);
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

  const myHpRef = useRef(MAX_HP);
  const oppHpRef = useRef(MAX_HP);
  const myKosRef = useRef(0);
  const oppKosRef = useRef(0);
  const respawnRef = useRef(0);
  const oppRespawnRef = useRef(false);
  const oppConnectedRef = useRef(false);

  const inputRef = useRef({ forward: false, backward: false, left: false, right: false, aimUp: false, aimDown: false });
  const shootFnRef = useRef(() => {});
  const resetFnRef = useRef(() => {});
  const startSoloMatchFnRef = useRef(() => {});
  const startPvpSearchFnRef = useRef(() => {});
  const cancelPvpFnRef = useRef(() => {});

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(BEST_SCORE_KEY) || '0');
      if (Number.isFinite(saved) && saved > 0) setBestScore(saved);
    } catch {}
  }, []);

  useEffect(() => {
    interactingRef.current = isInteracting;
    const ctrl = controlsRef.current;
    if (ctrl) {
      ctrl.enableZoom = isInteracting;
      ctrl.enableRotate = isInteracting;
      if (isInteracting) { hasInteractedRef.current = true; ctrl.autoRotate = false; }
    }
  }, [isInteracting]);

  useEffect(() => { followCamRef.current = followCam; }, [followCam]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

  function showCallout(text, danger = false) {
    setCallout({ text, danger });
    if (calloutTimerRef.current) clearTimeout(calloutTimerRef.current);
    calloutTimerRef.current = setTimeout(() => setCallout({ text: '', danger: false }), 1500);
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
        osc.start(now); osc.stop(now + 0.1);
      } else if (kind === 'hit') {
        osc.type = 'sine';
        const base = 460 + Math.min(extra, 6) * 75;
        osc.frequency.setValueAtTime(base, now);
        osc.frequency.exponentialRampToValueAtTime(base * 1.45, now + 0.14);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now); osc.stop(now + 0.18);
      } else if (kind === 'pickup') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.06);
        osc.frequency.setValueAtTime(784, now + 0.12);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.start(now); osc.stop(now + 0.24);
      } else if (kind === 'mine' || kind === 'ko') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(kind === 'ko' ? 190 : 160, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.4);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc.start(now); osc.stop(now + 0.42);
      } else if (kind === 'end') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(520, now + 0.12);
        osc.frequency.setValueAtTime(880, now + 0.24);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.start(now); osc.stop(now + 0.45);
      }
    } catch {}
  }

  async function toggleExpand() {
    const el = rootRef.current;
    if (!el) return;
    if (!isExpanded) {
      setIsInteracting(true);
      if (el.requestFullscreen) {
        try { await el.requestFullscreen(); setIsExpanded(true); return; } catch {}
      }
      setIsExpanded(true);
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); } catch {}
      }
      setIsExpanded(false);
    }
  }

  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setIsExpanded(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (!isInteracting) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { if (isExpanded) setIsExpanded(false); else setIsInteracting(false); }
    };
    const onDocDown = (e) => {
      if (!isExpanded && rootRef.current && !rootRef.current.contains(e.target)) setIsInteracting(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDocDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDocDown); };
  }, [isInteracting, isExpanded]);

  useEffect(() => {
    if (!supportsWebGL()) { setWebglOk(false); return; }

    let disposed = false, rafId = 0, renderer = null, scene = null, controls = null;
    let resizeObserver = null, intersectionObserver = null, motionQuery = null;
    let onMotionChange = null, onVisChange = null, onKeyDown = null, onKeyUp = null;
    let onCanvasDown = null, onCanvasUp = null, onCtrlStart = null, onCtrlEnd = null;
    let pvp = null;

    async function init() {
      const container = rootRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      try {
        const [THREE, { OrbitControls }, { loadRobotModel }, worldMod, { createPvpClient }] = await Promise.all([
          import('three'),
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('./robotModel.js'),
          import('./arenaWorld.js'),
          import('./pvpMatch.js'),
        ]);
        if (disposed) return;

        const {
          ARENA_HALF, ROBOT_RADIUS, BALL_RADIUS, getTerrainHeight, getTerrainSlope,
          createBillboardHpBar, setBillboardHp, createArenaWorld,
        } = worldMod;

        pvp = createPvpClient();

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x101012);
        scene.fog = new THREE.Fog(0x101012, 11.5, 25);

        const width = Math.max(container.clientWidth, 320);
        const height = Math.max(container.clientHeight, 320);
        const camera = new THREE.PerspectiveCamera(48, width / height, 0.08, 45);
        camera.position.set(1.9, 1.55, 3.25);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.18;

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
        onCtrlStart = () => { isOrbitDragging = true; manualLookTimer = 1.6; };
        onCtrlEnd = () => { isOrbitDragging = false; };
        controls.addEventListener('start', onCtrlStart);
        controls.addEventListener('end', onCtrlEnd);

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

        const robot = await loadRobotModel(THREE, modelUrl);
        if (disposed) return;

        const robotCarrier = new THREE.Group();
        const robotTilt = new THREE.Group();
        robotCarrier.add(robotTilt);
        robotTilt.add(robot.root);
        scene.add(robotCarrier);

        const baseRingMat = new THREE.MeshBasicMaterial({ color: 0xc89434, side: THREE.DoubleSide, transparent: true, opacity: 0.65 });
        const baseRing = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.27, 28), baseRingMat);
        baseRing.rotation.x = -Math.PI / 2;
        baseRing.position.y = 0.01;
        const noseChevron = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.095, 3), new THREE.MeshBasicMaterial({ color: 0xefc069 }));
        noseChevron.rotation.x = Math.PI / 2;
        noseChevron.position.set(0, 0.015, 0.33);
        robotTilt.add(baseRing, noseChevron);

        const myHpBar = createBillboardHpBar(THREE, 0xefc069);
        robotCarrier.add(myHpBar.group);

        const oppRobot = await loadRobotModel(THREE, modelUrl);
        if (disposed) return;
        const oppCarrier = new THREE.Group();
        const oppTilt = new THREE.Group();
        oppCarrier.add(oppTilt);
        oppTilt.add(oppRobot.root);
        oppCarrier.visible = false;
        scene.add(oppCarrier);

        const oppRing = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.29, 28), new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
        oppRing.rotation.x = -Math.PI / 2;
        oppRing.position.y = 0.012;
        const oppChevron = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.095, 3), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
        oppChevron.rotation.x = Math.PI / 2;
        oppChevron.position.set(0, 0.015, 0.33);
        oppTilt.add(oppRing, oppChevron);

        const oppHpBar = createBillboardHpBar(THREE, 0x38bdf8);
        oppCarrier.add(oppHpBar.group);

        const oppTargetState = { x: 0, y: getTerrainHeight(0, -2.35), z: -2.35, heading: 0, pitch: 0, roll: 0 };

        let robotHeading = Math.PI, forwardVel = 0, turnVel = 0, recoilOffset = 0, currentPitch = 0, currentRoll = 0;
        robotCarrier.position.set(0, getTerrainHeight(0, 1.6), 1.6);
        robotCarrier.rotation.y = robotHeading;

        const world = createArenaWorld(THREE, scene, robotCarrier);

        const ARC_STEPS = 26;
        const arcGeo = new THREE.BufferGeometry();
        arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_STEPS * 3), 3));
        const arcMat = new THREE.LineDashedMaterial({ color: 0xefc069, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.65 });
        const arcLine = new THREE.Line(arcGeo, arcMat);
        scene.add(arcLine);

        const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 16, 14);
        const normalBallMat = new THREE.MeshStandardMaterial({ color: 0xf4c430, emissive: 0x594106, emissiveIntensity: 0.35, roughness: 0.7, metalness: 0.08 });
        const superBallMat = new THREE.MeshStandardMaterial({ color: 0xfff08a, emissive: 0xc89434, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.3 });
        const oppBallMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0c4a6e, emissiveIntensity: 0.65, roughness: 0.45, metalness: 0.2 });

        const activeBalls = [];
        let flywheelBoost = 0;

        const tmpQuat = new THREE.Quaternion(), tmpDir = new THREE.Vector3(), tmpYawQuat = new THREE.Quaternion();
        const upAxis = new THREE.Vector3(0, 1, 0), slopeNormal = new THREE.Vector3(), obsNormal = new THREE.Vector3();
        const desiredCamPos = new THREE.Vector3(), desiredTarget = new THREE.Vector3(), oppHitCenter = new THREE.Vector3();

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
          outVel.copy(tmpDir).multiplyScalar(speedRef.current * speedScale);
        }

        function updateAimArc() {
          const startPos = new THREE.Vector3(), startVel = new THREE.Vector3();
          computeLaunchState(startPos, startVel);
          const attr = arcGeo.getAttribute('position');
          for (let i = 0; i < ARC_STEPS; i++) {
            const t = i * 0.045;
            const px = startPos.x + startVel.x * t;
            const pz = startPos.z + startVel.z * t;
            const py = Math.max(getTerrainHeight(px, pz) + 0.02, startPos.y + startVel.y * t - 0.5 * GRAVITY * t * t);
            attr.setXYZ(i, px, py, pz);
          }
          attr.needsUpdate = true;
          arcLine.computeLineDistances();
          arcMat.color.setHex(freezeRef.current > 0 ? 0xff5a36 : superShotsRef.current > 0 ? 0xfff08a : 0xefc069);
        }

        function spawnBallFromState(pos, vel, owner, isSuper) {
          if (activeBalls.length >= MAX_AIR_BALLS) scene.remove(activeBalls.shift().mesh);
          const mesh = new THREE.Mesh(ballGeo, owner === 'opp' ? oppBallMat : isSuper ? superBallMat : normalBallMat);
          mesh.position.copy(pos);
          mesh.castShadow = true;
          scene.add(mesh);
          activeBalls.push({ mesh, vel: vel.clone(), owner, isSuper, bounces: 0, landed: false, landedTimer: 0, scored: false });
        }

        function spawnLocalBall(yawOffset, isSuper) {
          const spawnPos = new THREE.Vector3(), launchVel = new THREE.Vector3();
          computeLaunchState(spawnPos, launchVel, yawOffset, isSuper ? 1.04 : 1);
          spawnBallFromState(spawnPos, launchVel, 'me', isSuper);
          if (modeRef.current === 'pvp') {
            pvp.sendShoot({ pos: [spawnPos.x, spawnPos.y, spawnPos.z], vel: [launchVel.x, launchVel.y, launchVel.z], isSuper });
          }
        }

        function firePollenBall() {
          if (['summary', 'pvp-summary', 'searching'].includes(modeRef.current) || freezeRef.current > 0 || respawnRef.current > 0) return;
          hasInteractedRef.current = true;
          controls.autoRotate = false;
          if (superShotsRef.current > 0) {
            superShotsRef.current -= 1;
            setSuperShots(superShotsRef.current);
            spawnLocalBall(-0.11, true);
            spawnLocalBall(0, true);
            spawnLocalBall(0.11, true);
            setStatusMsg('Super pollen volley fired!');
          } else {
            spawnLocalBall(0, false);
            setStatusMsg('Pollen ball launched.');
          }
          shotsFiredRef.current += 1;
          setShotsFired(shotsFiredRef.current);
          flywheelBoost = 1.0;
          recoilOffset = 0.025;
          playTone('shoot');
        }

        function spawnRobotAtCorner(useSouth) {
          const sz = useSouth ? 2.15 : -2.35;
          robotHeading = useSouth ? Math.PI : 0;
          robotCarrier.position.set(0, getTerrainHeight(0, sz), sz);
          robotCarrier.rotation.y = robotHeading;
          robotTilt.rotation.set(0, 0, 0);
          currentPitch = 0; currentRoll = 0; forwardVel = 0; turnVel = 0;
          robotCarrier.visible = true;
        }

        function resetGame(nextMode = 'free') {
          if (nextMode !== 'pvp') { pvp.leave(); oppConnectedRef.current = false; }
          robotHeading = Math.PI; forwardVel = 0; turnVel = 0; recoilOffset = 0;
          currentPitch = 0; currentRoll = 0; manualLookTimer = 0; isOrbitDragging = false;
          freezeRef.current = 0; respawnRef.current = 0; oppRespawnRef.current = false;
          setFreezeLeft(0); setRespawnLeft(0); setOppRespawning(false);
          baseRingMat.color.setHex(0xc89434);
          robotCarrier.visible = true;

          const startY = getTerrainHeight(0, 1.6);
          robotCarrier.position.set(0, startY, 1.6);
          robotCarrier.rotation.y = robotHeading;
          robotTilt.rotation.set(0, 0, 0);

          oppCarrier.visible = nextMode === 'pvp';
          myHpBar.group.visible = nextMode === 'pvp';
          oppHpBar.group.visible = nextMode === 'pvp';

          aimDegRef.current = DEFAULT_AIM_DEG; setAimDeg(DEFAULT_AIM_DEG);
          speedRef.current = DEFAULT_SPEED; setPowerPct(45);

          while (activeBalls.length > 0) scene.remove(activeBalls.pop().mesh);

          scoreRef.current = 0; streakRef.current = 0; superShotsRef.current = 0;
          shotsFiredRef.current = 0; hitsLandedRef.current = 0;
          myHpRef.current = MAX_HP; oppHpRef.current = MAX_HP;
          myKosRef.current = 0; oppKosRef.current = 0;
          setBillboardHp(myHpBar, MAX_HP); setBillboardHp(oppHpBar, MAX_HP);

          timeLeftRef.current = nextMode === 'pvp' ? PVP_MATCH_SECONDS : SOLO_MATCH_SECONDS;
          modeRef.current = nextMode;

          setScore(0); setStreak(0); setSuperShots(0); setShotsFired(0); setHitsLanded(0);
          setMyHp(MAX_HP); setOppHp(MAX_HP); setMyKos(0); setOppKos(0);
          setTimeLeft(timeLeftRef.current); setMode(nextMode);
          setCallout({ text: '', danger: false });

          world.pickups.forEach((p, idx) => {
            const [px, pz] = world.pickupSpots[idx];
            const py = getTerrainHeight(px, pz) + 0.16;
            p.active = true; p.respawnTimer = 0; p.spotIdx = idx; p.baseY = py;
            p.group.position.set(px, py, pz); p.group.visible = true;
          });
          world.mines.forEach((m) => world.relocateMine(m));
          world.targets.forEach((t) => {
            t.hitFlash = 0; t.cooldown = 0;
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

        function startSoloMatch() {
          hasInteractedRef.current = true;
          controls.autoRotate = false;
          resetGame('match');
          setIsInteracting(true);
          showCallout('30s Match — Go!');
          setStatusMsg('30 second challenge started!');
        }

        function startPvpSearch() {
          hasInteractedRef.current = true;
          controls.autoRotate = false;
          setIsInteracting(true);
          modeRef.current = 'searching';
          setMode('searching');
          setPvpStatus('Connecting to live matchmaking…');

          pvp.startSearch({
            onStatus: (msg) => setPvpStatus(msg),
            onMatchStart: ({ amHost }) => {
              resetGame('pvp');
              spawnRobotAtCorner(amHost);
              const oppZ = amHost ? -2.35 : 2.15;
              oppTargetState.x = 0; oppTargetState.y = getTerrainHeight(0, oppZ); oppTargetState.z = oppZ;
              oppTargetState.heading = amHost ? 0 : Math.PI; oppTargetState.pitch = 0; oppTargetState.roll = 0;
              oppCarrier.position.set(0, oppTargetState.y, oppZ);
              oppCarrier.rotation.y = oppTargetState.heading;
              oppCarrier.visible = true;
              oppConnectedRef.current = true;

              if (followCamRef.current) {
                const sH = Math.sin(robotHeading), cH = Math.cos(robotHeading);
                camera.position.set(robotCarrier.position.x - sH * 1.95, robotCarrier.position.y + 1.02, robotCarrier.position.z - cH * 1.95);
                controls.target.set(robotCarrier.position.x + sH * 1.45, robotCarrier.position.y + 0.44, robotCarrier.position.z + cH * 1.45);
                controls.update();
              }
              setPvpStatus('Opponent found! 2:00 1v1 Match started!');
              showCallout('1v1 Match — 2:00 Fight!');
              setIsInteracting(true);
            },
            getStatePayload: () => modeRef.current === 'pvp' ? {
              x: Number(robotCarrier.position.x.toFixed(3)),
              y: Number(robotCarrier.position.y.toFixed(3)),
              z: Number(robotCarrier.position.z.toFixed(3)),
              h: Number(robotHeading.toFixed(3)),
              p: Number(currentPitch.toFixed(3)),
              r: Number(currentRoll.toFixed(3)),
              hp: myHpRef.current,
              dead: respawnRef.current > 0,
            } : null,
            onOppState: (data) => {
              if (!data || modeRef.current !== 'pvp') return;
              oppTargetState.x = data.x; oppTargetState.y = data.y; oppTargetState.z = data.z;
              oppTargetState.heading = data.h; oppTargetState.pitch = data.p || 0; oppTargetState.roll = data.r || 0;
              if (typeof data.hp === 'number') {
                oppHpRef.current = data.hp; setOppHp(data.hp); setBillboardHp(oppHpBar, data.hp);
              }
              const dead = !!data.dead;
              if (dead !== oppRespawnRef.current) {
                oppRespawnRef.current = dead; setOppRespawning(dead); oppCarrier.visible = !dead;
              }
            },
            onOppShoot: (data) => {
              if (!data || modeRef.current !== 'pvp') return;
              spawnBallFromState(new THREE.Vector3(...data.pos), new THREE.Vector3(...data.vel), 'opp', !!data.isSuper);
            },
            onHit: (data) => {
              if (!data || modeRef.current !== 'pvp' || respawnRef.current > 0) return;
              const dmg = Number(data.dmg) || HIT_DAMAGE;
              const nextHp = Math.max(0, myHpRef.current - dmg);
              myHpRef.current = nextHp; setMyHp(nextHp); setBillboardHp(myHpBar, nextHp);
              world.spawnBurst(new THREE.Vector3(robotCarrier.position.x, robotCarrier.position.y + 0.28, robotCarrier.position.z), 10, 'red');
              playTone('mine');
              if (nextHp <= 0) {
                respawnRef.current = RESPAWN_SECONDS; setRespawnLeft(RESPAWN_SECONDS);
                oppKosRef.current += 1; setOppKos(oppKosRef.current);
                robotCarrier.visible = false;
                world.spawnBurst(robotCarrier.position, 24, 'red');
                world.spawnWave(new THREE.Vector3(robotCarrier.position.x, robotCarrier.position.y + 0.08, robotCarrier.position.z), -Math.PI / 2, 0, 0xff5a36);
                playTone('ko');
                showCallout('Destroyed! Respawning in 7s', true);
                setStatusMsg('Your robot was destroyed! Respawning in 7 seconds.');
                pvp.sendKo({ ok: true });
              } else {
                showCallout(`-${dmg} HP!`, true);
              }
            },
            onKo: () => {
              if (modeRef.current !== 'pvp') return;
              myKosRef.current += 1; setMyKos(myKosRef.current);
              hitsLandedRef.current += 1; setHitsLanded(hitsLandedRef.current);
              world.spawnBurst(oppCarrier.position, 24, 'cyan');
              playTone('hit', 5);
              showCallout('KO! +1 Point');
              setStatusMsg('Opponent knocked out! +1 KO.');
            },
            onPeerLeft: () => {
              if (modeRef.current !== 'pvp') return;
              pvp.leave(); oppConnectedRef.current = false;
              oppCarrier.visible = false; myHpBar.group.visible = false; oppHpBar.group.visible = false;
              modeRef.current = 'pvp-summary'; setMode('pvp-summary');
              setPvpStatus('Opponent left the match.');
              showCallout('Opponent disconnected', true);
            },
            onError: () => {
              pvp.leave();
              modeRef.current = 'free'; setMode('free');
              showCallout('Matchmaking blocked by network', true);
              setStatusMsg('Could not connect to peer matchmaking on this network.');
            },
          });
        }

        shootFnRef.current = firePollenBall;
        resetFnRef.current = () => { resetGame('free'); setStatusMsg('Arena reset.'); };
        startSoloMatchFnRef.current = startSoloMatch;
        startPvpSearchFnRef.current = startPvpSearch;
        cancelPvpFnRef.current = () => { resetGame('free'); setPvpStatus(''); setStatusMsg('Returned to Free Play.'); };
        updateAimArc();

        onKeyDown = (e) => {
          if (!(interactingRef.current || (document.activeElement && container.contains(document.activeElement)))) return;
          const code = e.code;
          if (code === 'KeyW' || code === 'ArrowUp') { e.preventDefault(); inputRef.current.forward = true; hasInteractedRef.current = true; controls.autoRotate = false; }
          else if (code === 'KeyS' || code === 'ArrowDown') { e.preventDefault(); inputRef.current.backward = true; hasInteractedRef.current = true; controls.autoRotate = false; }
          else if (code === 'KeyA' || code === 'ArrowLeft') { e.preventDefault(); inputRef.current.left = true; hasInteractedRef.current = true; controls.autoRotate = false; }
          else if (code === 'KeyD' || code === 'ArrowRight') { e.preventDefault(); inputRef.current.right = true; hasInteractedRef.current = true; controls.autoRotate = false; }
          else if (code === 'KeyQ') inputRef.current.aimDown = true;
          else if (code === 'KeyE') inputRef.current.aimUp = true;
          else if (code === 'Space') {
            if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
            e.preventDefault(); firePollenBall();
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

        let downX = 0, downY = 0;
        onCanvasDown = (e) => { downX = e.clientX; downY = e.clientY; };
        onCanvasUp = (e) => {
          if (interactingRef.current && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) firePollenBall();
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        canvas.addEventListener('pointerdown', onCanvasDown);
        canvas.addEventListener('pointerup', onCanvasUp);

        resizeObserver = new ResizeObserver(() => {
          if (!container || !renderer) return;
          const w = Math.max(container.clientWidth, 300);
          const h = Math.max(container.clientHeight, 300);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        });
        resizeObserver.observe(container);

        let isVisible = true, lastTime = performance.now(), elapsed = 0;

        const loop = (now) => {
          if (disposed || !isVisible || document.hidden) { rafId = 0; return; }
          const dt = Math.min((now - lastTime) / 1000, 0.05);
          lastTime = now;
          elapsed += dt;

          if (modeRef.current === 'match' || modeRef.current === 'pvp') {
            const nextTime = Math.max(0, timeLeftRef.current - dt);
            if (Math.ceil(nextTime) !== Math.ceil(timeLeftRef.current)) setTimeLeft(Math.ceil(nextTime));
            timeLeftRef.current = nextTime;
            if (nextTime <= 0) {
              const wasPvp = modeRef.current === 'pvp';
              modeRef.current = wasPvp ? 'pvp-summary' : 'summary';
              setMode(modeRef.current);
              playTone('end');
              if (wasPvp) {
                pvp.leave(); oppConnectedRef.current = false;
                oppCarrier.visible = false; myHpBar.group.visible = false; oppHpBar.group.visible = false;
                setPvpStatus('Match time up!');
                setStatusMsg(`1v1 Match finished: ${myKosRef.current} to ${oppKosRef.current}.`);
              } else {
                setStatusMsg(`Match complete! Final score: ${scoreRef.current}.`);
                try {
                  const prev = Number(localStorage.getItem(BEST_SCORE_KEY) || '0');
                  if (scoreRef.current > prev) { localStorage.setItem(BEST_SCORE_KEY, String(scoreRef.current)); setBestScore(scoreRef.current); }
                } catch {}
              }
            }
          }

          if (respawnRef.current > 0) {
            const nextR = Math.max(0, respawnRef.current - dt);
            if (Math.ceil(nextR * 10) !== Math.ceil(respawnRef.current * 10)) setRespawnLeft(Number(nextR.toFixed(1)));
            respawnRef.current = nextR;
            if (nextR <= 0) {
              myHpRef.current = MAX_HP; setMyHp(MAX_HP); setBillboardHp(myHpBar, MAX_HP);
              freezeRef.current = 0; setFreezeLeft(0); baseRingMat.color.setHex(0xc89434);
              spawnRobotAtCorner(oppCarrier.position.z < 0);
              showCallout('Respawned!');
              setStatusMsg('Robot respawned at full health.');
            }
          }

          if (freezeRef.current > 0) {
            const nextF = Math.max(0, freezeRef.current - dt);
            if (Math.ceil(nextF * 10) !== Math.ceil(freezeRef.current * 10)) setFreezeLeft(Number(nextF.toFixed(1)));
            freezeRef.current = nextF;
            if (nextF <= 0) { baseRingMat.color.setHex(0xc89434); setStatusMsg('Robot unfrozen!'); }
          }

          const isLocked = freezeRef.current > 0 || respawnRef.current > 0 || modeRef.current === 'searching';
          const inp = inputRef.current;
          const targetTurn = isLocked ? 0 : ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * TURN_SPEED;
          const targetMove = isLocked ? 0 : ((inp.forward ? 1 : 0) - (inp.backward ? 1 : 0)) * DRIVE_SPEED;

          if (isLocked) { turnVel = 0; forwardVel = 0; }
          else {
            turnVel += (targetTurn - turnVel) * Math.min(1, dt * 12);
            forwardVel += (targetMove - forwardVel) * Math.min(1, dt * 10);
          }

          if (Math.abs(turnVel) > 0.005) { robotHeading += turnVel * dt; robotCarrier.rotation.y = robotHeading; }
          if (Math.abs(forwardVel) > 0.005) {
            robotCarrier.position.x += Math.sin(robotHeading) * forwardVel * dt;
            robotCarrier.position.z += Math.cos(robotHeading) * forwardVel * dt;
          }

          const bound = ARENA_HALF - ROBOT_RADIUS - 0.08;
          robotCarrier.position.x = THREE.MathUtils.clamp(robotCarrier.position.x, -bound, bound);
          robotCarrier.position.z = THREE.MathUtils.clamp(robotCarrier.position.z, -bound, bound);
          world.resolveObstacleCollision(robotCarrier.position, ROBOT_RADIUS, robotCarrier.position.y, null);

          const rx = robotCarrier.position.x, rz = robotCarrier.position.z;
          const sinH = Math.sin(robotHeading), cosH = Math.cos(robotHeading), span = 0.22;
          const targetPitch = -Math.atan2(getTerrainHeight(rx + sinH * span, rz + cosH * span) - getTerrainHeight(rx - sinH * span, rz - cosH * span), span * 2);
          const targetRoll = Math.atan2(getTerrainHeight(rx + cosH * span, rz - sinH * span) - getTerrainHeight(rx - cosH * span, rz + sinH * span), span * 2);
          currentPitch += (targetPitch - currentPitch) * Math.min(1, dt * 14);
          currentRoll += (targetRoll - currentRoll) * Math.min(1, dt * 14);
          recoilOffset = Math.max(0, recoilOffset - dt * 0.14);
          robotCarrier.position.y = getTerrainHeight(rx, rz) + recoilOffset * 0.25;
          robotTilt.rotation.x = currentPitch;
          robotTilt.rotation.z = currentRoll;

          if (modeRef.current === 'pvp' && oppConnectedRef.current) {
            const blend = 1 - Math.exp(-14 * dt);
            oppCarrier.position.x += (oppTargetState.x - oppCarrier.position.x) * blend;
            oppCarrier.position.y += (oppTargetState.y - oppCarrier.position.y) * blend;
            oppCarrier.position.z += (oppTargetState.z - oppCarrier.position.z) * blend;
            let dh = oppTargetState.heading - oppCarrier.rotation.y;
            while (dh > Math.PI) dh -= Math.PI * 2;
            while (dh < -Math.PI) dh += Math.PI * 2;
            oppCarrier.rotation.y += dh * blend;
            oppTilt.rotation.x += (oppTargetState.pitch - oppTilt.rotation.x) * blend;
            oppTilt.rotation.z += (oppTargetState.roll - oppTilt.rotation.z) * blend;
            myHpBar.group.quaternion.copy(camera.quaternion);
            oppHpBar.group.quaternion.copy(camera.quaternion);
          }

          if (followCamRef.current && hasInteractedRef.current) {
            const isDriving = Math.abs(forwardVel) > 0.08 || Math.abs(turnVel) > 0.08;
            if (!isOrbitDragging && manualLookTimer > 0) manualLookTimer = Math.max(0, manualLookTimer - dt * (isDriving ? 3.5 : 1));
            if (!isOrbitDragging && manualLookTimer <= 0) {
              const camX = rx - sinH * 1.95, camZ = rz - cosH * 1.95;
              const camY = Math.max(robotCarrier.position.y + 1.02, getTerrainHeight(camX, camZ) + 0.55);
              desiredCamPos.set(camX, camY, camZ);
              desiredTarget.set(rx + sinH * 1.45, robotCarrier.position.y + 0.44, rz + cosH * 1.45);
              camera.position.lerp(desiredCamPos, 1 - Math.exp(-6.5 * dt));
              controls.target.lerp(desiredTarget, 1 - Math.exp(-8.5 * dt));
            }
          }

          const wheelSpin = (forwardVel * 7.5 + turnVel * 3.5) * dt;
          if (Math.abs(wheelSpin) > 0.0005) {
            robot.wheels.forEach((w) => { w.rotation.x += wheelSpin; });
            if (robot.intakeAxle) robot.intakeAxle.rotation.x += forwardVel * 9 * dt;
          }

          if (!isLocked) {
            const aimDelta = (inp.aimUp ? 1 : 0) - (inp.aimDown ? 1 : 0);
            if (aimDelta !== 0) {
              const nextAim = THREE.MathUtils.clamp(aimDegRef.current + aimDelta * 45 * dt, 22, 62);
              aimDegRef.current = nextAim;
              setAimDeg(Math.round(nextAim));
            }
          }
          arcLine.visible = respawnRef.current <= 0;
          updateAimArc();

          flywheelBoost = Math.max(0, flywheelBoost - dt * 1.6);
          const fwSpin = isLocked ? 0 : (4 + flywheelBoost * 28) * dt;
          robot.flywheelMeshes.forEach((fw) => { fw.rotation.x += fwSpin; });

          world.targets.forEach((t) => {
            const offset = Math.sin(elapsed * t.speed * (reducedMotion ? 0.35 : 1) + t.phase) * t.amp;
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

          world.mines.forEach((m) => {
            const blink = 0.45 + 0.55 * Math.sin(elapsed * 6.5 + m.phase);
            m.ledMat.color.setRGB(1, 0.15 * blink, 0.08 * blink);
            m.warnRingMat.opacity = 0.12 + 0.25 * blink;
            m.relocateTimer -= dt;
            if (m.relocateTimer <= 0) world.relocateMine(m);
            if (freezeRef.current <= 0 && respawnRef.current <= 0 && Math.hypot(rx - m.x, rz - m.z) < 0.38) {
              freezeRef.current = FREEZE_DURATION; setFreezeLeft(FREEZE_DURATION);
              baseRingMat.color.setHex(0xff5a36);
              world.spawnBurst(m.group.position, 20, 'red');
              world.spawnWave(new THREE.Vector3(m.x, getTerrainHeight(m.x, m.z) + 0.04, m.z), -Math.PI / 2, 0, 0xff5a36);
              playTone('mine');
              showCallout('Mine Hit! Frozen 3s', true);
              setStatusMsg('Hit a buried mine! Robot frozen for 3 seconds.');
              world.relocateMine(m);
            }
          });

          world.pickups.forEach((p) => {
            if (p.active) {
              if (!reducedMotion) {
                p.orb.rotation.y += dt * 2.2;
                p.group.position.y = p.baseY + Math.sin(elapsed * 3.5 + p.spotIdx) * 0.03;
              }
              if (respawnRef.current <= 0 && Math.hypot(rx - p.group.position.x, rz - p.group.position.z) < 0.42) {
                p.active = false; p.respawnTimer = 6.0; p.group.visible = false;
                superShotsRef.current = Math.min(superShotsRef.current + 3, 6);
                setSuperShots(superShotsRef.current);
                world.spawnBurst(p.group.position, 14, 'gold');
                playTone('pickup');
                showCallout('Super Pollen! 3× Spread Shot');
                setStatusMsg('Collected super pollen: 3 spread shots ready.');
              }
            } else {
              p.respawnTimer -= dt;
              if (p.respawnTimer <= 0) {
                const nextSpot = (p.spotIdx + 2) % world.pickupSpots.length;
                const [nx, nz] = world.pickupSpots[nextSpot];
                const ny = getTerrainHeight(nx, nz) + 0.16;
                p.spotIdx = nextSpot; p.baseY = ny;
                p.group.position.set(nx, ny, nz); p.active = true; p.group.visible = true;
              }
            }
          });

          for (let i = activeBalls.length - 1; i >= 0; i--) {
            const b = activeBalls[i];
            if (!b.landed) {
              b.vel.y -= GRAVITY * dt;
              b.mesh.position.addScaledVector(b.vel, dt);
              b.mesh.rotation.x += dt * 7;

              const wb = ARENA_HALF - BALL_RADIUS - 0.06;
              if (Math.abs(b.mesh.position.x) > wb) { b.mesh.position.x = Math.sign(b.mesh.position.x) * wb; b.vel.x *= -0.55; }
              if (Math.abs(b.mesh.position.z) > wb) { b.mesh.position.z = Math.sign(b.mesh.position.z) * wb; b.vel.z *= -0.55; }
              if (world.resolveObstacleCollision(b.mesh.position, BALL_RADIUS, b.mesh.position.y, obsNormal)) {
                const vn = b.vel.dot(obsNormal);
                if (vn < 0) b.vel.addScaledVector(obsNormal, -1.55 * vn);
              }

              if (!b.scored && b.owner === 'me' && modeRef.current === 'pvp' && oppConnectedRef.current && !oppRespawnRef.current) {
                oppHitCenter.set(oppCarrier.position.x, oppCarrier.position.y + 0.24, oppCarrier.position.z);
                if (b.mesh.position.distanceTo(oppHitCenter) <= 0.36) {
                  b.scored = true; b.vel.multiplyScalar(-0.25);
                  const dmg = b.isSuper ? SUPER_HIT_DAMAGE : HIT_DAMAGE;
                  pvp.sendHit({ dmg });
                  hitsLandedRef.current += 1; setHitsLanded(hitsLandedRef.current);
                  world.spawnBurst(oppHitCenter, 14, 'cyan');
                  playTone('hit', 3);
                  showCallout(`Hit Enemy! -${dmg} HP`);
                }
              }

              if (!b.scored && b.owner === 'me' && modeRef.current !== 'pvp') {
                for (let tIdx = 0; tIdx < world.targets.length; tIdx++) {
                  const t = world.targets[tIdx];
                  if (t.cooldown > 0) continue;
                  if (b.mesh.position.distanceTo(t.worldPos) <= t.radius) {
                    b.scored = true; b.vel.multiplyScalar(0.32); b.vel.y = Math.min(b.vel.y, -0.4);
                    t.hitFlash = 1.0; t.cooldown = 0.45;
                    streakRef.current += 1; setStreak(streakRef.current);
                    const mult = streakRef.current >= 4 ? 3 : streakRef.current >= 2 ? 2 : 1;
                    const pts = t.points * mult;
                    scoreRef.current += pts; setScore(scoreRef.current);
                    hitsLandedRef.current += 1; setHitsLanded(hitsLandedRef.current);
                    world.spawnBurst(t.worldPos, t.points === 3 ? 18 : 11, 'gold');
                    world.spawnWave(t.worldPos, 0, t.group.rotation.y, t.points === 3 ? 0xff8a65 : 0xffe47a);
                    playTone('hit', streakRef.current + t.points);
                    showCallout(`+${pts} (${t.points}pt Hoop${mult > 1 ? ` × ${mult} Streak` : ''})`);
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
                  if (vn < 0) b.vel.addScaledVector(slopeNormal, -1.45 * vn);
                  b.vel.multiplyScalar(0.76);
                  b.bounces += 1;
                } else {
                  b.landed = true; b.vel.set(0, 0, 0);
                  if (!b.scored && !b.isSuper && b.owner === 'me' && streakRef.current > 0) { streakRef.current = 0; setStreak(0); }
                }
              }
            } else {
              b.landedTimer += dt;
              b.mesh.scale.setScalar(Math.max(0.01, 1 - b.landedTimer / 0.85));
              if (b.landedTimer >= 0.85) { scene.remove(b.mesh); activeBalls.splice(i, 1); }
            }
          }

          world.updateEffects(dt, GRAVITY);
          controls.update();
          renderer.render(scene, camera);
          rafId = requestAnimationFrame(loop);
        };

        const startLoop = () => { if (!rafId && !disposed && isVisible && !document.hidden) { lastTime = performance.now(); rafId = requestAnimationFrame(loop); } };
        const stopLoop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };

        intersectionObserver = new IntersectionObserver((entries) => {
          isVisible = !!entries[0] && entries[0].isIntersecting;
          if (isVisible) startLoop(); else stopLoop();
        }, { threshold: 0.05 });
        intersectionObserver.observe(container);

        onVisChange = () => { if (document.hidden) stopLoop(); else startLoop(); };
        document.addEventListener('visibilitychange', onVisChange);
        startLoop();
      } catch (err) {
        console.error('[RobotArena] WebGL init failed:', err);
        if (!disposed) setWebglOk(false);
      }
    }

    init();

    return () => {
      disposed = true;
      if (pvp) pvp.leave();
      if (calloutTimerRef.current) clearTimeout(calloutTimerRef.current);
      if (rafId) cancelAnimationFrame(rafId);
      if (intersectionObserver) intersectionObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      if (motionQuery && onMotionChange) motionQuery.removeEventListener('change', onMotionChange);
      if (onVisChange) document.removeEventListener('visibilitychange', onVisChange);
      if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
      if (onKeyUp) window.removeEventListener('keyup', onKeyUp);
      if (canvasRef.current && onCanvasDown) canvasRef.current.removeEventListener('pointerdown', onCanvasDown);
      if (canvasRef.current && onCanvasUp) canvasRef.current.removeEventListener('pointerup', onCanvasUp);
      if (controls) {
        if (onCtrlStart) controls.removeEventListener('start', onCtrlStart);
        if (onCtrlEnd) controls.removeEventListener('end', onCtrlEnd);
        controls.dispose();
      }
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} }
      if (scene) {
        scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
          }
        });
      }
      if (renderer) renderer.dispose();
    };
  }, [modelUrl]);

  const holdDrive = (key) => ({
    onPointerDown: (e) => { e.preventDefault(); hasInteractedRef.current = true; if (controlsRef.current) controlsRef.current.autoRotate = false; inputRef.current[key] = true; },
    onPointerUp: () => { inputRef.current[key] = false; },
    onPointerLeave: () => { inputRef.current[key] = false; },
    onPointerCancel: () => { inputRef.current[key] = false; },
  });

  const nudgeAim = (d) => { const next = Math.min(62, Math.max(22, aimDegRef.current + d)); aimDegRef.current = next; setAimDeg(Math.round(next)); };
  const nudgePower = (d) => { const next = Math.min(100, Math.max(0, powerPct + d)); setPowerPct(next); speedRef.current = MIN_SPEED + (next / 100) * (MAX_SPEED - MIN_SPEED); };

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
  const isDead = respawnLeft > 0;
  const controlsLocked = isFrozen || isDead || mode === 'searching';
  const pvpOutcome = myKos > oppKos ? 'You Win!' : myKos < oppKos ? 'You Lose!' : 'Draw Match!';

  return (
    <div class={`ra-root ${isExpanded ? 'ra-root--expanded' : ''}`} ref={rootRef} role="region" aria-label="Interactive 3D competition robot obstacle course">
      <div class="ra-canvas-wrap">
        <canvas ref={canvasRef} class={`ra-canvas ${isInteracting ? 'ra-canvas--active' : 'ra-canvas--locked'}`} aria-label="3D view of the WilSonic Boom robot" />
      </div>

      <div class="ra-hud-top">
        <div class="ra-hud-group">
          {mode !== 'pvp' && mode !== 'pvp-summary' && <div class="ra-badge" aria-live="polite"><span>Score</span><strong>{score}</strong></div>}
          {mode !== 'pvp' && streak >= 2 && <div class="ra-badge ra-badge--hot"><span>Streak</span><strong>{streak >= 4 ? '3×' : '2×'}</strong></div>}
          {(mode === 'match' || mode === 'pvp') && <div class={`ra-badge ${timeLeft <= 10 ? 'ra-badge--warn' : 'ra-badge--hot'}`}><span>Time</span><strong>{formatClock(timeLeft)}</strong></div>}
          {isFrozen && !isDead && <div class="ra-badge ra-badge--frozen" aria-live="assertive"><span>Frozen</span><strong>{freezeLeft.toFixed(1)}s</strong></div>}
          {isDead && <div class="ra-badge ra-badge--frozen" aria-live="assertive"><span>Respawn</span><strong>{respawnLeft.toFixed(1)}s</strong></div>}
          {mode !== 'pvp' && mode !== 'pvp-summary' && bestScore > 0 && <div class="ra-badge"><span>Best</span><strong>{bestScore}</strong></div>}
        </div>

        <div class="ra-hud-group">
          <button type="button" class={`ra-btn ra-btn--pvp ${mode === 'pvp' || mode === 'searching' ? 'ra-btn--active' : ''}`} aria-label="Find another online player for a 2 minute 1v1 match" onClick={() => { if (mode === 'searching' || mode === 'pvp') cancelPvpFnRef.current(); else startPvpSearchFnRef.current(); }}>
            {mode === 'searching' ? 'Cancel Queue' : mode === 'pvp' ? 'Leave 1v1' : '1v1 Match'}
          </button>
          <button type="button" class={`ra-btn ${mode === 'match' ? 'ra-btn--active' : 'ra-btn--gold'}`} aria-label="Start 30 second solo target challenge" onClick={() => startSoloMatchFnRef.current()}>
            {mode === 'match' ? 'Restart 30s' : '30s Solo'}
          </button>
          <button type="button" class={`ra-btn ${followCam ? 'ra-btn--active' : ''}`} aria-pressed={followCam} aria-label="Toggle chase camera behind robot" onClick={() => setFollowCam((v) => !v)}>Follow</button>
          <button type="button" class={`ra-btn ${soundOn ? 'ra-btn--active' : ''}`} aria-pressed={soundOn} aria-label="Toggle game sound effects" onClick={() => setSoundOn((v) => !v)}>
            {soundOn ? 'Sound On' : 'Sound Off'}
          </button>
          <button type="button" class={`ra-btn ${isInteracting ? 'ra-btn--active' : ''}`} aria-pressed={isInteracting} aria-label={isInteracting ? 'Release 3D view to scroll the page' : 'Interact with 3D robot'} onClick={() => setIsInteracting((v) => !v)}>
            {isInteracting ? 'Done (Esc)' : 'Interact'}
          </button>
          <button type="button" class={`ra-btn ${isExpanded ? 'ra-btn--active' : ''}`} aria-pressed={isExpanded} aria-label={isExpanded ? 'Exit fullscreen' : 'Expand 3D game to fullscreen'} onClick={toggleExpand}>
            {isExpanded ? 'Exit Full' : 'Expand'}
          </button>
          <button type="button" class="ra-btn" aria-label="Reset robot position and score" onClick={() => resetFnRef.current()}>Reset</button>
        </div>
      </div>

      {mode === 'pvp' && (
        <div class="ra-pvp-bars" aria-label="1v1 health and knockout score">
          <div class="ra-hp-box">
            <div class="ra-hp-meta"><span>You (Gold)</span><span>{isDead ? `Respawn ${respawnLeft.toFixed(1)}s` : `${myHp} HP`}</span></div>
            <div class="ra-hp-track"><div class="ra-hp-fill" style={{ width: `${(myHp / MAX_HP) * 100}%` }} /></div>
          </div>
          <div class="ra-pvp-score" aria-live="polite">{myKos} — {oppKos}</div>
          <div class="ra-hp-box ra-hp-box--opp">
            <div class="ra-hp-meta"><span>{oppRespawning ? 'Respawning…' : `${oppHp} HP`}</span><span>Opponent (Blue)</span></div>
            <div class="ra-hp-track"><div class="ra-hp-fill ra-hp-fill--opp" style={{ width: `${(oppHp / MAX_HP) * 100}%` }} /></div>
          </div>
        </div>
      )}

      {callout.text && <div class={`ra-callout ${callout.danger ? 'ra-callout--danger' : ''}`}>{callout.text}</div>}

      {mode === 'searching' && (
        <div class="ra-center-card" role="status" aria-live="polite">
          <p class="ra-center-card__title">Searching for Opponent…</p>
          <p class="ra-center-card__sub">{pvpStatus || 'Waiting for another visitor on the website to click 1v1 Match.'}</p>
          <div class="ra-center-card__actions"><button type="button" class="ra-btn" onClick={() => cancelPvpFnRef.current()}>Cancel</button></div>
        </div>
      )}

      {mode === 'pvp' && isDead && (
        <div class="ra-center-card" role="status" aria-live="assertive">
          <p class="ra-center-card__title">Robot Destroyed</p>
          <p class="ra-center-card__sub">Respawning in <strong>{respawnLeft.toFixed(1)}s</strong>…</p>
        </div>
      )}

      {mode === 'summary' && (
        <div class="ra-center-card" role="dialog" aria-label="Solo match results">
          <p class="ra-center-card__title">Match Complete</p>
          <div class="ra-center-card__stats">
            <div class="ra-stat-item"><span>Score</span><strong>{score}</strong></div>
            <div class="ra-stat-item"><span>Best</span><strong>{Math.max(bestScore, score)}</strong></div>
            <div class="ra-stat-item"><span>Accuracy</span><strong>{accuracy}%</strong></div>
          </div>
          <div class="ra-center-card__actions">
            <button type="button" class="ra-btn ra-btn--gold" onClick={() => startSoloMatchFnRef.current()}>Play Again</button>
            <button type="button" class="ra-btn" onClick={() => resetFnRef.current()}>Free Play</button>
          </div>
        </div>
      )}

      {mode === 'pvp-summary' && (
        <div class="ra-center-card" role="dialog" aria-label="1v1 match results">
          <p class="ra-center-card__title">{pvpOutcome}</p>
          <p class="ra-center-card__sub">{pvpStatus}</p>
          <div class="ra-center-card__stats">
            <div class="ra-stat-item"><span>Your KOs</span><strong>{myKos}</strong></div>
            <div class="ra-stat-item"><span>Enemy KOs</span><strong>{oppKos}</strong></div>
            <div class="ra-stat-item"><span>Hits</span><strong>{hitsLanded}</strong></div>
          </div>
          <div class="ra-center-card__actions">
            <button type="button" class="ra-btn ra-btn--gold" onClick={() => startPvpSearchFnRef.current()}>Find New Match</button>
            <button type="button" class="ra-btn" onClick={() => resetFnRef.current()}>Free Play</button>
          </div>
        </div>
      )}

      {!isInteracting && mode === 'free' && (
        <div class="ra-lock-prompt">
          <button type="button" class="ra-btn ra-btn--gold" aria-label="Click to orbit, zoom, and drive the 3D robot" onClick={() => setIsInteracting(true)}>Interact with 3D Robot</button>
          <p class="ra-lock-hint">1pt / 2pt / 3pt moving hoops · Red mines freeze 3s · Click 1v1 Match to duel online</p>
        </div>
      )}

      <div class="ra-controls">
        <div class="ra-dpad" role="group" aria-label="Drive robot">
          <button type="button" class="ra-btn ra-dpad__btn ra-dpad__up" aria-label="Drive forward" title="Drive forward (W or Up arrow)" disabled={controlsLocked} {...holdDrive('forward')}>▲</button>
          <button type="button" class="ra-btn ra-dpad__btn ra-dpad__left" aria-label="Turn left" title="Turn left (A or Left arrow)" disabled={controlsLocked} {...holdDrive('left')}>◀</button>
          <button type="button" class="ra-btn ra-dpad__btn ra-dpad__down" aria-label="Drive backward" title="Drive backward (S or Down arrow)" disabled={controlsLocked} {...holdDrive('backward')}>▼</button>
          <button type="button" class="ra-btn ra-dpad__btn ra-dpad__right" aria-label="Turn right" title="Turn right (D or Right arrow)" disabled={controlsLocked} {...holdDrive('right')}>▶</button>
        </div>

        <div class="ra-action-stack">
          <div class="ra-stepper" role="group" aria-label="Shooter aim angle">
            <button type="button" class="ra-btn" aria-label="Lower shooter aim angle" title="Aim lower (Q)" disabled={controlsLocked} onClick={() => nudgeAim(-4)}>−</button>
            <span class="ra-stepper__label">Aim {aimDeg}°</span>
            <button type="button" class="ra-btn" aria-label="Raise shooter aim angle" title="Aim higher (E)" disabled={controlsLocked} onClick={() => nudgeAim(4)}>+</button>
          </div>
          <div class="ra-stepper" role="group" aria-label="Shooter launch power">
            <button type="button" class="ra-btn" aria-label="Decrease shot power" disabled={controlsLocked} onClick={() => nudgePower(-15)}>−</button>
            <span class="ra-stepper__label">Power {powerPct}%</span>
            <button type="button" class="ra-btn" aria-label="Increase shot power" disabled={controlsLocked} onClick={() => nudgePower(15)}>+</button>
          </div>
          <button type="button" class={`ra-btn ra-btn--shoot ${superShots > 0 ? 'ra-btn--super' : 'ra-btn--gold'}`} aria-label="Shoot a pollen ball" title="Shoot pollen ball (Space)" disabled={controlsLocked} onClick={() => shootFnRef.current()}>
            {isDead ? `Respawn (${respawnLeft.toFixed(1)}s)` : isFrozen ? `Frozen (${freezeLeft.toFixed(1)}s)` : superShots > 0 ? `3× Shoot (${superShots})` : 'Shoot'}
          </button>
        </div>
      </div>

      <span class="ra-sr-only" aria-live="polite">{statusMsg}</span>
    </div>
  );
}
