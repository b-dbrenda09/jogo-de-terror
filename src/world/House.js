import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './Textures.js';

export const WALL_H = 3;
export const BOUNDS = { minX: -10, maxX: 10, minZ: -8, maxZ: 8 };

export const ZONES = {
  living:  { minX: -10, maxX: -3, minZ: 2, maxZ: 8 },
  foyer:   { minX: -3, maxX: 3, minZ: 2, maxZ: 8 },
  dining:  { minX: 3, maxX: 10, minZ: 2, maxZ: 8 },
  hallway: { minX: -10, maxX: 10, minZ: -1, maxZ: 2 },
  kitchen: { minX: 3, maxX: 10, minZ: -8, maxZ: -1 },
  bedroom: { minX: -4, maxX: 3, minZ: -8, maxZ: -1 },
  study:   { minX: -10, maxX: -4, minZ: -8, maxZ: -1 },
};

const WALL_T = 0.25;

/* Walls: dir 'x' runs along the x axis at z = at; dir 'z' runs along z at x = at. */
const WALL_DEFS = [
  { dir: 'x', at: -8, from: -10, to: 10 },
  { dir: 'x', at: 8, from: -10, to: 10, gaps: [[-0.9, 0.9]] },
  { dir: 'z', at: -10, from: -8, to: 8 },
  { dir: 'z', at: 10, from: -8, to: 8 },
  { dir: 'x', at: 2, from: -10, to: 10, gaps: [[-1.3, 1.3], [-7.6, -6.2], [5.2, 6.6]] },
  { dir: 'x', at: -1, from: -10, to: 10, gaps: [[-7.9, -6.5], [-1.3, 0.1], [5.9, 7.3]] },
  { dir: 'z', at: -3, from: 2, to: 8, gaps: [[4.1, 5.5]] },
  { dir: 'z', at: 3, from: 2, to: 8, gaps: [[4.1, 5.5]] },
  { dir: 'z', at: -4, from: -8, to: -1 },
  { dir: 'z', at: 3, from: -8, to: -1 },
];

function boxes(parent, geometry, material, parts) {
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
  const matrix = new THREE.Matrix4();
  parts.forEach(([x, y, z, w, h, d], i) => {
    mesh.setMatrixAt(i, matrix.makeScale(w, h, d).setPosition(x, y, z));
  });
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function frameBars(x, y, z, w, h, border, depth) {
  return [
    [x - (w - border) / 2, y, z, border, h, depth],
    [x + (w - border) / 2, y, z, border, h, depth],
    [x, y - (h - border) / 2, z, w - 2 * border, border, depth],
    [x, y + (h - border) / 2, z, w - 2 * border, border, depth],
  ];
}

class Door {
  /** A hinged door on an x-direction wall. Hinge at (hingeX, wallZ), extends +x. */
  constructor(parent, hingeX, wallZ, width, materials, unitBox, knobGeometry, openAngle = 1.95) {
    this.hingeX = hingeX;
    this.wallZ = wallZ;
    this.width = width;
    this.closedBounds = {
      minX: hingeX, maxX: hingeX + width,
      minZ: wallZ - 0.1, maxZ: wallZ + 0.1,
    };
    this.openAngle = openAngle;
    this.angle = 0;
    this.target = 0;
    this.speed = 2.2; // rad/s default swing

    this.group = new THREE.Group();
    this.group.position.set(hingeX, 0, wallZ);
    const geo = new THREE.BoxGeometry(width - 0.04, 2.95, 0.07);
    this.mesh = new THREE.Mesh(geo, materials.wood);
    this.mesh.position.set(width / 2, 2.95 / 2, 0);
    this.group.add(this.mesh);
    const panels = [], hardware = [];
    for (const face of [-1, 1]) {
      for (const [y, h] of [[0.57, 0.85], [1.49, 0.69], [2.37, 0.82]]) {
        panels.push(...frameBars(width / 2, y, face * 0.04, width - 0.28, h, 0.049, 0.025));
      }
      hardware.push([width - 0.12, 1.05, face * 0.043, 0.082, 0.18, 0.018]);
      const knob = new THREE.Mesh(knobGeometry, materials.agedBrass);
      knob.position.set(width - 0.12, 1.05, face * 0.068);
      this.group.add(knob);
      for (const y of [0.38, 1.47, 2.61]) {
        hardware.push([0.047, y, face * 0.042, 0.062, 0.105, 0.018]);
      }
    }
    boxes(this.group, unitBox, materials.trim, panels);
    boxes(this.group, unitBox, materials.agedBrass, hardware);
    parent.add(this.group);
    this.mesh.userData.interact = { type: 'door', door: this };
  }

  get isClosed() { return this.angle < 0.12; }
  get isOpen() { return this.angle > this.openAngle - 0.2; }

  setOpen(open, speed = 2.2) {
    this.target = open ? this.openAngle : 0;
    this.speed = speed;
  }

  toggle() { this.setOpen(this.target < 0.5); }

  update(dt) {
    const d = this.target - this.angle;
    if (Math.abs(d) > 0.002) {
      this.angle += Math.sign(d) * Math.min(Math.abs(d), this.speed * dt);
      this.group.rotation.y = this.angle;
    }
  }

  aabb() {
    return this.isClosed ? this.closedBounds : null;
  }
}

export class House {
  constructor(scene, dustCount = 240, batteryGlints = true, lowDetail = false) {
    this.scene = scene;
    this.staticColliders = [];
    this.scareOccluders = [];
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.trimBatches = new Map();
    this.doors = [];
    this.interactables = [];
    this.keys = [];
    this.bulbs = [];
    this.windowLights = [];
    this.candles = [];
    this.props = {};
    this.flickerTime = 0;
    this.lightningTime = 0;
    this.blackout = false;
    this.batteryGlints = batteryGlints;
    this.lowDetail = lowDetail;

    this.mats = this._materials();
    this._buildShell();
    this._buildTrimInstances();
    this._buildDoors();
    this._buildFurniture();
    this._buildKeyOccluders();
    this._buildLights();
    this.electricLights = [...this.bulbs, ...this.windowLights];
    this._buildItems();
    this._buildDust(dustCount);
    this.colliders = this.staticColliders.slice();
  }

  /* ---------------- materials ---------------- */

  _materials() {
    const wallTex = TX.wallpaper();
    const floorTex = TX.woodFloor();
    floorTex.repeat.set(5, 4);
    const ceilTex = TX.plaster();
    ceilTex.repeat.set(6, 5);
    const woodTex = TX.darkWood();
    const fabricTex = TX.fabric();
    this.wallMaterials = new Map();
    return {
      wallTexBase: wallTex,
      floor: new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.033, roughness: 0.87 }),
      ceiling: new THREE.MeshStandardMaterial({ map: ceilTex, bumpMap: ceilTex, bumpScale: 0.035, roughness: 0.99 }),
      wood: new THREE.MeshStandardMaterial({ map: woodTex, bumpMap: woodTex, bumpScale: 0.019, roughness: 0.79 }),
      fabric: new THREE.MeshStandardMaterial({ map: fabricTex, bumpMap: fabricTex, bumpScale: 0.012, roughness: 0.99 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xa07a22, metalness: 0.9, roughness: 0.3, emissive: 0x2a1d06 }),
      trim: new THREE.MeshStandardMaterial({ map: woodTex, color: 0xbf9877, roughness: 0.86 }),
      pewter: new THREE.MeshStandardMaterial({ color: 0x74716a, metalness: 0.62, roughness: 0.64 }),
      agedBrass: new THREE.MeshStandardMaterial({ color: 0x806841, metalness: 0.55, roughness: 0.62 }),
      linen: new THREE.MeshStandardMaterial({ map: TX.fabric(123, 113, 95), roughness: 1 }),
      blanket: new THREE.MeshStandardMaterial({ map: TX.fabric(65, 78, 72), roughness: 0.98 }),
      sinkInterior: new THREE.MeshStandardMaterial({ color: 0x242420, roughness: 0.9 }),
      stone: new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.93 }),
      paper: new THREE.MeshStandardMaterial({ map: TX.paper(), roughness: 0.9, side: THREE.DoubleSide }),
    };
  }

  _wallMaterial(len) {
    const repeat = Math.max(1, Number((len / 2.6).toFixed(6)));
    if (!this.wallMaterials.has(repeat)) {
      const tex = this.mats.wallTexBase.clone();
      tex.needsUpdate = true;
      tex.repeat.set(repeat, 1.15);
      this.wallMaterials.set(repeat, new THREE.MeshStandardMaterial({
        map: tex, bumpMap: tex, bumpScale: 0.026, roughness: 0.97,
      }));
    }
    return this.wallMaterials.get(repeat);
  }

  /* ---------------- structure ---------------- */

  _buildShell() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20.6, 16.6), this.mats.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(20.6, 16.6), this.mats.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    this.scene.add(ceil);

    for (const def of WALL_DEFS) this._buildWall(def);
  }

  _buildWall(def) {
    const gaps = (def.gaps || []).slice().sort((a, b) => a[0] - b[0]);
    let cursor = def.from;
    const segs = [];
    for (const [g0, g1] of gaps) {
      if (g0 > cursor) segs.push([cursor, g0]);
      // lintel above the opening
      this._wallBox(def, g0, g1, 2.45, WALL_H, false);
      cursor = g1;
    }
    if (cursor < def.to) segs.push([cursor, def.to]);
    for (const [a, b] of segs) this._wallBox(def, a, b, 0, WALL_H, true);
  }

  _wallBox(def, a, b, y0, y1, collide) {
    const len = b - a;
    if (len < 0.02) return;
    const h = y1 - y0;
    const geo = def.dir === 'x'
      ? new THREE.BoxGeometry(len, h, WALL_T)
      : new THREE.BoxGeometry(WALL_T, h, len);
    const material = this._wallMaterial(len);
    const uv = geo.attributes.uv;
    const offset = (def.at * 0.173 + a * 0.113 + (def.dir === 'z' ? 0.38 : 0)) / material.map.repeat.x;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) + offset, (y0 + uv.getY(i) * h) / WALL_H);
    }
    const mesh = new THREE.Mesh(geo, material);
    if (def.dir === 'x') mesh.position.set((a + b) / 2, y0 + h / 2, def.at);
    else mesh.position.set(def.at, y0 + h / 2, (a + b) / 2);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.scareOccluders.push(mesh);
    if (collide) {
      const half = WALL_T / 2 + 0.02;
      this.staticColliders.push(def.dir === 'x'
        ? { minX: a, maxX: b, minZ: def.at - half, maxZ: def.at + half }
        : { minX: def.at - half, maxX: def.at + half, minZ: a, maxZ: b });
      this._baseboards(def, a, b);
    }
  }

  _baseboards(def, a, b) {
    const len = b - a;
    if (len < 0.4) return;
    for (const side of [-1, 1]) {
      const off = side * (WALL_T / 2 + 0.018);
      const alongX = def.dir === 'x';
      const center = (a + b) / 2;
      const x = alongX ? center : def.at + off;
      const z = alongX ? def.at + off : center;
      // Small spatial batches retain useful frustum culling for the trim.
      const region = `${Math.floor((x + 10) / 7)}:${Math.floor((z + 8) / 6)}`;
      if (!this.trimBatches.has(region)) this.trimBatches.set(region, []);
      const batch = this.trimBatches.get(region);
      for (const [y, height, depth, shade] of [
        [0.078, 0.136, 0.035, 0xc4b4a3],
        [0.153, 0.027, 0.049, 0xe1cdb7],
        [0.029, 0.031, 0.047, 0xbfa991],
      ]) {
        batch.push({
          transform: new THREE.Matrix4()
            .makeScale(alongX ? len : depth, height, alongX ? depth : len)
            .setPosition(x, y, z),
          shade,
        });
      }
    }
  }

  _buildTrimInstances() {
    const color = new THREE.Color();
    for (const transforms of this.trimBatches.values()) {
      const trim = new THREE.InstancedMesh(this.unitBox, this.mats.trim, transforms.length);
      transforms.forEach(({ transform, shade }, index) => {
        trim.setMatrixAt(index, transform);
        trim.setColorAt(index, color.setHex(shade));
      });
      trim.receiveShadow = true;
      trim.computeBoundingSphere();
      this.scene.add(trim);
    }
    this.trimBatches.clear();
  }

  _buildDoors() {
    const knob = new THREE.SphereGeometry(0.032, 9, 7);
    const buildDoor = (x, z, width) => {
      const door = new Door(this.scene, x, z, width, this.mats, this.unitBox, knob);
      const casing = new THREE.Group();
      casing.position.set(x, 0, z);
      const rails = [];
      for (const face of [-1, 1]) {
        const depth = face * (WALL_T / 2 + 0.023);
        for (const edge of [-1, 1]) {
          rails.push([width / 2 + edge * (width / 2 + 0.052), 1.24, depth, 0.104, 2.48, 0.05]);
        }
        rails.push([width / 2, 2.505, depth, width + 0.208, 0.11, 0.062]);
      }
      boxes(casing, this.unitBox, this.mats.trim, rails);
      this.scene.add(casing);
      return door;
    };
    this.props.studyDoor = buildDoor(-7.9, -1, 1.4);
    this.props.bedroomDoor = buildDoor(-1.3, -1, 1.4);
    this.props.bedroomDoor.angle = this.props.bedroomDoor.target = this.props.bedroomDoor.openAngle;
    this.props.bedroomDoor.group.rotation.y = this.props.bedroomDoor.angle;
    this.props.frontDoor = buildDoor(-0.9, 8, 1.8);
    this.props.frontDoor.mesh.userData.interact = { type: 'frontdoor', door: this.props.frontDoor };
    this.doors.push(this.props.studyDoor, this.props.bedroomDoor, this.props.frontDoor);
    for (const d of this.doors) {
      this.interactables.push(d.mesh);
      this.scareOccluders.push(d.mesh);
    }
  }

  /* ---------------- furniture ---------------- */

  _box(x, z, w, h, d, mat, collide = true, y = null) {
    const mesh = new THREE.Mesh(this.unitBox, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y === null ? h / 2 : y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.scareOccluders.push(mesh);
    if (collide) {
      this.staticColliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    }
    return mesh;
  }


  _furniture(kind, x, z, width, height, depth, collide = true, rotation = 0, roomBatches) {
    // The original envelope still drives collision and apparition visibility.
    const proxy = this._box(x, z, width, height, depth, this.mats.wood, collide);
    proxy.visible = proxy.castShadow = false;
    const group = new THREE.Group();
    group.name = kind;
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    if (!roomBatches) this.scene.add(group);
    group.updateMatrix();
    const w = Math.abs(rotation) === Math.PI / 2 ? depth : width;
    const d = Math.abs(rotation) === Math.PI / 2 ? width : depth;
    const h = height;
    const { wood, trim, fabric, linen, blanket, pewter, agedBrass, stone, paper } = this.mats;
    const batches = roomBatches ?? new Map();
    const part = (px, py, pz, sx, sy, sz, material = wood, geo = this.unitBox, angle = 0) => {
      const key = material.id + ':' + geo.id;
      if (!batches.has(key)) batches.set(key, { material, geo, matrices: [] });
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(px, py, pz),
        new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle),
        new THREE.Vector3(sx, sy, sz),
      );
      if (roomBatches) matrix.premultiply(group.matrix);
      batches.get(key).matrices.push(matrix);
    };
    const legs = (top, span = w, inset = d, radius = 0.039) => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lx = sx * (span / 2 - radius * 1.3);
        const lz = sz * (inset / 2 - radius * 1.3);
        part(lx, top / 2, lz, radius, top, radius, wood, this.lowDetail ? this.unitBox : this.turnedLeg);
        if (!this.lowDetail) part(lx, top * 0.77, lz, radius * 1.7, 0.035, radius * 1.7, trim);
      }
    };
    const drawer = (px, py, pz, sw, sh) => {
      part(px, py, pz, sw, sh, 0.024, trim);
      part(px, py, pz + 0.014, sw - 0.07, sh * 0.57, 0.011);
      part(px, py, pz + 0.028, Math.min(0.12, sw * 0.32), 0.022, 0.032, agedBrass, this.roundPart);
    };
    const top = (y, thickness, material = wood) => {
      part(0, y - thickness / 2, 0, w, thickness, d, material, this.lowDetail ? this.unitBox : this.roundPart);
      part(0, y - thickness - 0.012, 0, w * 0.965, 0.024, d * 0.94, trim);
    };
    const casework = (material = wood, topMaterial = material, insetSink = false) => {
      const bodyHeight = h - (insetSink ? 0.24 : 0.1);
      part(0, 0.05 + bodyHeight / 2, -0.032, w - 0.028, bodyHeight, d - 0.075, material);
      if (!insetSink) top(h, 0.055, topMaterial);
      part(0, 0.05, 0, w, 0.1, d, trim);
    };

    switch (kind) {
      case 'sofa':
      case 'armchair': {
        const seats = kind === 'sofa' ? 3 : 1;
        const seatW = (w - 0.24) / seats;
        legs(0.17, w, d, 0.031);
        part(0, 0.25, 0, w, 0.23, d, fabric, this.roundPart);
        for (let i = 0; i < seats; i++) {
          const px = (i - (seats - 1) / 2) * seatW;
          part(px, 0.42, 0.034, seatW - 0.013, 0.19, d * 0.73, fabric, this.roundPart);
          part(px, h * 0.69, -d * 0.36, seatW - 0.015, h * 0.62, d * 0.28,
            fabric, this.roundPart);
        }
        for (const side of [-1, 1]) {
          part(side * (w / 2 - 0.065), 0.5, 0, 0.13, 0.31, d * 0.96, fabric, this.roundPart);
        }
        break;
      }
      case 'chair':
        legs(0.45, w, d, 0.032);
        part(0, 0.45, 0, w, 0.078, d, fabric, this.roundPart);
        for (const side of [-1, 1]) part(side * (w / 2 - 0.038), 0.65, -d / 2 + 0.032, 0.056, 0.44, 0.053);
        for (const y of [0.65, 0.82, h - 0.03]) part(0, y, -d / 2 + 0.035, w * 0.92, 0.055, 0.06, trim);
        break;
      case 'shelf':
        part(0, h / 2, -d / 2 + 0.018, w, h, 0.036);
        for (const side of [-1, 1]) part(side * (w / 2 - 0.033), h / 2, 0, 0.066, h, d);
        top(h, 0.07);
        for (const y of [0.12, h * 0.29, h * 0.51, h * 0.73]) {
          part(0, y, 0, w - 0.04, 0.058, d, trim);
          for (let i = 0; i < 10; i++) {
            if (this.lowDetail && i % 3 === 1) continue;
            const px = (i - 4.5) * w / 12;
            const bh = 0.16 + ((i * 7 + Math.round(y * 15)) % 9) * 0.023;
            const cover = [blanket, fabric, trim, wood][(i + Math.round(y * 10)) % 4];
            part(px, y + 0.029 + bh / 2, d * 0.06, w * 0.064, bh, d * 0.64, cover);
            if (!this.lowDetail) part(px, y + bh * 0.76, d * 0.39, w * 0.05, 0.012, 0.011, agedBrass);
          }
        }
        break;
      case 'bed':
        legs(0.19, w, d, 0.055);
        part(0, 0.24, 0, w, 0.19, d);
        part(0, 0.41, 0, w * 0.97, 0.23, d * 0.97, linen, this.roundPart);
        part(0, 0.518, 0.38, w, 0.064, d * 0.68, blanket, this.roundPart);
        part(0, 0.451, d / 2 - 0.045, w * 0.98, 0.18, 0.09, blanket, this.roundPart);
        for (const side of [-1, 1]) part(side * 0.43, 0.548, -0.74, 0.73, 0.14, 0.42, linen, this.roundPart, side * 0.07);
        break;
      case 'headboard':
        part(0, h * 0.64, 0, w - 0.12, h * 0.61, d * 0.59);
        part(0, h - 0.04, 0, w, 0.075, d, trim);
        for (const side of [-1, 1]) {
          part(side * (w / 2 - 0.045), h / 2, 0, 0.09, h, d);
          part(side * w / 4, h * 0.66, d * 0.29, w * 0.39, h * 0.37, 0.035, trim);
        }
        break;
      case 'wardrobe':
      case 'counter':
      case 'fridge':
      case 'dresser': {
        const counter = kind === 'counter';
        const fridge = kind === 'fridge';
        const insetSink = counter && w > 4;
        casework(fridge ? pewter : wood, counter ? stone : undefined, insetSink);
        const count = counter ? Math.ceil(w / 0.84) : 2;
        for (let i = 0; i < count; i++) {
          const px = (i - (count - 1) / 2) * w / count;
          if (kind === 'dresser') {
            drawer(0, h * (0.28 + i * 0.3), d / 2 - 0.044, w * 0.88, h * 0.24);
            continue;
          }
          const doorY = fridge ? h * (0.33 + i * 0.48) : h * 0.48;
          const doorX = fridge ? 0 : px;
          const doorW = fridge ? w * 0.91 : w / count - 0.028;
          const doorH = fridge ? h * (i ? 0.26 : 0.61) : h * 0.73;
          part(doorX, doorY, d / 2 - 0.029, doorW, doorH, 0.035, fridge ? pewter : trim);
          if (!fridge) part(doorX, doorY, d / 2 - 0.006, doorW * 0.74, doorH * 0.8, 0.015);
          part(doorX + doorW * 0.3, doorY + doorH * 0.26, d / 2 + 0.006,
            0.022, Math.min(0.15, doorH * 0.28), 0.028, agedBrass, this.roundPart);
        }
        if (insetSink) {
          const sinkX = 0.72;
          const halfWidth = 0.31, halfDepth = 0.21;
          const leftWidth = w / 2 + sinkX - halfWidth;
          const rightWidth = w / 2 - sinkX - halfWidth;
          part(-w / 2 + leftWidth / 2, h - 0.03, 0, leftWidth, 0.06, d, stone);
          part(w / 2 - rightWidth / 2, h - 0.03, 0, rightWidth, 0.06, d, stone);
          for (const side of [-1, 1]) {
            const ledge = d / 2 - halfDepth;
            part(sinkX, h - 0.03, side * (halfDepth + ledge / 2), halfWidth * 2, 0.06, ledge, stone);
            part(sinkX, h - 0.072, side * halfDepth, 0.65, 0.146, 0.025, pewter);
            part(sinkX + side * halfWidth, h - 0.072, 0, 0.025, 0.146, 0.42, pewter);
          }
          part(sinkX, h - 0.138, 0, 0.62, 0.025, 0.42, pewter);
          part(sinkX, h - 0.124, 0, 0.065, 0.004, 0.065, this.mats.sinkInterior, this.turnedLeg);
          part(0, h + 0.025, -d / 2 + 0.025, w, 0.11, 0.05, stone);
          part(sinkX, h + 0.15, -0.24, 0.028, 0.27, 0.028, pewter, this.turnedLeg);
          part(sinkX, h + 0.27, -0.17, 0.032, 0.032, 0.17, pewter, this.roundPart);
          part(sinkX, h + 0.24, -0.09, 0.029, 0.07, 0.029, pewter);
          part(-1.45, h + 0.057, -0.12, 0.115, 0.12, 0.115, pewter, this.turnedLeg);
          part(-1.29, h + 0.09, -0.12, 0.22, 0.024, 0.03, wood);
          part(-2.25, h + 0.014, 0.045, 0.34, 0.028, 0.23, trim, this.roundPart, -0.21);
          part(-2.27, h + 0.037, 0.05, 0.17, 0.019, 0.028, pewter, this.roundPart, -0.42);
        }
        break;
      }
      case 'clock': {
        part(0, h / 2, -0.07, w * 0.87, h - 0.12, d * 0.7);
        top(h, 0.073);
        part(0, 0.095, 0, w, 0.19, d, trim);
        part(0, 2.1, d / 2 - 0.031, w, 0.55, 0.075, trim);
        part(0, 1.2, d / 2 - 0.023, w * 0.62, 1.11, 0.035, this.mats.sinkInterior);
        part(0, 1.21, d / 2, 0.019, 0.76, 0.016, agedBrass);
        part(0, 0.86, d / 2, 0.15, 0.19, 0.035, agedBrass, this.roundPart);
        break;
      }
      default: {
        legs(h - 0.065);
        if (kind === 'foyer table') {
          // Recess the centre of the top so the original note is visible.
          part(0, 0.745, 0, w, 0.06, d);
          for (const side of [-1, 1]) {
            part(side * w * 0.41, h - 0.039, 0, w * 0.18, 0.078, d, trim);
          }
          part(0, h - 0.039, -d / 2 + 0.015, w, 0.078, 0.03, trim);
        } else top(h, 0.052);
        part(0, h - (kind === 'foyer table' ? 0.147 : 0.12), 0, w * 0.86, 0.125, d * 0.83);
        if (['desk', 'foyer table', 'hall table', 'nightstand'].includes(kind)) {
          const sw = kind === 'desk' ? w * 0.42 : w * 0.77;
          drawer(kind === 'desk' ? -0.43 : 0, h - 0.126, d * 0.43, sw, 0.105);
        }
        if (kind === 'desk') {
          part(0.63, h + 0.015, -0.23, 0.24, 0.029, 0.19, blanket, this.unitBox, -0.13);
          part(-0.65, h + 0.003, 0.25, 0.19, 0.006, 0.23, paper, this.unitBox, 0.22);
        }
        if (kind === 'dining table') {
          part(0.28, h + 0.04, 0.32, 0.29, 0.08, 0.29, pewter, this.bowl);
          part(0.53, h + 0.01, 0.32, 0.23, 0.022, 0.23, agedBrass, this.bowl);
        }
      }
    }
    if (!roomBatches) this._addFurnitureBatches(group, batches, kind);
    return { proxy, group };
  }

  _addFurnitureBatches(group, batches, kind) {
    const { wood, fabric } = this.mats;
    for (const { material, geo, matrices } of batches.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.castShadow = (material === fabric && !(this.lowDetail && kind === 'chair')) ||
        (material === wood && geo === this.unitBox && kind !== 'chair');
      group.add(mesh);
    }
  }

  _buildFurniture() {
    this.roundPart = new RoundedBoxGeometry(1, 1, 1, 1, 0.16);
    this.turnedLeg = new THREE.LatheGeometry([
      new THREE.Vector2(0, -0.5), new THREE.Vector2(0.46, -0.5),
      new THREE.Vector2(0.49, -0.39), new THREE.Vector2(0.35, -0.29),
      new THREE.Vector2(0.32, 0.03), new THREE.Vector2(0.53, 0.31),
      new THREE.Vector2(0.48, 0.5), new THREE.Vector2(0, 0.5),
    ], 8);
    this.bowl = new THREE.LatheGeometry([
      new THREE.Vector2(0, -0.5), new THREE.Vector2(0.27, -0.5),
      new THREE.Vector2(0.5, 0.42), new THREE.Vector2(0.46, 0.5),
      new THREE.Vector2(0.23, -0.15), new THREE.Vector2(0, -0.15),
    ], 12);
    const build = (...args) => this._furniture(...args);
    const side = Math.PI / 2;

    build('sofa', -8.9, 4.6, 1.1, 0.95, 3, true, side);
    const sofaBack = this._box(-8.35, 4.6, 0.25, 1.5, 3, this.mats.fabric, false, 0.75);
    sofaBack.visible = sofaBack.castShadow = false;
    build('coffee table', -6.9, 4.6, 0.9, 0.45, 1.8);
    build('armchair', -5.6, 6.9, 1, 1, 1, true, Math.PI);
    build('shelf', -6.4, 2.55, 2.2, 2.3, 0.45);
    build('wardrobe', -9.55, 7, 0.6, 2.5, 1.4, true, side);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4),
      new THREE.MeshStandardMaterial({ map: TX.fabric(36, 24, 24), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-6.7, 0.012, 4.6);
    rug.receiveShadow = true;
    this.scene.add(rug);


    build('dining table', 6.5, 5, 3, 0.78, 1.4);
    const chairBatches = new Map();
    for (const z of [4.1, 5.9]) {
      for (const x of [5.4, 6.5, 7.6]) {
        build('chair', x, z, 0.42, 0.9, 0.42, false, z > 5 ? Math.PI : 0, chairBatches);
      }
    }
    const diningChairs = new THREE.Group();
    diningChairs.name = 'dining chairs';
    this._addFurnitureBatches(diningChairs, chairBatches, 'chair');
    this.scene.add(diningChairs);
    build('dresser', 9.55, 3.4, 0.6, 1.5, 1.8, true, -side);
    build('wardrobe', 4, 7.3, 1.6, 2.4, 0.5, true, Math.PI);

    build('counter', 6.6, -7.45, 6.4, 0.95, 0.75);
    build('counter', 9.55, -6, 0.6, 0.95, 2.2, true, -side);
    build('fridge', 9.5, -4, 0.85, 1.9, 0.85, true, -side);
    build('kitchen table', 5.6, -3.6, 1.6, 0.78, 1.6);
    const chair = build('chair', 4.6, -3.6, 0.42, 0.9, 0.42, false, side);
    // Keep the animated handle and its original world-space occlusion box together.
    const chairPivot = new THREE.Group();
    chairPivot.position.copy(chair.proxy.position);
    this.scene.add(chairPivot);
    chairPivot.attach(chair.group);
    chairPivot.attach(chair.proxy);
    this.props.kitchenChair = chairPivot;
    this.props.kitchenChairOccluder = chair.proxy;
    build('chair', 6.6, -3, 0.42, 0.9, 0.42, false, Math.PI);

    build('desk', -7.1, -6.1, 1.9, 0.78, 0.95);
    build('chair', -7.1, -5.2, 0.45, 0.95, 0.45, false, Math.PI);
    build('shelf', -9.55, -4.6, 0.6, 2.5, 2.2, true, side);
    build('shelf', -9.55, -7, 0.6, 2.5, 1.6, true, side);
    build('shelf', -5, -7.5, 1.6, 2.3, 0.5);

    build('bed', -0.6, -6.6, 1.9, 0.55, 2.5);
    build('headboard', -0.6, -7.78, 1.9, 1.3, 0.18, false);
    build('dresser', -3.45, -7.3, 1.2, 1.1, 0.6);
    build('nightstand', 0.9, -7.5, 0.5, 0.6, 0.5);
    build('wardrobe', 2.45, -5, 0.9, 2.4, 0.6, true, -side);
    build('foyer table', 1.9, 7.35, 1, 0.85, 0.5, true, Math.PI);
    const clock = build('clock', -2, 7.4, 0.55, 2.6, 0.55, true, Math.PI);
    this._clockFace(clock.group);
    build('hall table', 2.2, 1.62, 1.2, 0.85, 0.4, true, Math.PI);

    // Portraits
    this._portrait(-4.5, 1.7, -0.855, 0);
    this._portrait(3.6, 1.7, 1.855, Math.PI);
    this._portrait(-1.6, 1.8, 7.855, Math.PI);
    this._portrait(-9.855, 1.7, 0.5, Math.PI / 2);

    // Windows (frame + moonlit glass)
    this._window(-9.86, 4.5, Math.PI / 2);
    this._window(-9.86, -4.5, Math.PI / 2);
    this._window(9.86, 5.0, -Math.PI / 2, true);
    this._windowNorth(-6.5);
    this._windowNorth(8.0);

    // Dying candles — tiny warm islands in the dark
    this._candle(-7.5, 0.78, -6.35);  // study desk
    this._candle(7.4, 0.78, 4.7);     // dining table
    this._candle(0.9, 0.6, -7.45);    // bedroom nightstand

    // Cobwebs in the high corners
    if (!this.lowDetail) {
      this._cobweb(-9.6, 2.6, -7.6, Math.PI / 4);
      this._cobweb(9.6, 2.6, -7.6, -Math.PI / 4);
      this._cobweb(2.7, 2.6, -1.4, -Math.PI / 4);
    }
    this._cobweb(-9.6, 2.6, 7.6, 3 * Math.PI / 4);
    this._cobweb(-3.7, 2.65, 2.4, 3 * Math.PI / 4);
  }

  _clockFace(group) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ad9571';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = ctx.fillStyle = '#392b20';
    ctx.font = '15px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [index, mark] of ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].entries()) {
      const a = index * Math.PI / 6;
      ctx.fillText(mark, 64 + Math.sin(a) * 45, 64 - Math.cos(a) * 45);
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(41, 81);
    ctx.lineTo(64, 64);
    ctx.lineTo(77, 29);
    ctx.stroke();
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24),
      new THREE.MeshStandardMaterial({ map, roughness: 0.86 }));
    face.position.set(0, 2.1, 0.294);
    group.add(face);
  }

  _candle(x, y, z) {
    const g = new THREE.Group();
    if (!this.candleParts) {
      this.candleParts = {
        wax: new THREE.CylinderGeometry(0.021, 0.027, 0.13, 9),
        holder: new THREE.LatheGeometry([
          new THREE.Vector2(0, 0), new THREE.Vector2(0.067, 0),
          new THREE.Vector2(0.059, 0.011), new THREE.Vector2(0.028, 0.017),
          new THREE.Vector2(0.023, 0.038), new THREE.Vector2(0.041, 0.049),
          new THREE.Vector2(0.037, 0.057), new THREE.Vector2(0, 0.057),
        ], 12),
        flame: new THREE.SphereGeometry(0.013, 8, 6).scale(0.78, 1.65, 0.78),
        waxMaterial: new THREE.MeshStandardMaterial({ color: 0xa99b82, roughness: 0.88 }),
        wickMaterial: new THREE.MeshStandardMaterial({ color: 0x231b14, roughness: 1 }),
        flameMaterial: new THREE.MeshBasicMaterial({ color: 0xffb95c }),
      };
    }
    const parts = this.candleParts;
    const wax = new THREE.Mesh(parts.wax, parts.waxMaterial);
    wax.position.y = 0.118;
    const holder = new THREE.Mesh(parts.holder, this.mats.agedBrass);
    const flame = new THREE.Mesh(parts.flame, parts.flameMaterial);
    flame.position.set(0.003, 0.21, 0);
    const wick = new THREE.Mesh(this.unitBox, parts.wickMaterial);
    wick.scale.set(0.006, 0.016, 0.006);
    wick.position.y = 0.184;
    boxes(g, this.roundPart, parts.waxMaterial, [
      [0.021, 0.119, -0.003, 0.01, 0.087, 0.012],
      [-0.017, 0.147, 0.01, 0.011, 0.058, 0.012],
    ]);
    g.add(wax, flame, holder, wick);
    g.position.set(x, y, z);
    const light = new THREE.PointLight(0xffa04d, 1.22, 4.1, 2);
    light.position.y = 0.2;
    g.add(light);
    light.userData.base = light.intensity;
    light.userData.walk = Math.random() * 100;
    light.userData.flame = flame;
    this.scene.add(g);
    this.candles.push(light);
  }

  _cobweb(x, y, z, ry) {
    if (!this.webMaterial) {
      this.webGeometry = new THREE.PlaneGeometry(0.95, 0.95);
      this.webMaterial = new THREE.MeshBasicMaterial({
        map: TX.cobweb(), transparent: true, opacity: 0.44,
        side: THREE.DoubleSide, depthWrite: false,
      });
    }
    const web = new THREE.Mesh(this.webGeometry, this.webMaterial);
    web.scale.set(0.92 + Math.abs(Math.sin(x)) * 0.24, 0.88 + Math.abs(Math.sin(z)) * 0.18, 1);
    web.position.set(x, y, z);
    web.rotation.y = ry;
    this.scene.add(web);
  }

  _portrait(x, y, z, ry) {
    const g = new THREE.Group();
    if (!this.portraitMaterial) {
      this.portraitGeometry = new THREE.PlaneGeometry(0.68, 0.88);
      this.portraitMaterial = new THREE.MeshStandardMaterial({
        map: TX.portrait(), roughness: 0.88,
      });
    }
    boxes(g, this.unitBox, this.mats.wood, frameBars(0, 0, 0.025, 0.82, 1.02, 0.084, 0.056));
    boxes(g, this.unitBox, this.mats.agedBrass, [
      ...frameBars(0, 0, 0.052, 0.73, 0.93, 0.018, 0.014),
      ...frameBars(0, 0, 0.052, 0.805, 1.005, 0.012, 0.015),
    ]);
    const art = new THREE.Mesh(this.portraitGeometry, this.portraitMaterial);
    art.position.z = 0.036;
    g.add(art);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    this.scene.add(g);
  }

  _window(x, z, ry, eastWall = false) {
    this._windowAt(new THREE.Vector3(x, 1.7, z), ry, new THREE.Vector3(eastWall ? -0.6 : 0.6, 0.3, 0));
  }

  _windowNorth(x) {
    this._windowAt(new THREE.Vector3(x, 1.7, -7.86), 0, new THREE.Vector3(0, 0.3, 0.6));
  }

  _windowAt(pos, ry, lightOffset) {
    const g = new THREE.Group();
    if (!this.windowGlass) {
      const map = TX.oldGlass();
      this.windowGlass = new THREE.MeshStandardMaterial({
        map, emissiveMap: map, emissive: 0x9ab0da, emissiveIntensity: 0.55, roughness: 0.71,
      });
      this.windowPane = new THREE.PlaneGeometry(1.05, 1.43);
    }
    const glass = new THREE.Mesh(this.windowPane, this.windowGlass);
    glass.position.z = 0.035;
    g.add(glass);
    boxes(g, this.unitBox, this.mats.wood, [
      ...frameBars(0, 0, 0.03, 1.2, 1.6, 0.092, 0.074),
      [0, -0.81, 0.067, 1.28, 0.074, 0.17],
    ]);
    boxes(g, this.unitBox, this.mats.trim, [
      ...frameBars(0, 0, 0.067, 1.105, 1.5, 0.025, 0.025),
      [0, 0, 0.059, 0.045, 1.42, 0.038],
      [0, -0.26, 0.059, 1.05, 0.041, 0.038],
      [0, 0.26, 0.059, 1.05, 0.041, 0.038],
    ]);
    g.position.copy(pos);
    g.rotation.y = ry;
    this.scene.add(g);

    const light = new THREE.PointLight(0x44587e, 3.1, 6.5, 1.8);
    light.position.copy(pos).add(lightOffset);
    light.userData.base = light.intensity;
    this.scene.add(light);
    this.windowLights.push(light);
  }

  /* ---------------- lights ---------------- */

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x343e54, 0x1c1510, 0.24);
    this.scene.add(hemi);
    this.hemi = hemi;
    hemi.userData.base = hemi.intensity;

    this._bulb(0, 2.62, 5.2, 0xffb377, 2.05);   // foyer
    this._bulb(0, 2.62, 0.5, 0xffc18c, 1.56);   // hallway
  }

  _bulb(x, y, z, color, intensity) {
    const light = new THREE.PointLight(color, intensity, 7.5, 1.9);
    light.position.set(x, y, z);
    light.userData.base = intensity;
    light.userData.walk = Math.random() * 100;
    this.scene.add(light);
    if (!this.bulbParts) {
      this.bulbParts = {
        cord: new THREE.CylinderGeometry(0.01, 0.01, 1, 6),
        shade: new THREE.CylinderGeometry(0.045, 0.16, 0.09, 12, 1, true),
        bulb: new THREE.SphereGeometry(0.045, 10, 8).scale(0.86, 1.28, 0.86),
        shadeMaterial: new THREE.MeshStandardMaterial({
          color: 0x645441, metalness: 0.45, roughness: 0.77, side: THREE.DoubleSide,
        }),
      };
    }
    const parts = this.bulbParts;
    const shade = new THREE.Mesh(parts.shade, parts.shadeMaterial);
    shade.position.set(x, y + 0.085, z);
    this.scene.add(shade);
    const cord = new THREE.Mesh(parts.cord, this.mats.sinkInterior);
    cord.scale.y = WALL_H - y + 0.1;
    cord.position.set(x, (WALL_H + y) / 2, z);
    this.scene.add(cord);
    const bulbMesh = new THREE.Mesh(parts.bulb,
      new THREE.MeshStandardMaterial({ color: 0x332211, emissive: color, emissiveIntensity: 1.4 }));
    bulbMesh.position.set(x, y, z);
    this.scene.add(bulbMesh);
    light.userData.mesh = bulbMesh;
    this.bulbs.push(light);
  }

  /* ---------------- items ---------------- */

  _buildItems() {
    // key locations are randomized per room — no two runs match
    const pick = (spots) => spots[Math.floor(Math.random() * spots.length)];
    const kitchenSpot = pick([[8.9, 1.03, -7.3], [5.6, 0.86, -3.6], [9.5, 1.03, -5.6]]);
    const studySpot = pick([[-6.7, 0.86, -6.2], [-7.1, 1.03, -5.2], [-8.9, 0.1, -7.4]]);
    const bedroomSpot = pick([[-3.45, 1.18, -7.25], [0.9, 0.68, -7.5], [-0.6, 0.63, -6.2]]);
    this._key(...kitchenSpot, 'kitchen');
    this._key(...studySpot, 'study');
    this._key(...bedroomSpot, 'bedroom');

    // spare batteries — ammunition for the light
    this._battery(-6.9, 0.49, 4.2);   // living coffee table
    this._battery(6.0, 0.83, 5.1);    // dining table
    this._battery(2.0, 0.91, 1.62);   // hallway table
    this._battery(9.5, 1.0, -6.7);    // kitchen counter

    this._note(1.9, 0.785, 7.3,
      'They sealed every window from the outside.\n\nThe front door has three locks now. I hid the keys somewhere in the kitchen, the study, the bedroom — I keep moving them so HE cannot gather them.\n\nIf you are reading this — do not let him hear you run.');
    this._note(-7.4, 0.795, -6.3,
      'Night 41.\n\nHe cannot stand the light. Hold your beam on him — HOLD IT, do not blink — and he comes apart like smoke.\n\nBut the light eats batteries, and taking what is his only makes him angrier. The last key wakes him fully.\n\nGod forgive me, I am going to try tonight.');
  }

  _battery(x, y, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 0.11, 10),
      new THREE.MeshStandardMaterial({ color: 0x202428, roughness: 0.5, metalness: 0.4 })
    );
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.033, 0.033, 0.025, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a2018, roughness: 0.4, metalness: 0.3, emissive: 0x220503 })
    );
    cap.position.y = 0.055;
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.012, 8),
      new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.9, roughness: 0.3 })
    );
    tip.position.y = 0.073;
    g.add(body, cap, tip);
    g.rotation.z = Math.PI / 2 - 0.12;
    g.rotation.y = Math.random() * Math.PI;
    g.position.set(x, y + 0.035, z);
    if (this.batteryGlints) g.add(new THREE.PointLight(0x664433, 0.35, 1.1, 2));
    for (const child of [body, cap, tip]) {
      child.userData.interact = { type: 'battery', group: g };
      this.interactables.push(child);
    }
    this.scene.add(g);
  }

  removeBattery(group) {
    this.scene.remove(group);
    this.interactables = this.interactables.filter(m => m.userData.interact?.group !== group);
    group.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      object.material.dispose();
    });
  }

  _key(x, y, z, id) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.13, 8), this.mats.brass);
    shaft.rotation.z = Math.PI / 2;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.011, 8, 14), this.mats.brass);
    bow.position.x = -0.08;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.035, 0.012), this.mats.brass);
    tooth.position.set(0.05, -0.026, 0);
    g.add(shaft, bow, tooth);
    g.position.set(x, y, z);
    g.userData.baseY = y;
    g.userData.id = id;
    g.userData.spin = Math.random() * Math.PI * 2;
    // a faint glint so keys are findable in the dark
    const glint = new THREE.PointLight(0xaa8833, 0.55, 1.6, 2);
    g.add(glint);
    this.scene.add(g);
    this.keys.push(g);
  }

  _note(x, y, z, text) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.36), this.mats.paper);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = (Math.random() - 0.5) * 0.8;
    mesh.position.set(x, y, z);
    mesh.userData.interact = { type: 'note', text };
    this.scene.add(mesh);
    this.interactables.push(mesh);
  }

  removeKey(group) {
    const index = this.keys.indexOf(group);
    if (index < 0) return false;
    this.keys.splice(index, 1);
    this.scene.remove(group);
    group.traverse((object) => {
      if (object.isMesh) object.geometry.dispose();
    });
    if (!this.keys.length) this.mats.brass.dispose();
    return true;
  }

  _buildKeyOccluders() {
    const moving = new Set(this.doors.map(door => door.mesh));
    moving.add(this.props.kitchenChairOccluder);
    this.keyOccluders = this.scareOccluders.map(mesh => {
      mesh.geometry.computeBoundingBox();
      mesh.updateWorldMatrix(true, false);
      return {
        mesh,
        bounds: mesh.geometry.boundingBox,
        inverse: mesh.matrixWorld.clone().invert(),
        moving: moving.has(mesh),
      };
    });
    this.keyPathRay = new THREE.Ray();
    this.keyPathHit = new THREE.Vector3();
  }

  keyPathBlocked(origin, target) {
    const ray = this.keyPathRay;
    for (const { mesh, bounds, inverse, moving } of this.keyOccluders) {
      if (moving) {
        mesh.updateWorldMatrix(true, false);
        inverse.copy(mesh.matrixWorld).invert();
      }
      ray.origin.copy(origin).applyMatrix4(inverse);
      if (bounds.containsPoint(ray.origin)) return true;
      ray.direction.copy(target).applyMatrix4(inverse).sub(ray.origin);
      // The direction spans exactly one segment. Ignore hits past its endpoint.
      if (ray.intersectBox(bounds, this.keyPathHit) &&
          ray.origin.distanceToSquared(this.keyPathHit) <= ray.direction.lengthSq()) return true;
    }
    return false;
  }

  /* ---------------- dust ---------------- */

  _buildDust(N) {
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = BOUNDS.minX + Math.random() * 20;
      pos[i * 3 + 1] = Math.random() * 2.8;
      pos[i * 3 + 2] = BOUNDS.minZ + Math.random() * 16;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 14);
    const mat = new THREE.PointsMaterial({
      color: 0x9999aa, size: 0.018, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);
  }

  /* ---------------- runtime ---------------- */

  getColliders() {
    const out = this.colliders;
    out.length = this.staticColliders.length;
    for (const d of this.doors) {
      const box = d.aabb();
      if (box) out.push(box);
    }
    return out;
  }

  flickerAll(duration) { this.flickerTime = Math.max(this.flickerTime, duration); }

  /** Lightning outside the windows — works even during the blackout. */
  lightningFlash() { this.lightningTime = 0.55; }

  setBlackout(on) {
    this.blackout = on;
    for (const l of this.electricLights) l.intensity = on ? 0 : l.userData.base;
    this.hemi.intensity = on ? 0.05 : this.hemi.userData.base;
    for (const b of this.bulbs) if (b.userData.mesh) b.userData.mesh.material.emissiveIntensity = on ? 0 : 1.4;
  }

  update(dt, t) {
    for (const d of this.doors) d.update(dt);

    // key shimmer
    for (const k of this.keys) {
      k.rotation.y += dt * 1.2;
      k.position.y = k.userData.baseY + Math.sin(t * 2 + k.userData.spin) * 0.012;
    }

    // light behavior
    if (this.flickerTime > 0) {
      this.flickerTime -= dt;
      for (const l of this.electricLights) {
        l.intensity = Math.random() < 0.45 ? 0 : l.userData.base * (0.3 + Math.random());
        if (l.userData.mesh) l.userData.mesh.material.emissiveIntensity = l.intensity > 0 ? 1.4 : 0;
      }
      if (this.flickerTime <= 0 && !this.blackout) {
        for (const l of this.electricLights) {
          l.intensity = l.userData.base;
          if (l.userData.mesh) l.userData.mesh.material.emissiveIntensity = 1.4;
        }
      }
    } else if (!this.blackout) {
      // idle organic bulb wobble
      for (const b of this.bulbs) {
        b.userData.walk += dt;
        const n = Math.sin(b.userData.walk * 7.3) * Math.sin(b.userData.walk * 3.1 + 1.7);
        b.intensity = b.userData.base * (0.82 + 0.18 * n) * (Math.random() < 0.003 ? 0.15 : 1);
      }
    }

    // lightning overrides everything at the windows
    if (this.lightningTime > 0) {
      this.lightningTime -= dt;
      // double-strobe pattern
      const phase = 0.55 - this.lightningTime;
      const on = (phase < 0.12) || (phase > 0.22 && phase < 0.38);
      for (const l of this.windowLights) {
        l.intensity = on ? l.userData.base * 11 : (this.blackout ? 0 : l.userData.base);
        l.color.setHex(on ? 0xb8c8ee : 0x44587e);
      }
      if (this.lightningTime <= 0) {
        for (const l of this.windowLights) {
          l.intensity = this.blackout ? 0 : l.userData.base;
          l.color.setHex(0x44587e);
        }
      }
    }

    // candle flames never die — they gutter
    for (const c of this.candles) {
      c.userData.walk += dt;
      const n = Math.sin(c.userData.walk * 11.7) * Math.sin(c.userData.walk * 5.3 + 0.9);
      c.intensity = c.userData.base * (0.7 + 0.3 * n);
      const f = c.userData.flame;
      f.scale.set(1 + n * 0.25, 1 + Math.abs(n) * 0.4, 1 + n * 0.25);
      f.rotation.z = n * 0.18;
    }

    // dust drift
    const p = this.dust.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) - dt * 0.045;
      if (y < 0.05) y = 2.8;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(t * 0.6 + i) * dt * 0.012);
    }
    p.needsUpdate = true;
  }
}
