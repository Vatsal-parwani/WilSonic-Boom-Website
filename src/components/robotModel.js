// Procedural CAD-style FTC robot (mecanum drive + top-mounted flywheel shooter)
// plus GLB loader that auto-scales any CAD export to ~18 inches (0.46 m)
// and filters out stray/exploded CAD vertices.

// ── Tweak these if your CAD .glb is tilted, facing sideways, or has a higher shooter ──
export const CAD_ADJUST = {
  rotateX: 0,     // Try -90 or 90 if the robot is lying on its side (Z-up CAD export)
  rotateY: 0,     // Try 90, -90, or 180 if pressing W drives sideways or backwards
  rotateZ: 0,
  shooterY: 0.30, // Height (meters) where pollen balls launch from
  shooterZ: 0.04, // Forward offset (meters) of the shooter nozzle
};

export const TEAM_COLOURS = {
  graphite: 0x1a1c20,
  darkMetal: 0x101114,
  aluminium: 0x9aa0a6,
  gold: 0xc89434,
  goldBright: 0xefc069,
  rubber: 0x18181b,
  intakeGreen: 0x4b9e56,
  pollenYellow: 0xf4c430,
};

function makeMecanumWheel(THREE, radius = 0.052, width = 0.042, rollerAngleSign = 1) {
  const wheelGroup = new THREE.Group();

  const rubberMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOURS.rubber,
    roughness: 0.85,
    metalness: 0.1,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOURS.gold,
    roughness: 0.35,
    metalness: 0.78,
  });

  const hubMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOURS.aluminium,
    roughness: 0.4,
    metalness: 0.8,
  });

  const coreGeo = new THREE.CylinderGeometry(radius * 0.78, radius * 0.78, width, 18);
  coreGeo.rotateZ(Math.PI / 2);
  const core = new THREE.Mesh(coreGeo, rubberMat);
  core.castShadow = true;
  wheelGroup.add(core);

  const plateGeo = new THREE.CylinderGeometry(radius * 0.84, radius * 0.84, 0.005, 18);
  plateGeo.rotateZ(Math.PI / 2);
  const leftPlate = new THREE.Mesh(plateGeo, rimMat);
  leftPlate.position.x = -width * 0.48;
  const rightPlate = new THREE.Mesh(plateGeo, rimMat);
  rightPlate.position.x = width * 0.48;
  wheelGroup.add(leftPlate, rightPlate);

  const hubGeo = new THREE.CylinderGeometry(0.014, 0.014, width + 0.012, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, hubMat);
  wheelGroup.add(hub);

  const rollerGeo = new THREE.CylinderGeometry(0.011, 0.011, width * 0.78, 8);
  const rollerCount = 10;
  for (let i = 0; i < rollerCount; i++) {
    const theta = (i / rollerCount) * Math.PI * 2;
    const roller = new THREE.Mesh(rollerGeo, rubberMat);
    const r = radius * 0.86;
    roller.position.set(0, Math.cos(theta) * r, Math.sin(theta) * r);
    roller.rotation.x = theta;
    roller.rotation.z = rollerAngleSign * (Math.PI / 4);
    wheelGroup.add(roller);
  }

  return wheelGroup;
}

export function createCadRobot(THREE) {
  const root = new THREE.Group();

  const aluMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOURS.aluminium,
    roughness: 0.42,
    metalness: 0.76,
  });

  const graphiteMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOURS.graphite,
    roughness: 0.58,
    metalness: 0.45,
  });

  const goldMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOURS.gold,
    roughness: 0.34,
    metalness: 0.82,
  });

  const goldBrightMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOURS.goldBright,
    roughness: 0.25,
    metalness: 0.85,
  });

  const intakeMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOURS.intakeGreen,
    roughness: 0.65,
    metalness: 0.15,
  });

  const bellyPan = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.016, 0.40), graphiteMat);
  bellyPan.position.set(0, 0.055, 0);
  bellyPan.castShadow = true;
  bellyPan.receiveShadow = true;
  root.add(bellyPan);

  const railGeo = new THREE.BoxGeometry(0.036, 0.056, 0.43);
  const leftRail = new THREE.Mesh(railGeo, aluMat);
  leftRail.position.set(-0.165, 0.075, 0);
  leftRail.castShadow = true;
  const rightRail = new THREE.Mesh(railGeo, aluMat);
  rightRail.position.set(0.165, 0.075, 0);
  rightRail.castShadow = true;
  root.add(leftRail, rightRail);

  const sidePlateGeo = new THREE.BoxGeometry(0.008, 0.075, 0.30);
  const leftSidePlate = new THREE.Mesh(sidePlateGeo, goldMat);
  leftSidePlate.position.set(-0.188, 0.088, 0);
  const rightSidePlate = new THREE.Mesh(sidePlateGeo, goldMat);
  rightSidePlate.position.set(0.188, 0.088, 0);
  root.add(leftSidePlate, rightSidePlate);

  const rearBar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.048, 0.04), aluMat);
  rearBar.position.set(0, 0.08, -0.19);
  rearBar.castShadow = true;
  root.add(rearBar);

  const controlHub = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.032, 0.11), graphiteMat);
  controlHub.position.set(-0.07, 0.082, -0.10);
  root.add(controlHub);

  const battery = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.045, 0.075), goldMat);
  battery.position.set(0.08, 0.088, -0.11);
  root.add(battery);

  const wheelCoords = [
    { x: -0.215, y: 0.052, z: 0.145, sign: 1 },
    { x: 0.215, y: 0.052, z: 0.145, sign: -1 },
    { x: -0.215, y: 0.052, z: -0.145, sign: -1 },
    { x: 0.215, y: 0.052, z: -0.145, sign: 1 },
  ];

  const wheels = wheelCoords.map((cfg) => {
    const w = makeMecanumWheel(THREE, 0.052, 0.042, cfg.sign);
    w.position.set(cfg.x, cfg.y, cfg.z);
    root.add(w);
    return w;
  });

  const intakeAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.30, 10), aluMat);
  intakeAxle.rotation.z = Math.PI / 2;
  intakeAxle.position.set(0, 0.072, 0.235);
  root.add(intakeAxle);

  for (let i = -2; i <= 2; i++) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.022, 12), intakeMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(i * 0.058, 0.072, 0.235);
    root.add(wheel);
  }

  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, 0.25), graphiteMat);
  ramp.position.set(0, 0.145, 0.09);
  ramp.rotation.x = -0.52;
  root.add(ramp);

  const towerGeo = new THREE.BoxGeometry(0.028, 0.22, 0.048);
  const leftTower = new THREE.Mesh(towerGeo, aluMat);
  leftTower.position.set(-0.105, 0.19, -0.02);
  leftTower.castShadow = true;
  const rightTower = new THREE.Mesh(towerGeo, aluMat);
  rightTower.position.set(0.105, 0.19, -0.02);
  rightTower.castShadow = true;
  root.add(leftTower, rightTower);

  const topBrace = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.024, 0.036), goldMat);
  topBrace.position.set(0, 0.15, -0.06);
  root.add(topBrace);

  const shooterPivot = new THREE.Group();
  shooterPivot.position.set(0, 0.295, -0.01);
  root.add(shooterPivot);

  const cheekGeo = new THREE.BoxGeometry(0.012, 0.088, 0.22);
  const leftCheek = new THREE.Mesh(cheekGeo, graphiteMat);
  leftCheek.position.set(-0.082, 0.02, 0.06);
  leftCheek.castShadow = true;
  const rightCheek = new THREE.Mesh(cheekGeo, graphiteMat);
  rightCheek.position.set(0.082, 0.02, 0.06);
  rightCheek.castShadow = true;
  shooterPivot.add(leftCheek, rightCheek);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.176, 0.014, 0.21), goldMat);
  hood.position.set(0, 0.066, 0.06);
  hood.castShadow = true;
  shooterPivot.add(hood);

  const chute = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.010, 0.22), aluMat);
  chute.position.set(0, -0.026, 0.055);
  shooterPivot.add(chute);

  const flywheelMeshes = [];
  const flywheelGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.032, 20);
  [-0.036, 0.036].forEach((xOffset) => {
    const fw = new THREE.Mesh(flywheelGeo, goldBrightMat);
    fw.rotation.z = Math.PI / 2;
    fw.position.set(xOffset, 0.028, 0.115);
    shooterPivot.add(fw);
    flywheelMeshes.push(fw);
  });

  const chamberBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.044, 14, 12),
    new THREE.MeshStandardMaterial({
      color: TEAM_COLOURS.pollenYellow,
      roughness: 0.72,
      metalness: 0.05,
    })
  );
  chamberBall.position.set(0, 0.02, 0.015);
  shooterPivot.add(chamberBall);

  const muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.position.set(0, 0.022, 0.18);
  shooterPivot.add(muzzleAnchor);

  return {
    root,
    wheels,
    intakeAxle,
    shooterPivot,
    flywheelMeshes,
    muzzleAnchor,
  };
}

// Filters out stray/exploded CAD vertices (like 89,936,168 m outliers) and returns a clean Box3
function sanitizeModelAndComputeBounds(THREE, model) {
  const xs = [];
  const ys = [];
  const zs = [];
  const v = new THREE.Vector3();

  model.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pos = obj.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 120));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
        xs.push(v.x);
        ys.push(v.y);
        zs.push(v.z);
      }
    }
  });

  if (xs.length === 0) {
    return new THREE.Box3().setFromObject(model);
  }

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);

  const mid = Math.floor(xs.length * 0.5);
  const p10 = Math.floor(xs.length * 0.1);
  const p90 = Math.floor(xs.length * 0.9);

  const med = new THREE.Vector3(xs[mid], ys[mid], zs[mid]);
  const span = Math.max(xs[p90] - xs[p10], ys[p90] - ys[p10], zs[p90] - zs[p10], 0.05);
  const limit = span * 4.5;

  const cleanBox = new THREE.Box3();
  const invMat = new THREE.Matrix4();
  const localFallback = new THREE.Vector3();

  model.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pos = obj.geometry.attributes.position;
    invMat.copy(obj.matrixWorld).invert();
    localFallback.copy(med).applyMatrix4(invMat);

    let lastValidLocal = localFallback.clone();
    let validCount = 0;
    let fixedAny = false;

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      const ok =
        Number.isFinite(v.x) &&
        Number.isFinite(v.y) &&
        Number.isFinite(v.z) &&
        Math.abs(v.x - med.x) <= limit &&
        Math.abs(v.y - med.y) <= limit &&
        Math.abs(v.z - med.z) <= limit;

      if (ok) {
        cleanBox.expandByPoint(v);
        lastValidLocal.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        validCount++;
      } else {
        // Collapse stray vertex onto a nearby valid vertex so it draws no giant streak
        pos.setXYZ(i, lastValidLocal.x, lastValidLocal.y, lastValidLocal.z);
        fixedAny = true;
      }
    }

    if (validCount === 0) {
      obj.visible = false;
    } else if (fixedAny) {
      pos.needsUpdate = true;
      obj.geometry.computeBoundingBox();
      obj.geometry.computeBoundingSphere();
    }
  });

  return cleanBox.isEmpty() ? new THREE.Box3().setFromObject(model) : cleanBox;
}

// Loads a custom .glb if `modelUrl` is set, auto-scaling it to ~0.46 m and resting it on y = 0.
// Falls back cleanly to `createCadRobot(THREE)` if `modelUrl` is null or fails to load.
export async function loadRobotModel(THREE, modelUrl) {
  if (!modelUrl) {
    return createCadRobot(THREE);
  }

  let dracoLoader = null;
  try {
    const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
    ]);

    const loader = new GLTFLoader();
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);

    const gltf = await loader.loadAsync(modelUrl);
    const model = gltf.scene;

    model.rotation.set(
      THREE.MathUtils.degToRad(CAD_ADJUST.rotateX),
      THREE.MathUtils.degToRad(CAD_ADJUST.rotateY),
      THREE.MathUtils.degToRad(CAD_ADJUST.rotateZ)
    );
    model.updateMatrixWorld(true);

    const cleanBox = sanitizeModelAndComputeBounds(THREE, model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    cleanBox.getSize(size);
    cleanBox.getCenter(center);

    const maxHoriz = Math.max(size.x, size.z, 0.001);
    const scale = 0.46 / maxHoriz;
    model.scale.setScalar(scale);
    model.position.set(
      -center.x * scale,
      -cleanBox.min.y * scale,
      -center.z * scale
    );

    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    const root = new THREE.Group();
    root.add(model);

    const shooterPivot = new THREE.Group();
    shooterPivot.position.set(0, CAD_ADJUST.shooterY, CAD_ADJUST.shooterZ);
    root.add(shooterPivot);

    const muzzleAnchor = new THREE.Object3D();
    muzzleAnchor.position.set(0, 0.02, 0.18);
    shooterPivot.add(muzzleAnchor);

    return {
      root,
      wheels: [],
      intakeAxle: null,
      shooterPivot,
      flywheelMeshes: [],
      muzzleAnchor,
    };
  } catch (err) {
    console.warn('[RobotArena] Could not load GLB, using procedural CAD robot:', err);
    return createCadRobot(THREE);
  } finally {
    if (dracoLoader) dracoLoader.dispose();
  }
}
