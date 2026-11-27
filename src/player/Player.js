import * as THREE from 'three';
import { flashlightCookie } from '../world/Textures.js';

const EYE_HEIGHT = 1.62;
const RADIUS = 0.32;
const WALK_SPEED = 2.3;
const SPRINT_SPEED = 4.3;
const FLASHLIGHT = {
  intensity: 32,   // Intensidade luminosa no centro do feixe.
  range: 24.7,     // Distância máxima que a luz alcança no cenário.
  angle: 0.75,     // Meio-ângulo do cone em radianos, medido a partir do eixo.
  penumbra: 0.65,  // Fração do cone usada para suavizar as bordas.
  decay: 2,        // Atenuação com a distância, seguindo a queda quadrática.
};
const DRAIN_PER_SEC = 0.55;   // idle flashlight drain
const BURN_DRAIN_PER_SEC = 5; // extra drain while burning him

export class Player {
  constructor(camera, domElement, audio) {
    this.camera = camera;
    this.dom = domElement;
    this.audio = audio;

    this.position = new THREE.Vector3(0, EYE_HEIGHT, 6.4);
    this.yaw = 0;                  // facing north (-z), into the house
    this.pitch = 0;
    this.velocity = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.beamDirection = new THREE.Vector3();
    this.camera.rotation.order = 'YXZ';
    this.keys = {};
    this.enabled = false;
    this.bobPhase = 0;
    this.stepDistance = 0;
    this.stepSide = 1;
    this.flashlightOn = true;
    this.flickerTime = 0;
    this.battery = 100;
    this.burning = false;

    this._buildFlashlight();
    this._bindInput();
  }

  _buildFlashlight() {
    const { intensity, range, angle, penumbra, decay } = FLASHLIGHT;
    this.flashlight = new THREE.SpotLight(0xfff2d8, intensity, range, angle, penumbra, decay);
    this.flashlight.map = flashlightCookie();
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.bias = -0.004;
    this.flashTarget = new THREE.Object3D();
    this.flashlight.target = this.flashTarget;
  }

  addTo(scene) {
    scene.add(this.flashlight);
    scene.add(this.flashTarget);
  }

  _bindInput() {
    this.inputEvents = new AbortController();
    const options = { signal: this.inputEvents.signal };
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyF' && !e.repeat && this.enabled) {
        if (!this.flashlightOn && this.battery <= 0) {
          this.audio?.click();
          return; // dead cell — nothing happens
        }
        this.flashlightOn = !this.flashlightOn;
        this.audio?.click();
      }
    }, options);
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; }, options);
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    }, options);
  }

  dispose() { this.enabled = false; this.keys = {}; this.inputEvents?.abort(); }

  get isMoving() {
    return this.keys['KeyW'] || this.keys['KeyA'] || this.keys['KeyS'] || this.keys['KeyD'];
  }

  get isSprinting() {
    return this.isMoving && (this.keys['ShiftLeft'] || this.keys['ShiftRight']);
  }

  get beamActive() { return this.flashlightOn && this.battery > 0; }

  addBattery(amount) {
    this.battery = Math.min(100, this.battery + amount);
    if (!this.flashlightOn) this.flashlightOn = true;
  }

  flashlightFlicker(duration = 0.8) { this.flickerTime = Math.max(this.flickerTime, duration); }

  update(dt, colliders) {
    if (!this.enabled) {
      this._updateCamera(0);
      this._updateFlashlight(dt);
      return;
    }

    // --- battery ---
    if (this.flashlightOn && this.battery > 0) {
      this.battery -= dt * (DRAIN_PER_SEC + (this.burning ? BURN_DRAIN_PER_SEC : 0));
      if (this.battery <= 0) {
        this.battery = 0;
        this.flashlightOn = false;
        this.audio?.click();
      }
    }

    // --- movement ---
    const sprinting = this.isSprinting;
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const forward = Number(!!this.keys.KeyW) - Number(!!this.keys.KeyS);
    const right = Number(!!this.keys.KeyD) - Number(!!this.keys.KeyA);
    this.wish.set(right * cos - forward * sin, 0, -forward * cos - right * sin);
    this.wish.normalize().multiplyScalar(speed);

    // Keep each collision step small even on slow frames.
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    const stepTime = dt / steps;
    const acceleration = 1 - Math.exp(-11 * stepTime);
    const startX = this.position.x, startZ = this.position.z;
    for (let step = 0; step < steps; step++) {
      this.velocity.lerp(this.wish, acceleration);
      this.position.x += this.velocity.x * stepTime;
      this._resolveCollisions(colliders, 'x');
      this.position.z += this.velocity.z * stepTime;
      this._resolveCollisions(colliders, 'z');
    }

    // --- footsteps (alternating stereo) ---
    const moved = Math.hypot(this.position.x - startX, this.position.z - startZ);
    this.stepDistance += moved;
    const strideLen = sprinting ? 2.0 : 1.45;
    if (this.stepDistance > strideLen && moved > 0.001) {
      this.stepDistance = 0;
      this.stepSide *= -1;
      this.audio?.footstep(sprinting, this.stepSide * 0.13);
    }

    // --- head bob ---
    const speedRatio = Math.hypot(this.velocity.x, this.velocity.z) / SPRINT_SPEED;
    this.bobPhase += dt * (4 + speedRatio * 7);
    const bob = Math.sin(this.bobPhase * 2) * 0.028 * speedRatio;

    this._updateCamera(bob);
    this._updateFlashlight(dt);
  }

  _resolveCollisions(colliders, axis) {
    for (const b of colliders) {
      const cx = Math.max(b.minX, Math.min(this.position.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(this.position.z, b.maxZ));
      const dx = this.position.x - cx;
      const dz = this.position.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq < RADIUS * RADIUS) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const push = RADIUS - dist;
        if (axis === 'x') this.position.x += (dx / dist) * push;
        else this.position.z += (dz / dist) * push;
      }
    }
  }

  _updateCamera(bob) {
    this.camera.position.set(this.position.x, EYE_HEIGHT + bob, this.position.z);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  _updateFlashlight(dt) {
    // Mantém o feixe paralelo à visão, com a origem ligeiramente abaixo da câmera.
    this.beamDirection.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.flashlight.position.copy(this.camera.position);
    this.flashlight.position.y -= 0.12;
    this.flashTarget.position.copy(this.flashlight.position).addScaledVector(this.beamDirection, 8);

    let intensity = this.beamActive ? FLASHLIGHT.intensity : 0;
    // weak cell sputters below 20%
    if (this.beamActive && this.battery < 20 && Math.random() < 1 - Math.pow(0.94, dt * 60)) {
      intensity *= Math.random() * 0.5;
    }
    if (this.flickerTime > 0 && this.beamActive) {
      this.flickerTime -= dt;
      if (Math.random() < 1 - Math.pow(0.6, dt * 60)) intensity = Math.random() * 8;
    }
    this.flashlight.intensity = intensity;
  }
}

export { EYE_HEIGHT, RADIUS };
