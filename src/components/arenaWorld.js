export const ARENA_HALF = 4.6;
export const ROBOT_RADIUS = 0.28;
export const BALL_RADIUS = 0.055;
export const MAX_HP = 100;
export const MINE_COUNT = 5;

export function getTerrainHeight(x, z) {
  const dStart = Math.hypot(x, z - 1.6);
  const spawnMask = Math.min(1, Math.max(0, (dStart - 0.7) / 1.15));
  const hills =
    0.20 * Math.sin(x * 0.78) * Math.cos(z * 0.72) +
    0.12 * Math.sin(x * 1.55 + 1.0) * Math.sin(z * 1.35 - 0.5) +
    0.09 * Math.cos((x + z) * 0.95);
  return Math.max(-0.22, hills * spawnMask);
}

export function getTerrainSlope(THREE, x, z, outNormal) {
  const eps = 0.08;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  outNormal.set(hL - hR, 2 * eps, hD - hU).normalize();
  return outNormal;
}

export function createBillboardHpBar(THREE, fillColorHex) {
  const group = new THREE.Group();
  group.position.set(0, 0.62, 0);
  group.visible = false;

  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.068),
    new THREE.MeshBasicMaterial({ color: 0x0b0b0d, side: THREE.DoubleSide })
  );
  const border = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.084),
    new THREE.MeshBasicMaterial({ color: 0x3b3d44, side: THREE.DoubleSide })
  );
  border.position.z = -0.002;

  const fillMat = new THREE.MeshBasicMaterial({ color: fillColorHex, side: THREE.DoubleSide });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.042), fillMat);
  fill.position.z = 0.002;

  group.add(bg, border, fill);
  return { group, fill, fillMat };
}

export function setBillboardHp(bar, hp) {
  const ratio = Math.max(0.001, Math.min(1, hp / MAX_HP));
  bar.fill.scale.x = ratio;
  bar.fill.position.x = -0.21 * (1 - ratio);
}

export function createArenaWorld(THREE, scene, robotCarrier) {
  // Bumpy terrain mesh + contour wireframe
  const terrainGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2, 64, 64);
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
    tmpCol.copy(lowCol).lerp(highCol, THREE.MathUtils.clamp((vy + 0.22) / 0.52, 0, 1));
    tColors[i * 3] = tmpCol.r;
    tColors[i * 3 + 1] = tmpCol.g;
    tColors[i * 3 + 2] = tmpCol.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
  terrainGeo.computeVertexNormals();

  const terrainMesh = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.1 })
  );
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  const gridGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2, 18, 18);
  gridGeo.rotateX(-Math.PI / 2);
  const gPos = gridGeo.attributes.position;
  for (let i = 0; i < gPos.count; i++) {
    gPos.setY(i, getTerrainHeight(gPos.getX(i), gPos.getZ(i)) + 0.005);
  }
  scene.add(
    new THREE.Mesh(
      gridGeo,
      new THREE.MeshBasicMaterial({ color: 0xc89434, wireframe: true, transparent: true, opacity: 0.16 })
    )
  );

  // Perimeter walls + clear polycarbonate shields
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.55, metalness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9bb3c7, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.12,
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
    const shield = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.22, sz), glassMat);
    shield.position.set(wx, wy + 0.29, wz);
    scene.add(base, shield);
  });

  // Solid obstacles
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
    const totalH = spec.h + embed;

    if (spec.type === 'box') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(spec.w, totalH, spec.d), obsBodyMat);
      body.castShadow = true;
      body.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(spec.w + 0.02, 0.04, spec.d + 0.02), obsTrimMat);
      cap.position.y = totalH / 2 - 0.02;
      cap.castShadow = true;
      group.add(body, cap);
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
    }

    const body = new THREE.Mesh(new THREE.CylinderGeometry(spec.r, spec.r, totalH, 18), obsBodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(spec.r + 0.015, spec.r + 0.015, 0.045, 18), obsTrimMat);
    cap.position.y = totalH / 2 - 0.02;
    cap.castShadow = true;
    group.add(body, cap);
    group.position.set(spec.x, groundY + (spec.h - embed) / 2, spec.z);
    scene.add(group);
    return { ...spec, topY: groundY + spec.h };
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
          let lnx = 0, lnz = 0, newLx = lx, newLz = lz;
          if (distSq > 0.000001) {
            const dist = Math.sqrt(distSq);
            lnx = dlx / dist;
            lnz = dlz / dist;
            newLx = clx + lnx * entityRadius;
            newLz = clz + lnz * entityRadius;
          } else if (o.halfW - Math.abs(lx) < o.halfD - Math.abs(lz)) {
            lnx = lx >= 0 ? 1 : -1;
            newLx = lnx * (o.halfW + entityRadius);
          } else {
            lnz = lz >= 0 ? 1 : -1;
            newLz = lnz * (o.halfD + entityRadius);
          }
          pos.x = o.x + (newLx * o.cos + newLz * o.sin);
          pos.z = o.z + (-newLx * o.sin + newLz * o.cos);
          if (normalOut) normalOut.set(lnx * o.cos + lnz * o.sin, 0, -lnx * o.sin + lnz * o.cos);
          hit = true;
        }
      }
    }
    return hit;
  }

  // 6 moving hoops in 3 speed & point tiers (1pt, 2pt, 3pt)
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
    const hoopY = getTerrainHeight(cfg.x, cfg.z) + cfg.hAbove;
    const group = new THREE.Group();
    group.position.set(cfg.x, hoopY, cfg.z);
    group.rotation.y = cfg.rotY;

    const postLen = cfg.hAbove + 0.48;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, postLen, 10), postMat);
    post.position.y = -postLen / 2;
    post.castShadow = true;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(cfg.radius, 0.028, 12, 28),
      new THREE.MeshStandardMaterial({
        color: cfg.points === 3 ? 0xff5a36 : cfg.points === 2 ? 0xffd147 : 0xc89434,
        emissive: cfg.points === 3 ? 0x451005 : 0x000000,
        roughness: 0.28,
        metalness: 0.82,
      })
    );
    ring.castShadow = true;

    const coreMat = new THREE.MeshStandardMaterial({
      color: cfg.points === 3 ? 0xff8c66 : cfg.points === 2 ? 0xffe485 : 0xefc069,
      emissive: cfg.points === 3 ? 0x9e250b : cfg.points === 2 ? 0x7a5508 : 0x5c3f09,
      emissiveIntensity: cfg.points === 3 ? 0.9 : 0.65,
      roughness: 0.38,
      metalness: 0.2,
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(cfg.radius * 0.72, cfg.radius * 0.72, 0.028, 20), coreMat);
    core.rotation.x = Math.PI / 2;
    group.add(post, ring, core);

    let halo = null;
    if (cfg.points >= 2) {
      halo = new THREE.Mesh(
        new THREE.RingGeometry(cfg.radius + 0.045, cfg.radius + 0.08, 28),
        new THREE.MeshBasicMaterial({
          color: cfg.points === 3 ? 0xff8a65 : 0xffe47a,
          transparent: true,
          opacity: cfg.points === 3 ? 0.9 : 0.55,
          side: THREE.DoubleSide,
        })
      );
      group.add(halo);
    }

    scene.add(group);
    return {
      idx, baseX: cfg.x, baseZ: cfg.z, hAbove: cfg.hAbove, axis: cfg.axis, amp: cfg.amp,
      speed: cfg.speed, points: cfg.points, phase: cfg.phase, group, coreMat, halo,
      hitFlash: 0, cooldown: 0, radius: cfg.radius + BALL_RADIUS * 1.15,
      worldPos: new THREE.Vector3(cfg.x, hoopY, cfg.z),
    };
  });

  // Random buried mines
  function pickSafeRandomSpot(avoidList = []) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const rx = (Math.random() * 2 - 1) * (ARENA_HALF - 0.75);
      const rz = (Math.random() * 2 - 1) * (ARENA_HALF - 0.75);
      if (Math.hypot(rx - robotCarrier.position.x, rz - robotCarrier.position.z) < 1.35) continue;
      const hitsObs = obstacles.some((o) => {
        const obsR = o.type === 'cyl' ? o.r + 0.55 : Math.hypot(o.halfW, o.halfD) + 0.45;
        return Math.hypot(rx - o.x, rz - o.z) < obsR;
      });
      if (hitsObs) continue;
      if (avoidList.some((m) => Math.hypot(rx - m.x, rz - m.z) < 1.25)) continue;
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
    const group = new THREE.Group();
    group.position.set(spot.x, getTerrainHeight(spot.x, spot.z) - 0.005, spot.z);
    const cap = new THREE.Mesh(mineCapGeo, new THREE.MeshStandardMaterial({ color: 0x2a1414, roughness: 0.7, metalness: 0.4 }));
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3b1f });
    const led = new THREE.Mesh(mineLedGeo, ledMat);
    led.position.y = 0.018;
    const warnRingMat = new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const warnRing = new THREE.Mesh(mineRingGeo, warnRingMat);
    warnRing.rotation.x = -Math.PI / 2;
    warnRing.position.y = 0.016;
    group.add(cap, led, warnRing);
    scene.add(group);
    mines.push({ x: spot.x, z: spot.z, group, ledMat, warnRingMat, relocateTimer: 7 + Math.random() * 8, phase: Math.random() * Math.PI * 2 });
  }

  function relocateMine(mine) {
    const spot = pickSafeRandomSpot(mines.filter((m) => m !== mine));
    mine.x = spot.x;
    mine.z = spot.z;
    mine.group.position.set(spot.x, getTerrainHeight(spot.x, spot.z) - 0.005, spot.z);
    mine.relocateTimer = 7 + Math.random() * 8;
  }

  // Super-pollen field pickups
  const pickupSpots = [[-2.35, -1.25], [2.35, -1.15], [0.0, -0.15], [-2.05, 2.05], [2.45, 2.45], [0.0, -2.40]];
  const pickupGeo = new THREE.OctahedronGeometry(0.095, 1);
  const pickupRingGeo = new THREE.RingGeometry(0.12, 0.15, 20);
  const pickups = [0, 1, 2, 3].map((i) => {
    const [px, pz] = pickupSpots[i];
    const py = getTerrainHeight(px, pz) + 0.16;
    const group = new THREE.Group();
    group.position.set(px, py, pz);
    const orb = new THREE.Mesh(
      pickupGeo,
      new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0x996b00, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.35 })
    );
    const ring = new THREE.Mesh(pickupRingGeo, new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide, transparent: true, opacity: 0.65 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.13;
    group.add(orb, ring);
    scene.add(group);
    return { group, orb, baseY: py, active: true, respawnTimer: 0, spotIdx: i };
  });

  // Pooled sparks & shockwaves
  const sparkGeo = new THREE.SphereGeometry(0.02, 6, 6);
  const goldSparkMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  const redSparkMat = new THREE.MeshBasicMaterial({ color: 0xff5a36 });
  const cyanSparkMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const sparks = Array.from({ length: 56 }, () => {
    const m = new THREE.Mesh(sparkGeo, goldSparkMat);
    m.visible = false;
    scene.add(m);
    return { mesh: m, vel: new THREE.Vector3(), life: 0, maxLife: 0.5 };
  });

  function spawnBurst(origin, count = 12, colorKind = 'gold') {
    let spawned = 0;
    const mat = colorKind === 'red' ? redSparkMat : colorKind === 'cyan' ? cyanSparkMat : goldSparkMat;
    for (let i = 0; i < sparks.length && spawned < count; i++) {
      const s = sparks[i];
      if (s.life > 0) continue;
      s.mesh.material = mat;
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
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe47a, transparent: true, opacity: 0, side: THREE.DoubleSide });
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

  function updateEffects(dt, gravity) {
    sparks.forEach((s) => {
      if (s.life <= 0) return;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; return; }
      s.vel.y -= gravity * 0.65 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(Math.max(0.05, s.life / s.maxLife));
    });
    shockwaves.forEach((w) => {
      if (w.life <= 0) return;
      w.life -= dt;
      if (w.life <= 0) { w.mesh.visible = false; w.mat.opacity = 0; return; }
      const p = 1 - w.life / 0.38;
      w.mesh.scale.setScalar(1 + p * 1.5);
      w.mat.opacity = (1 - p) * 0.9;
    });
  }

  return { resolveObstacleCollision, targets, mines, relocateMine, pickups, pickupSpots, spawnBurst, spawnWave, updateEffects };
}
