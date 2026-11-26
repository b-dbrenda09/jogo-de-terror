import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ghostSmokeTexture } from '../world/Textures.js';
import { BOUNDS } from '../world/House.js';

const CHASE_SPEED = 3.3;
const STALK_SPEED = 1.25;
const CATCH_DIST = 0.75;
const BURN_TIME_STALK = 1.6;   // seconds of beam to banish a stalker
const BURN_TIME_CHASE = 2.4;   // he is stronger once fully awake
const BANISH_DOWNTIME = 8;     // chase: seconds before he reforms

// Rounded, asymmetric sections describe continuous surfaces for the skin and shroud.
function organicSurface(profile, sides, detail, tint, deform = null) {
  const centers = new THREE.CatmullRomCurve3(profile.map(([y, x, z]) => new THREE.Vector3(x, y, z)), false, 'catmullrom');
  const radii = new THREE.CatmullRomCurve3(profile.map(([, , , x, z]) => new THREE.Vector3(x, z, 0)), false, 'catmullrom');
  const rings = (profile.length - 1) * detail + 1;
  const positions = [], colors = [], indices = [];
  const center = new THREE.Vector3(), radius = new THREE.Vector3(), point = new THREE.Vector3();
  const color = new THREE.Color(tint);
  const reverse = profile[0][0] > profile.at(-1)[0];
  const face = (a, b, c) => indices.push(a, reverse ? c : b, reverse ? b : c);
  for (let ring = 0; ring < rings; ring++) {
    const progress = ring / (rings - 1);
    centers.getPoint(progress, center);
    radii.getPoint(progress, radius);
    for (let side = 0; side < sides; side++) {
      const angle = side * Math.PI * 2 / sides;
      const ridge = Math.sin(5 * angle + progress * 4) * 0.095 + Math.cos(3 * angle - progress * 7) * 0.06;
      point.set(
        center.x + Math.cos(angle) * Math.max(0.002, radius.x) * (1 + ridge),
        center.y,
        center.z + Math.sin(angle) * Math.max(0.002, radius.y) * (1 + ridge));
      const shade = deform ? deform(point, angle, progress) : 1;
      positions.push(point.x, point.y, point.z);
      const grain = shade * (0.88 + 1.7 * ridge + 0.08 * Math.sin(9 * angle + progress * 13));
      colors.push(color.r * grain, color.g * grain, color.b * grain);
      if (ring === rings - 1) continue;
      const a = ring * sides + side;
      const b = ring * sides + (side + 1) % sides;
      face(a, a + sides, b);
      face(b, a + sides, b + sides);
    }
  }
  const end = (rings - 1) * sides;
  for (let i = 1; i < sides - 1; i++) {
    face(0, i, i + 1);
    face(end, end + i + 1, end + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildArm(side, material) {
  const sleeve = organicSurface([
    [0.11, -0.09 * side, 0, 0.055, 0.057], [0.02, 0, 0, 0.128, 0.101],
    [-0.22, 0.038 * side, 0.012, 0.088, 0.074], [-0.52, 0.056 * side, -0.035, 0.053, 0.063],
    [-0.61, 0.061 * side, -0.03, 0.068, 0.053], [-0.78, 0.073 * side, 0.025, 0.063, 0.051],
    [-1.04, 0.058 * side, 0.081, 0.041, 0.037], [-1.19, 0.046 * side, 0.118, 0.031, 0.027],
    [-1.35, 0.047 * side, 0.135, 0.053, 0.029], [-1.44, 0.058 * side, 0.157, 0.048, 0.024],
    [-1.49, 0.059 * side, 0.172, 0.012, 0.01],
  ], 12, 2, 0x424043);
  const parts = [sleeve];
  for (let finger = 0; finger < 5; finger++) {
    const thumb = finger === 0;
    const x = (thumb ? 0.006 : 0.026 + 0.025 * (finger - 1)) * side;
    const y = thumb ? -1.35 : -1.43;
    const length = [0.22, 0.29, 0.34, 0.31, 0.24][finger];
    const spread = (finger - 2.2) * 0.022 * side;
    parts.push(organicSurface([
      [y + 0.04, x, 0.154, 0.012, 0.011],
      [y - length * 0.18, x + spread * 0.4, 0.172, 0.015, 0.013],
      [y - length * 0.5, x + spread, 0.193, 0.01, 0.012],
      [y - length * 0.78, x + spread * 1.18, 0.236, 0.008, 0.009],
      [y - length, x + spread * 0.96, 0.29, 0.002, 0.002],
    ], 7, 1, 0x524e50));
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();

  const shoulder = new THREE.Bone();
  const elbow = new THREE.Bone();
  elbow.position.set(0.06 * side, -0.59, -0.03);
  shoulder.add(elbow);
  const wrist = new THREE.Bone();
  wrist.position.set(-0.014 * side, -0.6, 0.148);
  elbow.add(wrist);
  const indices = [], weights = [];
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const y = -positions.getY(i);
    const upper = 1 - THREE.MathUtils.smoothstep(y, 0.38, 0.79);
    const hand = THREE.MathUtils.smoothstep(y, 1.03, 1.32);
    indices.push(0, 1, 2, 0);
    weights.push(upper, 1 - upper - hand, hand, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(shoulder);
  mesh.bind(new THREE.Skeleton([shoulder, elbow, wrist]));
  // A conservative range keeps frustum culling valid for bent arms and wrists.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.53, 0), 1.45);
  mesh.receiveShadow = true;
  mesh.position.set(side * 0.265, 2.18, -0.01);
  return { mesh, shoulder, elbow, wrist, side };
}

function grinGeometry(depthAt) {
  const positions = [], colors = [], indices = [];
  const sections = 20;
  const rows = [0, 0.19, 0.37, 1];
  const shadow = new THREE.Color(0x0d0b10);
  const ridge = new THREE.Color(0x554c48);
  for (let i = 0; i <= sections; i++) {
    const u = i / sections * 2 - 1;
    const x = 0.097 * u + 0.009;
    const center = 0.096 + (u < 0 ? 0.049 : 0.061) * u * u + 0.004 * Math.sin(u * 7);
    const width = 0.001 + 0.034 * Math.pow(1 - u * u, 0.65);
    for (let row = 0; row < rows.length; row++) {
      const y = center + width * (0.57 - rows[row]);
      positions.push(x, y, depthAt(x, y) + 0.003);
      const tooth = row === 1 ? (0.35 + 0.65 * (i % 2)) * (1 - Math.abs(u)) : 0;
      colors.push(
        THREE.MathUtils.lerp(shadow.r, ridge.r, tooth),
        THREE.MathUtils.lerp(shadow.g, ridge.g, tooth),
        THREE.MathUtils.lerp(shadow.b, ridge.b, tooth));
      if (i < sections && row < rows.length - 1) {
        const a = i * rows.length + row;
        const b = a + rows.length;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class Ghost {
  constructor(scene, smokeCount = 50) {
    this.scene = scene;
    this.mode = 'hidden';   // hidden | apparition | stalk | chase | banished
    this.apparitionTimer = 0;
    this.apparitionStart = new THREE.Vector3();
    this.apparitionEnd = new THREE.Vector3();
    this.stalkTimer = 0;
    this.banishTimer = 0;
    this.flickerClock = 0;
    this.visualFlicker = false;
    this.presence = 1;
    this.stride = 0;
    this.motion = 0;
    this.bobClock = Math.random() * 10;
    this.burnMeter = 0;
    this.burning = false;
    this.banishCount = 0;

    this.spawn = new THREE.Vector3();
    this._build(smokeCount);
    this.group.visible = false;
    scene.add(this.group);
  }

  _build(smokeCount) {
    this.group = new THREE.Group();
    this.figure = new THREE.Group();
    this.group.add(this.figure);

    this.skin = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.86, metalness: 0.05, alphaHash: true,
      emissive: 0x282731, emissiveIntensity: 0,
    });
    const torso = organicSurface([
      [0.08, -0.07, -0.07, 0.05, 0.055], [0.35, -0.045, -0.08, 0.145, 0.11],
      [0.67, 0.02, -0.11, 0.21, 0.123], [1.03, 0.025, -0.09, 0.202, 0.138],
      [1.28, 0.018, -0.04, 0.163, 0.132], [1.54, 0.014, -0.005, 0.173, 0.145],
      [1.79, -0.014, 0.004, 0.226, 0.17], [2.04, -0.026, -0.028, 0.267, 0.187],
      [2.19, -0.009, -0.02, 0.336, 0.153], [2.29, 0.01, 0.03, 0.22, 0.127],
      [2.34, 0.018, 0.10, 0.09, 0.082], [2.44, 0.026, 0.145, 0.077, 0.071],
    ], 20, 2, 0x38373b, (point, angle, progress) => {
      // Ragged folds taper into the silhouette, with uneven hem height.
      const hem = 1 - THREE.MathUtils.smoothstep(progress, 0.02, 0.46);
      point.y += hem * (0.32 + 0.27 * Math.sin(angle * 5) + 0.15 * Math.cos(angle * 7));
      point.z += hem * 0.047 * Math.sin(angle * 8 + progress * 4);
      const folds = 0.85 + 0.15 * Math.sin(angle * 6 + progress * 3);
      return folds * (0.62 + 0.38 * THREE.MathUtils.smoothstep(progress, 0.02, 0.83));
    });
    const body = new THREE.Mesh(torso, this.skin);
    body.receiveShadow = true;
    this.figure.add(body);

    this.arms = [-1, 1].map(side => buildArm(side, this.skin));
    for (const arm of this.arms) this.figure.add(arm.mesh);

    this.head = new THREE.Group();
    this.head.position.set(0.025, 2.35, 0.135);
    const skull = organicSurface([
      [-0.025, 0, -0.03, 0.054, 0.062], [0.035, 0.018, 0.005, 0.068, 0.078],
      [0.087, 0.023, 0.013, 0.095, 0.098], [0.155, 0.009, 0.002, 0.118, 0.106],
      [0.227, -0.006, -0.006, 0.134, 0.124], [0.295, -0.019, -0.02, 0.137, 0.127],
      [0.36, -0.033, -0.035, 0.104, 0.102], [0.412, -0.053, -0.04, 0.048, 0.063],
      [0.432, -0.068, -0.048, 0.005, 0.006],
    ], 40, 3, 0x352e34, (point, angle) => {
      const front = Math.max(0, Math.sin(angle));
      const x = Math.abs(point.x);
      const eyeHeight = (point.x < 0 ? 0.225 : 0.213) + (x - 0.055) * 0.39;
      const socket = Math.exp(-Math.pow((x - 0.055) / 0.044, 2)
        - Math.pow((point.y - eyeHeight) / 0.024, 2)) * front;
      const brow = Math.exp(-Math.pow((x - 0.054) / 0.051, 2)
        - Math.pow((point.y - eyeHeight - 0.031) / 0.013, 2)) * front;
      const bridge = Math.exp(-Math.pow((point.x + 0.008) / 0.018, 2)
        - Math.pow((point.y - 0.18) / 0.055, 2)) * front;
      const cheek = Math.exp(-Math.pow((x - 0.079) / 0.032, 2)
        - Math.pow((point.y - 0.165) / 0.022, 2)) * front;
      point.z += -0.066 * socket + 0.043 * brow + 0.026 * bridge + 0.024 * cheek;
      return 0.88 - 0.76 * socket + 0.32 * brow + 0.2 * cheek;
    });
    const cheeks = new THREE.Mesh(skull, this.skin);
    cheeks.receiveShadow = true;
    this.head.add(cheeks);
    const faceRay = new THREE.Raycaster();
    faceRay.ray.direction.set(0, 0, -1);
    const depthAt = (x, y) => {
      faceRay.ray.origin.set(x, y, 0.5);
      return faceRay.intersectObject(cheeks, false)[0]?.point.z ?? 0.065;
    };
    const grin = new THREE.Mesh(grinGeometry(depthAt), this.skin);
    grin.receiveShadow = true;
    this.head.add(grin);

    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xb8bab9, transparent: true });
    const eyeShape = new THREE.SphereGeometry(1, 8, 5);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeShape, this.eyeMaterial);
      const x = side * 0.055, y = side < 0 ? 0.225 : 0.213;
      eye.position.set(x, y, depthAt(x, y) + 0.005);
      eye.scale.set(0.013, 0.005, 0.006);
      eye.rotation.z = side * 0.34;
      this.head.add(eye);
    }
    this.figure.add(this.head);

    const positions = new Float32Array(smokeCount * 3);
    this.smokePhase = new Float32Array(smokeCount * 2);
    for (let i = 0; i < this.smokePhase.length; i++) this.smokePhase[i] = Math.random();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.42, 0), 2);
    this.smoke = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0x242326, map: ghostSmokeTexture(), size: 0.22,
      transparent: true, opacity: 0.22, depthWrite: false,
    }));
    this.group.add(this.smoke);
  }

  _animate(dt, t, distance, direction, speed) {
    const blend = 1 - Math.exp(-7 * dt);
    this.motion += (Math.min(speed / CHASE_SPEED, 1) - this.motion) * blend;
    this.stride += dt * (1.5 + this.motion * 4.5);
    const turn = direction - this.figure.rotation.y;
    this.figure.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * blend;
    this.smoke.rotation.y = this.figure.rotation.y;

    const breath = Math.sin(t * 1.7);
    const burn = THREE.MathUtils.smoothstep(this.burnMeter, 0, 1);
    const reach = this.engaged ? Math.max(0, 1 - distance / 4) : 0;
    this.figure.position.y = 0.027 * breath + this.motion * 0.024 * Math.sin(this.stride * 2);
    this.figure.rotation.x = 0.035 + this.motion * 0.071 - burn * 0.14;
    this.figure.rotation.z = Math.sin(t * 1.31) * 0.02 + Math.sin(this.stride) * this.motion * 0.035;
    this.head.rotation.set(
      0.15 - this.figure.rotation.x + Math.sin(t * 1.55) * 0.047 + burn * 0.19,
      Math.sin(t * 0.87) * 0.093 - Math.sin(turn) * 0.28,
      -0.13 + Math.sin(t * 1.21) * 0.054 + burn * 0.17);

    for (const { shoulder, elbow, wrist, side } of this.arms) {
      const swing = Math.sin(this.stride + (side < 0 ? 0 : Math.PI));
      shoulder.rotation.x = -0.11 - reach * 0.49 + swing * this.motion * 0.42 + burn * 0.23;
      shoulder.rotation.z = side * (0.16 + reach * 0.075 + burn * 0.19);
      elbow.rotation.x = -0.17 - reach * 0.24 - Math.max(0, -swing) * this.motion * 0.25;
      wrist.rotation.z = side * (0.09 + Math.sin(t * 2.05 + side) * 0.067);
      wrist.rotation.x = Math.sin(this.stride + side) * this.motion * 0.14 + burn * 0.22;
    }

    if (this.mode === 'apparition') {
      this.presence = 0.86 * THREE.MathUtils.smoothstep(this.apparitionTimer, 0, 0.42);
    } else {
      const targetPresence = this.visualFlicker ? 0.16 : 1;
      this.presence += (targetPresence - this.presence) * (1 - Math.exp(-16 * dt));
    }
    this.skin.opacity = this.presence * (1 - burn * 0.98);
    this.eyeMaterial.opacity = this.presence * (0.73 - burn * 0.7);
    this.smoke.material.opacity = this.presence * (0.19 + burn * 0.25);
    const points = this.smoke.geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const u = this.smokePhase[2 * i], v = this.smokePhase[2 * i + 1];
      const age = (u + t * (0.16 + v * 0.1)) % 1;
      const a = v * Math.PI * 2 + age * 1.8;
      const spread = 0.19 + age * (0.25 + burn * 0.48);
      points.setXYZ(i, Math.cos(a) * spread, 0.18 + age * 2.42,
        Math.sin(a) * spread - this.motion * age * 0.39);
    }
    points.needsUpdate = true;
  }

  _resetPose() {
    this.group.visible = true;
    this.visualFlicker = false;
    this.flickerClock = 0;
    this.presence = 1;
    this.motion = 0;
    this.skin.emissiveIntensity = this.mode === 'apparition' ? 0.62 : 0;
    this.skin.opacity = 1;
    this.eyeMaterial.opacity = 0.73;
    this.smoke.material.opacity = 0.19;
    this.facingSpawn = true;
  }

  /* ---------------- states ---------------- */

  appearAt(pos, duration = 1.2, destination = pos) {
    this.group.position.set(pos.x, 0, pos.z);
    this.mode = 'apparition';
    this.apparitionTimer = duration;
    this.apparitionDuration = duration;
    this.apparitionStart.copy(this.group.position);
    this.apparitionEnd.set(destination.x, 0, destination.z);
    this.apparitionFresh = true;
    this._resetPose();
  }

  vanish() {
    this.mode = 'hidden';
    this.group.visible = false;
    this.burnMeter = 0;
  }

  /** Pre-finale hunting phase: he manifests and drifts toward the player. */
  startStalk(spawnPos, lifespan = 20) {
    this.group.position.set(spawnPos.x, 0, spawnPos.z);
    this.mode = 'stalk';
    this.stalkTimer = lifespan;
    this.burnMeter = 0;
    this._resetPose();
  }

  startChase(spawnPos) {
    this.group.position.set(spawnPos.x, 0, spawnPos.z);
    this.mode = 'chase';
    this.burnMeter = 0;
    this._resetPose();
  }

  get engaged() { return this.mode === 'stalk' || this.mode === 'chase'; }

  /** Beam is on him. Returns 'banished' the moment the meter fills. */
  applyBurn(dt) {
    if (!this.engaged) return null;
    this.burning = true;
    const burnTime = this.mode === 'chase' ? BURN_TIME_CHASE : BURN_TIME_STALK;
    this.burnMeter += dt / burnTime;
    if (this.burnMeter >= 1) {
      this._banish();
      return 'banished';
    }
    return 'burning';
  }

  stopBurn() { this.burning = false; }

  _banish() {
    this.banishCount++;
    this.burnMeter = 0;
    this.burning = false;
    if (this.mode === 'chase') {
      this.mode = 'banished';
      this.banishTimer = BANISH_DOWNTIME;
      this.group.visible = false;
    } else {
      this.vanish();
    }
  }

  /* ---------------- update ---------------- */

  /** @returns true the moment the player is caught */
  update(dt, playerPos, t) {
    if (this.mode === 'banished') {
      this.banishTimer -= dt;
      if (this.banishTimer <= 0) {
        // he reforms out of reach and resumes the hunt
        const a = Math.random() * Math.PI * 2;
        const x = THREE.MathUtils.clamp(playerPos.x + Math.cos(a) * 10, BOUNDS.minX + 1, BOUNDS.maxX - 1);
        const z = THREE.MathUtils.clamp(playerPos.z + Math.sin(a) * 10, BOUNDS.minZ + 1, BOUNDS.maxZ - 1);
        this.startChase(this.spawn.set(x, 0, z));
      }
      return false;
    }
    if (this.mode === 'hidden') return false;

    const startX = this.group.position.x, startZ = this.group.position.z;
    const dx = playerPos.x - startX;
    const dz = playerPos.z - startZ;
    const distanceSquared = dx * dx + dz * dz;
    const dist = Math.sqrt(distanceSquared);
    const direction = Math.atan2(dx, dz);
    if (this.facingSpawn) {
      this.figure.rotation.y = direction;
      this.facingSpawn = false;
    }

    this.bobClock += dt;
    if (this.burning) {
      this.group.position.x += (Math.random() - 0.5) * 0.05;
      this.group.position.z += (Math.random() - 0.5) * 0.05;
    } else {
      this.burnMeter = Math.max(0, this.burnMeter - dt * 0.45);
    }

    if (this.mode === 'apparition') {
      const interval = this.apparitionFresh ? 0 : dt;
      this.apparitionFresh = false;
      this.apparitionTimer -= interval;
      if (this.apparitionTimer <= 0) {
        this.vanish();
        return false;
      }
      const elapsed = this.apparitionDuration - this.apparitionTimer;
      const glide = THREE.MathUtils.smoothstep(elapsed, 0, this.apparitionDuration);
      this.group.position.lerpVectors(this.apparitionStart, this.apparitionEnd, glide);
      const speed = interval > 0 ? Math.hypot(this.group.position.x - startX, this.group.position.z - startZ) / interval : 0;
      this._animate(interval, t, dist, direction, speed);
      return false;
    }

    // ----- movement: glides through walls, lurching, never smooth -----
    const slow = this.burning ? 0.3 : 1;
    const base = this.mode === 'chase' ? CHASE_SPEED : STALK_SPEED;
    const lurch = 1 + Math.sin(this.bobClock * 8.5) * 0.55;   // surging gait
    if (dist > 0.001) {
      const invDist = 1 / dist;
      const step = Math.min(base * slow * lurch * dt, dist) * invDist;
      this.group.position.x += dx * step;
      this.group.position.z += dz * step;
      // lateral drift so he weaves at you
      if (this.mode === 'chase') {
        const sway = Math.sin(this.bobClock * 2.7) * 0.5 * dt * invDist;
        this.group.position.x -= dz * sway;
        this.group.position.z += dx * sway;
      }
    }

    if (this.mode === 'stalk') {
      this.stalkTimer -= dt;
      if (this.stalkTimer <= 0) { this.vanish(); return false; }
      this.visualFlicker = false;
    } else {
      // chase: corrupted-frame strobing
      this.flickerClock -= dt;
      if (this.flickerClock <= 0) {
        this.visualFlicker = !this.visualFlicker;
        this.flickerClock = this.visualFlicker ? 0.04 + Math.random() * 0.1 : 0.12 + Math.random() * 0.3;
      }
    }

    const speed = dt > 0 ? Math.hypot(this.group.position.x - startX, this.group.position.z - startZ) / dt : 0;
    this._animate(dt, t, dist, direction, speed);
    return distanceSquared < CATCH_DIST * CATCH_DIST;
  }

  distanceTo(playerPos) {
    return Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z);
  }
}
