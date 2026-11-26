import * as THREE from 'three';
import { ZONES, BOUNDS } from '../world/House.js';

const APPARITION_INTERVAL = 5;
const HALL_GLIMPSES = [
  [-8.65, 0.5, -0.7, 0], [8.65, 0.5, 0.7, 0], [-0.5, -2.1, 0.45, -0.38],
  [-7.25, 1.45, -0.52, 0], [5.9, 1.45, 0.52, 0],
];
const STUDY_GLIMPSES = [
  [-7.15, -1.75, 0.46, -0.18], [-5.1, -3.7, 0.45, 0], [-8.6, -6.5, -0.4, 0],
  [-6.1, -6.65, 0.4, 0], [-5.05, -6.4, 0.35, 0],
];
const WINDOW_GLIMPSES = [[8.86, 5.0, 0, 0.62], [8.86, 5.65, 0, 0.54]];

function inZone(pos, z) {
  return pos.x >= z.minX && pos.x <= z.maxX && pos.z >= z.minZ && pos.z <= z.maxZ;
}

/**
 * Orchestrates dread: one-shot scripted scares per room, plus a randomized
 * ambient event scheduler that keeps the air heavy between the big hits.
 */
export class ScareDirector {
  constructor(game) {
    this.game = game;
    this.fired = new Set();
    this.ambientTimer = 9 + Math.random() * 8; // first ambient event comes early
    this.lightningTimer = 14 + Math.random() * 14;
    this.stalkTimer = 10 + Math.random() * 8; // grace period after the 2nd key
    this.chairAnim = null;
    this.time = 0;
    this.quietUntil = 0;
    this.nextApparition = 0;
    this.nextViewCheck = 0;
    this.pending = [];
    this.activeApparition = null;
    this.ray = new THREE.Raycaster();
    this.hits = [];
    this.sample = new THREE.Vector3();
    this.projected = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.spawn = new THREE.Vector3();
    this.destination = new THREE.Vector3();

    this.triggers = [
      { id: 'living', zone: ZONES.living, run: () => this._livingRoom() },
      { id: 'hallway', zone: ZONES.hallway, run: () => this._hallway() },
      { id: 'kitchen', zone: ZONES.kitchen, run: () => this._kitchen() },
      { id: 'bedroom', zone: ZONES.bedroom, run: () => this._bedroomSlam() },
      { id: 'dining', zone: ZONES.dining, run: () => this._diningWindow() },
    ];
  }

  /* ---------------- scripted one-shots ---------------- */

  _livingRoom() {
    const { audio } = this.game;
    setTimeout(() => audio.thump(0.5), 700);
    setTimeout(() => audio.whisper(-0.7), 1800);
  }

  _hallway() {
    const { audio } = this.game;
    this._queueApparition(ZONES.hallway, HALL_GLIMPSES, 6, 1.15,
      () => audio.slam(), () => audio.slam(), 0.45);
  }

  _kitchen() {
    const { audio, house } = this.game;
    this.quietUntil = this.time + 1.15;
    audio.stinger(0.8);
    // the chair drags itself away from the table
    const chair = house.props.kitchenChair;
    if (chair) {
      audio.chairScrape();
      this.chairAnim = { mesh: chair, t: 0, from: chair.position.clone(), to: chair.position.clone().add(new THREE.Vector3(-1.4, 0, 0.7)) };
    }
  }

  _bedroomSlam() {
    const { audio, house } = this.game;
    this.quietUntil = this.time + 1;
    const door = house.props.bedroomDoor;
    door.setOpen(false, 14); // slam shut
    setTimeout(() => {
      if (this.game.state === 'playing') audio.slam();
    }, 160);
  }

  _diningWindow() {
    this._queueApparition(ZONES.dining, WINDOW_GLIMPSES, 10, 1.15,
      () => this.game.audio.stinger(0.42));
  }

  /** Called by Game when the study key is picked up. */
  studyKeyScare() {
    if (this.fired.has('studyKey')) return;
    this.fired.add('studyKey');
    const { audio, keysFound } = this.game;
    this._queueApparition(ZONES.study, STUDY_GLIMPSES, keysFound >= 3 ? 1.2 : 9, 1.05,
      () => {
        audio.staticBurst(0.2);
        audio.stinger(0.8);
      }, null, 0, true);
  }

  _queueApparition(zone, positions, timeout, duration, cue, fallback = null, delay = 0, priority = false) {
    const event = { zone, positions, duration, cue, fallback, ready: this.time + delay, expires: this.time + timeout };
    if (priority) this.pending.unshift(event);
    else this.pending.push(event);
  }

  _hasClearView(x, z, y) {
    const { camera, house } = this.game;
    this.sample.set(x, y, z);
    this.projected.copy(this.sample).project(camera);
    if (this.projected.z < -1 || this.projected.z > 1 ||
        Math.abs(this.projected.x) > 0.74 || Math.abs(this.projected.y) > 0.88) return false;
    this.direction.subVectors(this.sample, camera.position);
    const distance = this.direction.length();
    this.ray.set(camera.position, this.direction.multiplyScalar(1 / distance));
    this.ray.far = distance - 0.14;
    this.hits.length = 0;
    this.ray.intersectObjects(house.scareOccluders, false, this.hits);
    return this.hits.length === 0;
  }

  _findApparitionPosition(event) {
    const { camera, house, scene } = this.game;
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    const colliders = house.getColliders();
    for (const [x, z, dx, dz] of event.positions) {
      const distance = Math.hypot(camera.position.x - x, camera.position.z - z);
      if (distance < 1.65 || distance > 10) continue;
      if (colliders.some(box => x > box.minX - 0.25 && x < box.maxX + 0.25 &&
          z > box.minZ - 0.25 && z < box.maxZ + 0.25)) continue;
      if (!this._hasClearView(x, z, 1.62) || !this._hasClearView(x, z, 2.58)) continue;
      this.spawn.set(x, 0, z);
      this.destination.set(x + dx, 0, z + dz);
      return true;
    }
    return false;
  }

  _updateApparitions(playerPos) {
    const { ghost, player, hud, chaseActive } = this.game;
    if (ghost.mode !== 'apparition') this.activeApparition = null;
    const free = !this.activeApparition && this.time >= this.quietUntil;
    const checkView = this.time >= this.nextViewCheck;
    for (let i = 0; i < this.pending.length; i++) {
      const event = this.pending[i];
      if (this.time >= event.expires) {
        if (event.fallback && !free) continue;
        this.pending.splice(i--, 1);
        if (event.fallback) {
          event.fallback();
          this.quietUntil = this.time + 0.8;
          return;
        }
        continue;
      }
      if (!free || this.time < this.nextApparition || this.time < event.ready ||
          !checkView || !player.enabled || hud.noteOpen || chaseActive || ghost.mode !== 'hidden' ||
          !inZone(playerPos, event.zone)) continue;
      this.nextViewCheck = this.time + 0.08;
      if (!this._findApparitionPosition(event)) continue;
      this.pending.splice(i, 1);
      this.activeApparition = event;
      this.nextApparition = this.time + APPARITION_INTERVAL;
      ghost.appearAt(this.spawn, event.duration, this.destination);
      return;
    }
  }

  onRendered() {
    const event = this.activeApparition;
    if (event?.cue && this.game.ghost.mode === 'apparition') {
      event.cue();
      event.cue = null;
    }
  }

  /* ---------------- ambient dread ---------------- */

  _ambientEvent() {
    const { audio, house, player } = this.game;
    const roll = Math.random();
    if (roll < 0.3) audio.whisper(Math.random() * 2 - 1);
    else if (roll < 0.55) audio.creak(0.5 + Math.random() * 0.4);
    else if (roll < 0.75) audio.thump(0.2 + Math.random() * 0.25);
    else if (roll < 0.9) house.flickerAll(0.5 + Math.random() * 0.6);
    else player.flashlightFlicker(0.6);
  }

  /* ---------------- the storm ---------------- */

  _lightning() {
    const { audio, house, hud } = this.game;
    const close = Math.random() < 0.3;
    house.lightningFlash();
    hud.flash('#9fb2e8', close ? 0.22 : 0.1, 320);
    audio.thunder(close ? 0.45 : 1.1 + Math.random() * 1.2, close);
  }

  /* ---------------- stalking phase (after 2nd key) ---------------- */

  _maybeStartStalk(dt, playerPos) {
    const { ghost, audio, hud } = this.game;
    if (this.game.keysFound < 2 || this.game.chaseActive ||
        (ghost.mode !== 'hidden' && ghost.mode !== 'apparition')) return;
    this.stalkTimer -= dt;
    if (this.stalkTimer > 0) return;
    this.stalkTimer = 24 + Math.random() * 20;
    // he manifests ~8m away and drifts toward you
    const a = Math.random() * Math.PI * 2;
    const x = THREE.MathUtils.clamp(playerPos.x + Math.cos(a) * 8, BOUNDS.minX + 1, BOUNDS.maxX - 1);
    const z = THREE.MathUtils.clamp(playerPos.z + Math.sin(a) * 8, BOUNDS.minZ + 1, BOUNDS.maxZ - 1);
    ghost.startStalk(new THREE.Vector3(x, 0, z), 18);
    audio.growl();
    audio.staticBurst(0.25);
    hud.toast('He is here. Burn him with the light.', 2800);
  }

  /* ---------------- update ---------------- */

  update(dt, playerPos) {
    this.time += dt;
    for (const t of this.triggers) {
      if (!this.fired.has(t.id) && inZone(playerPos, t.zone)) {
        if ((t.id === 'kitchen' || t.id === 'bedroom') && this.game.ghost.mode === 'apparition') continue;
        this.fired.add(t.id);
        t.run();
      }
    }

    // rolling storm outside, all game long
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0 && this.game.ghost.mode !== 'apparition') {
      this._lightning();
      this.lightningTimer = 16 + Math.random() * 26;
    }

    this._maybeStartStalk(dt, playerPos);
    this._updateApparitions(playerPos);

    if (!this.game.chaseActive) {
      this.ambientTimer -= dt;
      if (this.ambientTimer <= 0 && this.game.ghost.mode !== 'apparition') {
        this._ambientEvent();
        this.ambientTimer = 16 + Math.random() * 18;
      }
    }

    if (this.chairAnim) {
      const a = this.chairAnim;
      a.t = Math.min(1, a.t + dt / 0.9);
      const ease = 1 - Math.pow(1 - a.t, 3);
      a.mesh.position.lerpVectors(a.from, a.to, ease);
      a.mesh.rotation.y = ease * 0.9;
      if (a.t >= 1) this.chairAnim = null;
    }
  }
}
