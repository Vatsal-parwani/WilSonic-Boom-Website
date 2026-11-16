/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import './robot-arena.css';

// ── Customisable physics & gameplay constants ──
const GRAVITY = 9.81;        // m/s^2 downward acceleration
const SHOT_SPEED = 5.6;      // m/s launch speed from top flywheel
const MAX_AIR_BALLS = 6;     // max pollen balls airborne at once
const BALL_RADIUS = 0.052;   // ~4 inch BioBuzz pollen ball
const ARENA_HALF = 2.15;     // half-width of arena floor (meters)
const DRIVE_SPEED = 1.45;    // m/s forward/reverse
const TURN_SPEED = 2.4;      // rad/s left/right turn
const DEFAULT_AIM_DEG = 42;  // starting shooter elevation angle

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
  const [score, setScore] = useState(0);
  const [aimDeg, setAimDeg] = useState(DEFAULT_AIM_DEG);
  const [statusMsg, setStatusMsg] = useState('Robot ready. Click Interact to orbit or drive.');

  // Mutable refs shared with the Three.js animation loop without re-creating the scene
  const interactingRef = useRef(false);
  const hasInteractedRef = useRef(false);
  const aimDegRef = useRef(DEFAULT_AIM_DEG);
  const controlsRef = useRef(null);
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

  // Exit interact mode cleanly if user presses Escape or clicks outside the arena
  useEffect(() => {
    if (!isInteracting) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsInteracting(false);
      }
    };

    const onDocPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setIsInteracting(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onDocPointerDown);
    };
  }, [isInteracting]);

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
        scene.fog = new THREE.Fog(0x101012, 6.5, 13);

        const width = Math.max(container.clientWidth, 320);
        const height = Math.max(container.clientHeight, 320);
        const camera = new THREE.PerspectiveCamera(44, width / height, 0.08, 30);
        camera.position.set(1.65, 1.35, 2.35);

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
        renderer.toneMappingExposure = 1.15;

        // ── OrbitControls (scroll/pinch locked until Interact clicked) ──
        controls = new OrbitControls(camera, canvas);
        controls.target.set(0, 0.28, -0.15);
        controls.enableDamping = true;
        controls.dampingFactor = 0.07;
        controls.enablePan = false;
        controls.enableZoom = false;
        controls.enableRotate = false;
        controls.minDistance = 1.1;
        controls.maxDistance = 5.4;
        controls.minPolarAngle = 0.22;
        controls.maxPolarAngle = Math.PI / 2 - 0.06;

        motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        controls.autoRotate = !motionQuery.matches;
        controls.autoRotateSpeed = 0.7;
        controlsRef.current = controls;

        onMotionChange = (e) => {
          controls.autoRotate = !e.matches && !hasInteractedRef.current;
        };
        motionQuery.addEventListener('change', onMotionChange);

        // ── Lighting ──
        const hemiLight = new THREE.HemisphereLight(0xf3efe6, 0x1b1c20, 0.95);
        scene.add(hemiLight);

        const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.1);
        keyLight.position.set(2.5, 4.2, 2.6);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 12;
        keyLight.shadow.camera.left = -2.8;
        keyLight.shadow.camera.right = 2.8;
        keyLight.shadow.camera.top = 2.8;
        keyLight.shadow.camera.bottom = -2.8;
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0xefc069, 0.85);
        rimLight.position.set(-2.5, 2.0, -2.5);
        scene.add(rimLight);

        // ── Arena Floor & Perimeter ──
        const floorGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2);
        const floorMat = new THREE.MeshStandardMaterial({
          color: 0x17181a,
          roughness: 0.88,
          metalness: 0.12,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const grid = new THREE.GridHelper(ARENA_HALF * 2, 12, 0xc89434, 0x2a2c30);
        grid.position.y = 0.002;
        scene.add(grid);

        // Low perimeter guardrails
        const wallMat = new THREE.MeshStandardMaterial({
          color: 0x24262a,
          roughness: 0.6,
          metalness: 0.4,
        });
        const wallHeight = 0.10;
        const wallThick = 0.05;
        const wallLen = ARENA_HALF * 2 + wallThick;
        [
          [0, wallHeight / 2, -ARENA_HALF, wallLen, wallHeight, wallThick],
          [0, wallHeight / 2, ARENA_HALF, wallLen, wallHeight, wallThick],
          [-ARENA_HALF, wallHeight / 2, 0, wallThick, wallHeight, wallLen],
          [ARENA_HALF, wallHeight / 2, 0, wallThick, wallHeight, wallLen],
        ].forEach(([wx, wy, wz, sx, sy, sz]) => {
          const w = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
          w.position.set(wx, wy, wz);
          w.receiveShadow = true;
          scene.add(w);
        });

        // ── Load Robot (GLB if configured, else CAD stand-in) ──
        const robot = await loadRobotModel(THREE, modelUrl);
        if (disposed) return;

        let robotHeading = Math.PI; // Start facing -Z toward the targets
        robot.root.position.set(0, 0, 1.05);
        robot.root.rotation.y = robotHeading;
        scene.add(robot.root);

        // ── BioBuzz Pollen Targets ──
        const targetConfigs = [
          { x: -1.35, y: 0.55, z: -1.45, radius: 0.22 },
          { x: -0.45, y: 0.92, z: -1.65, radius: 0.21 },
          { x: 0.52, y: 0.78, z: -1.55, radius: 0.21 },
          { x: 1.35, y: 0.50, z: -1.35, radius: 0.22 },
        ];

        const postMat = new THREE.MeshStandardMaterial({
          color: 0x6f7378,
          roughness: 0.45,
          metalness: 0.75,
        });

        const targets = targetConfigs.map((cfg) => {
          const group = new THREE.Group();
          group.position.set(cfg.x, cfg.y, cfg.z);

          // Support post down to floor
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.022, 0.028, cfg.y, 10),
            postMat
          );
          post.position.y = -cfg.y / 2;
          post.castShadow = true;
          group.add(post);

          // Outer gold ring
          const ringMat = new THREE.MeshStandardMaterial({
            color: 0xc89434,
            roughness: 0.3,
            metalness: 0.85,
          });
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(cfg.radius, 0.024, 12, 28),
            ringMat
          );
          ring.castShadow = true;
          group.add(ring);

          // Glowing pollen core pad
          const coreMat = new THREE.MeshStandardMaterial({
            color: 0xefc069,
            emissive: 0x5c3f09,
            emissiveIntensity: 0.65,
            roughness: 0.4,
            metalness: 0.2,
          });
          const core = new THREE.Mesh(
            new THREE.CylinderGeometry(cfg.radius * 0.72, cfg.radius * 0.72, 0.025, 20),
            coreMat
          );
          core.rotation.x = Math.PI / 2;
          group.add(core);

          scene.add(group);
          return {
            group,
            coreMat,
            hitFlash: 0,
            cooldown: 0,
            radius: cfg.radius + BALL_RADIUS * 0.8,
            worldPos: new THREE.Vector3(cfg.x, cfg.y, cfg.z),
          };
        });

        // ── Aim Trajectory Preview Arc ──
        const ARC_STEPS = 22;
        const arcPositions = new Float32Array(ARC_STEPS * 3);
        const arcGeo = new THREE.BufferGeometry();
        arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
        const arcMat = new THREE.LineDashedMaterial({
          color: 0xefc069,
          dashSize: 0.06,
          gapSize: 0.05,
          transparent: true,
          opacity: 0.55,
        });
        const arcLine = new THREE.Line(arcGeo, arcMat);
        scene.add(arcLine);

        // ── Shared Pollen Ball Geometry & Material ──
        const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 16, 14);
        const ballMat = new THREE.MeshStandardMaterial({
          color: 0xf4c430,
          emissive: 0x594106,
          emissiveIntensity: 0.35,
          roughness: 0.72,
          metalness: 0.06,
        });

        const activeBalls = [];
        let flywheelBoost = 0;

        function computeLaunchState(outPos, outVel) {
          const aimRad = THREE.MathUtils.degToRad(aimDegRef.current);
          robot.shooterPivot.rotation.x = -aimRad;
          robot.root.updateMatrixWorld(true);
          robot.muzzleAnchor.getWorldPosition(outPos);

          const horiz = Math.cos(aimRad) * SHOT_SPEED;
          const vert = Math.sin(aimRad) * SHOT_SPEED;
          outVel.set(
            Math.sin(robotHeading) * horiz,
            vert,
            Math.cos(robotHeading) * horiz
          );
        }

        function updateAimArc() {
          const startPos = new THREE.Vector3();
          const startVel = new THREE.Vector3();
          computeLaunchState(startPos, startVel);

          const attr = arcGeo.getAttribute('position');
          for (let i = 0; i < ARC_STEPS; i++) {
            const t = i * 0.04;
            const px = startPos.x + startVel.x * t;
            const py = Math.max(0.015, startPos.y + startVel.y * t - 0.5 * GRAVITY * t * t);
            const pz = startPos.z + startVel.z * t;
            attr.setXYZ(i, px, py, pz);
          }
          attr.needsUpdate = true;
          arcLine.computeLineDistances();
        }

        function firePollenBall() {
          hasInteractedRef.current = true;
          controls.autoRotate = false;

          // Keep airborne count within MAX_AIR_BALLS by removing oldest airborne ball
          const airborne = activeBalls.filter((b) => !b.landed);
          if (airborne.length >= MAX_AIR_BALLS) {
            const oldest = airborne[0];
            scene.remove(oldest.mesh);
            const idx = activeBalls.indexOf(oldest);
            if (idx !== -1) activeBalls.splice(idx, 1);
          }

          const spawnPos = new THREE.Vector3();
          const launchVel = new THREE.Vector3();
          computeLaunchState(spawnPos, launchVel);

          const mesh = new THREE.Mesh(ballGeo, ballMat);
          mesh.position.copy(spawnPos);
          mesh.castShadow = true;
          scene.add(mesh);

          activeBalls.push({
            mesh,
            vel: launchVel,
            landed: false,
            landedTimer: 0,
            scored: false,
          });

          flywheelBoost = 1.0;
          setStatusMsg('Pollen ball launched.');
        }

        function resetArena() {
          robotHeading = Math.PI;
          robot.root.position.set(0, 0, 1.05);
          robot.root.rotation.y = robotHeading;
          aimDegRef.current = DEFAULT_AIM_DEG;
          setAimDeg(DEFAULT_AIM_DEG);

          while (activeBalls.length > 0) {
            const b = activeBalls.pop();
            scene.remove(b.mesh);
          }

          targets.forEach((t) => {
            t.hitFlash = 0;
            t.cooldown = 0;
            t.coreMat.emissiveIntensity = 0.65;
            t.group.scale.setScalar(1);
          });

          camera.position.set(1.65, 1.35, 2.35);
          controls.target.set(0, 0.28, -0.15);
          controls.update();

          setScore(0);
          setStatusMsg('Arena reset.');
          updateAimArc();
        }

        shootFnRef.current = firePollenBall;
        resetFnRef.current = resetArena;
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
            // Avoid double-firing if focus is already on a button
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

        // Tap (without dragging) on canvas shoots when in Interact mode
        let downX = 0;
        let downY = 0;
        onCanvasPointerDown = (e) => {
          downX = e.clientX;
          downY = e.clientY;
        };
        onCanvasPointerUp = (e) => {
          if (!interactingRef.current) return;
          const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
          if (dist < 6) {
            firePollenBall();
          }
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        canvas.addEventListener('pointerdown', onCanvasPointerDown);
        canvas.addEventListener('pointerup', onCanvasPointerUp);

        // ── Responsive Resize ──
        resizeObserver = new ResizeObserver(() => {
          if (!container || !renderer) return;
          const w = Math.max(container.clientWidth, 300);
          const h = Math.max(container.clientHeight, 300);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        });
        resizeObserver.observe(container);

        // ── Pause Rendering When Off-Screen or Hidden Tab ──
        let isVisible = true;
        let lastTime = performance.now();

        const loop = (now) => {
          if (disposed || !isVisible || document.hidden) {
            rafId = 0;
            return;
          }

          const dt = Math.min((now - lastTime) / 1000, 0.05);
          lastTime = now;

          // 1. Robot driving (WASD / Arrows / D-pad)
          const inp = inputRef.current;
          const turn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
          const move = (inp.forward ? 1 : 0) - (inp.backward ? 1 : 0);

          if (turn !== 0) {
            robotHeading += turn * TURN_SPEED * dt;
            robot.root.rotation.y = robotHeading;
          }

          if (move !== 0) {
            const nextX = robot.root.position.x + Math.sin(robotHeading) * move * DRIVE_SPEED * dt;
            const nextZ = robot.root.position.z + Math.cos(robotHeading) * move * DRIVE_SPEED * dt;
            const bound = ARENA_HALF - 0.30;
            robot.root.position.x = THREE.MathUtils.clamp(nextX, -bound, bound);
            robot.root.position.z = THREE.MathUtils.clamp(nextZ, -bound, bound);
          }

          // Spin mecanum wheels & intake visually when driving
          const wheelSpin = (move * 12 + turn * 6) * dt;
          if (wheelSpin !== 0) {
            robot.wheels.forEach((w) => {
              w.rotation.x += wheelSpin;
            });
            if (robot.intakeAxle) {
              robot.intakeAxle.rotation.x += move * 14 * dt;
            }
          }

          // 2. Aiming
          const aimDelta = (inp.aimUp ? 1 : 0) - (inp.aimDown ? 1 : 0);
          if (aimDelta !== 0) {
            const nextAim = THREE.MathUtils.clamp(aimDegRef.current + aimDelta * 45 * dt, 22, 62);
            aimDegRef.current = nextAim;
            setAimDeg(Math.round(nextAim));
          }

          updateAimArc();

          // Spin flywheels faster after firing
          flywheelBoost = Math.max(0, flywheelBoost - dt * 1.6);
          const fwSpin = (4 + flywheelBoost * 28) * dt;
          robot.flywheelMeshes.forEach((fw) => {
            fw.rotation.x += fwSpin;
          });

          // 3. Pollen Ball Projectile Physics & Target Collisions
          for (let i = activeBalls.length - 1; i >= 0; i--) {
            const b = activeBalls[i];

            if (!b.landed) {
              b.vel.y -= GRAVITY * dt;
              b.mesh.position.addScaledVector(b.vel, dt);

              // Bounce cleanly off arena walls
              const wallBound = ARENA_HALF - BALL_RADIUS - 0.04;
              if (Math.abs(b.mesh.position.x) > wallBound) {
                b.mesh.position.x = Math.sign(b.mesh.position.x) * wallBound;
                b.vel.x *= -0.5;
              }
              if (Math.abs(b.mesh.position.z) > wallBound) {
                b.mesh.position.z = Math.sign(b.mesh.position.z) * wallBound;
                b.vel.z *= -0.5;
              }

              // Check target hits
              if (!b.scored) {
                for (let tIdx = 0; tIdx < targets.length; tIdx++) {
                  const t = targets[tIdx];
                  if (t.cooldown > 0) continue;
                  const dist = b.mesh.position.distanceTo(t.worldPos);
                  if (dist <= t.radius) {
                    b.scored = true;
                    b.vel.multiplyScalar(0.35);
                    b.vel.y = Math.min(b.vel.y, -0.3);
                    t.hitFlash = 1.0;
                    t.cooldown = 0.65;
                    setScore((prev) => prev + 1);
                    setStatusMsg('Target hit!');
                    break;
                  }
                }
              }

              // Floor landing
              if (b.mesh.position.y <= BALL_RADIUS) {
                b.mesh.position.y = BALL_RADIUS;
                b.landed = true;
                b.vel.set(0, 0, 0);
              }
            } else {
              b.landedTimer += dt;
              const fade = Math.max(0.01, 1 - b.landedTimer / 0.9);
              b.mesh.scale.setScalar(fade);
              if (b.landedTimer >= 0.9) {
                scene.remove(b.mesh);
                activeBalls.splice(i, 1);
              }
            }
          }

          // 4. Target Hit Animations
          targets.forEach((t) => {
            if (t.cooldown > 0) t.cooldown = Math.max(0, t.cooldown - dt);
            if (t.hitFlash > 0) {
              t.hitFlash = Math.max(0, t.hitFlash - dt * 2.5);
              t.coreMat.emissiveIntensity = 0.65 + t.hitFlash * 2.4;
              t.group.scale.setScalar(1 + t.hitFlash * 0.14);
            }
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
      if (controls) controls.dispose();

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
    onPointerUp: () => {
      inputRef.current[key] = false;
    },
    onPointerLeave: () => {
      inputRef.current[key] = false;
    },
    onPointerCancel: () => {
      inputRef.current[key] = false;
    },
  });

  const nudgeAim = (delta) => {
    const next = Math.min(62, Math.max(22, aimDegRef.current + delta));
    aimDegRef.current = next;
    setAimDeg(Math.round(next));
  };

  if (!webglOk) {
    return (
      <div class="ra-fallback">
        <img src={fallbackSrc} alt={fallbackAlt} decoding="async" />
        <p class="ra-fallback__note">Interactive 3D view unavailable on this browser. Showing robot photo.</p>
      </div>
    );
  }

  return (
    <div
      class="ra-root"
      ref={rootRef}
      role="region"
      aria-label="Interactive 3D competition robot arena"
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
        </div>

        <div class="ra-hud-group">
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
            class="ra-btn"
            aria-label="Reset robot position and score"
            onClick={() => resetFnRef.current()}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Scroll-safe prompt shown until Interact is clicked */}
      {!isInteracting && (
        <div class="ra-lock-prompt">
          <button
            type="button"
            class="ra-btn ra-btn--gold"
            aria-label="Click to orbit, zoom, and drive the 3D robot"
            onClick={() => setIsInteracting(true)}
          >
            Interact with 3D Robot
          </button>
          <p class="ra-lock-hint">Drag to look around · WASD or Arrows to drive · Space to shoot</p>
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
            {...holdDrive('forward')}
          >
            ▲
          </button>
          <button
            type="button"
            class="ra-btn ra-dpad__btn ra-dpad__left"
            aria-label="Turn left"
            title="Turn left (A or Left arrow)"
            {...holdDrive('left')}
          >
            ◀
          </button>
          <button
            type="button"
            class="ra-btn ra-dpad__btn ra-dpad__down"
            aria-label="Drive backward"
            title="Drive backward (S or Down arrow)"
            {...holdDrive('backward')}
          >
            ▼
          </button>
          <button
            type="button"
            class="ra-btn ra-dpad__btn ra-dpad__right"
            aria-label="Turn right"
            title="Turn right (D or Right arrow)"
            {...holdDrive('right')}
          >
            ▶
          </button>
        </div>

        <div class="ra-action-stack">
          <div class="ra-aim-box" role="group" aria-label="Shooter aim angle">
            <button
              type="button"
              class="ra-btn"
              aria-label="Lower shooter aim angle"
              title="Aim lower (Q)"
              onClick={() => nudgeAim(-4)}
            >
              −
            </button>
            <span class="ra-aim-label">Aim {aimDeg}°</span>
            <button
              type="button"
              class="ra-btn"
              aria-label="Raise shooter aim angle"
              title="Aim higher (E)"
              onClick={() => nudgeAim(4)}
            >
              +
            </button>
          </div>

          <button
            type="button"
            class="ra-btn ra-btn--gold ra-btn--shoot"
            aria-label="Shoot a pollen ball"
            title="Shoot pollen ball (Space)"
            onClick={() => shootFnRef.current()}
          >
            Shoot
          </button>
        </div>
      </div>

      <span class="ra-sr-only" aria-live="polite">{statusMsg}</span>
    </div>
  );
}