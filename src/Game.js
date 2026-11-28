import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { House } from './world/House.js';
import { ghostFaceDataURL } from './world/Textures.js';
import { EYE_HEIGHT, Player } from './player/Player.js';
import { AudioEngine } from './systems/AudioEngine.js';
import { Ghost } from './systems/Ghost.js';
import { ScareDirector } from './systems/ScareDirector.js';
import { HUD } from './ui/HUD.js';

const TOTAL_KEYS = 3;
const KEY_PICKUP_DISTANCE = 1.2;
const KEY_PICKUP_DISTANCE_SQUARED = KEY_PICKUP_DISTANCE ** 2;
const BURN_RANGE = 10;       // how far the beam reaches him
const BATTERY_REFILL = 45;
const canvasOwner = new WeakMap();
const GRAPHICS = {
  low: { scale: 0.65, maxRatio: 0.75, pixels: 900000, shadowSize: 256, shadowInterval: 1 / 30, bloomScale: 0, dust: 64, smoke: 16, lowDetail: true },
  medium: { scale: 0.82, maxRatio: 1.1, pixels: 1700000, shadowSize: 512, bloomScale: 0.5, dust: 144, smoke: 32 },
  high: { scale: 1, maxRatio: 1.75, pixels: 3700000, shadowSize: 1024, bloomScale: 1, dust: 240, smoke: 50 },
};

export class Game {
  constructor(canvas, { quality = 'medium', showFPS = false } = {}) {
    this.canvas = canvas;
    canvasOwner.set(canvas, this);
    this.graphics = GRAPHICS[quality] ?? GRAPHICS.medium;
    this.showFPS = showFPS;
    this.statsElapsed = 0;
    this.statsFrames = 0;
    this.promptTimer = 0;
    this.audioTimer = 0;
    this.rayCenter = new THREE.Vector2();
    this.rayHits = [];
    this.keyReachOrigin = new THREE.Vector3();
    this.keyReachTarget = new THREE.Vector3();
    this.toGhost = new THREE.Vector3();
    this.viewDirection = new THREE.Vector3();
    this.shadowPosition = new THREE.Vector3(Infinity, 0, 0);
    this.shadowTarget = new THREE.Vector3();
    this.shadowChair = new THREE.Vector3();
    this.lastShadowUpdate = -Infinity;
    this.state = 'title'; // title | playing | caught | escaped
    this.keysFound = 0;
    this.chaseActive = false;
    this.escaping = false;
    this.startTime = 0;
    this.banishes = 0;
    this.events = new AbortController();
    this.debugStartup = new URLSearchParams(location.search).has('debugStartup');
    this.startupStage = 'idle';
  }

  _trace(stage) {
    this.startupStage = stage;
    if (!this.debugStartup) return;
    console.info('[startup]', stage);
    window.dispatchEvent(new CustomEvent('bridge-startup', { detail: { stage, game: this } }));
  }

  _initialize() {
    this._trace('renderer');
    this._setupRenderer();
    this._trace('scene');
    this._setupScene();

    this.hud = new HUD();
    this._trace('house');
    this.house = new House(this.scene, this.graphics.dust, this.graphics.bloomScale > 0, this.graphics.lowDetail);
    this._trace('player');
    this.player = new Player(this.camera, this.canvas, this.audio);
    this.player.addTo(this.scene);
    this.player.flashlight.shadow.mapSize.setScalar(this.graphics.shadowSize);
    this._trace('monster');
    this.ghost = new Ghost(this.scene, this.graphics.smoke);
    this.director = new ScareDirector(this);

    this._trace('composer');
    this._setupComposer();
    this._resize();

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 2.6;

    this.clock = new THREE.Clock();
    // Prepare the real camera/beam even if mouse capture needs another click.
    this.player.update(0, this.house.getColliders());
  }

  /* ---------------- setup ---------------- */

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.graphics.bloomScale === 1,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = this.graphics.shadowSize === 256
      ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    window.addEventListener('resize', () => {
      this._resize();
      if (this.state !== 'playing') this._render(0);
    }, { signal: this.events.signal });
  }

  _resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio * this.graphics.scale,
      this.graphics.maxRatio, Math.sqrt(this.graphics.pixels / (width * height)));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(width, height);
      this.bloom.setSize(width * ratio * this.graphics.bloomScale, height * ratio * this.graphics.bloomScale);
    }
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.085);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 60);
  }

  _setupComposer() {
    if (!this.graphics.bloomScale) return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // subtle bloom: candle flames, key glints, his eyes
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.7, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _bindEvents() {
    const pauseScreen = document.getElementById('pause-screen');
    const pauseStatus = document.getElementById('pause-status');
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this._trace(locked ? 'pointer-lock-acquired' : 'pointer-lock-released');
      clearTimeout(this.lockTimer); this.lockPending = false;
      if (!this.player) return;
      this.player.enabled = locked && this.state === 'playing';
      this.player.keys = {};
      this.clock?.getDelta();
      pauseStatus.textContent = '';
      pauseScreen.classList.toggle('hidden', locked || this.state !== 'playing');
    }, { signal: this.events.signal });
    document.addEventListener('pointerlockerror', () => this._showPointerLockRetry(), { signal: this.events.signal });
    pauseScreen.addEventListener('click', () => this._requestPointerLock(), { signal: this.events.signal });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && !e.repeat && this.state === 'playing' && this.player?.enabled) {
        if (this.hud.noteOpen) this.hud.hideNote();
        else this._tryInteract();
      }
    }, { signal: this.events.signal });
    document.getElementById('retry-btn').addEventListener('click', () => this._restart(), { signal: this.events.signal });
    document.getElementById('again-btn').addEventListener('click', () => this._restart(), { signal: this.events.signal });
  }

  _requestPointerLock() {
    if (this.lockPending || document.pointerLockElement === this.canvas) return;
    this._trace('pointer-lock-request');
    this.lockPending = true;
    try {
      if (typeof this.canvas.requestPointerLock !== 'function') throw new Error('Pointer Lock is not supported by this browser.');
      // Browsers can report rejection by event or promise.
      this.canvas.requestPointerLock()?.then(() => {
        if (canvasOwner.get(this.canvas) === this && this.state === 'failed' && document.pointerLockElement === this.canvas) document.exitPointerLock();
      }).catch(error => this._showPointerLockRetry(error));
      this.lockTimer = setTimeout(() => {
        if (document.pointerLockElement !== this.canvas) this._showPointerLockRetry(new Error('Mouse capture timed out.'));
      }, 3000);
    } catch (error) {
      this._showPointerLockRetry(error);
    }
  }

  _showPointerLockRetry(error) {
    clearTimeout(this.lockTimer); this.lockPending = false;
    this.lockError = error?.message ?? 'The browser denied mouse capture.';
    this._trace('pointer-lock-failed');
    if (this.state === 'playing' && document.pointerLockElement !== this.canvas) {
      this.player.enabled = false; this.player.keys = {};
      document.getElementById('pause-screen').classList.remove('hidden');
      document.getElementById('pause-status').textContent =
        'The game is ready, but the browser could not capture the mouse. Click to retry. Allow mouse capture and use a desktop browser. In an embedded preview, open the game URL in its own tab.';
    }
  }

  /* ---------------- flow ---------------- */

  start() {
    if (this.state !== 'title') return;
    this._trace('start');
    this.state = 'starting';
    this._bindEvents();
    // Request within the original trusted click, BEFORE expensive procedural setup
    // and without awaiting anything. Old browsers may return void, newer ones a promise.
    this._requestPointerLock();
    this._trace('audio');
    this.audio = AudioEngine.optional(error => {
      console.warn('Audio unavailable; continuing without sound:', error);
      this._trace('audio-unavailable');
    });
    this.audio.resume();
    this._initialize();
    // Keep the title and its retry path active until WebGL produces a frame.
    this._trace('first-render');
    this._render(0);
    this.state = 'playing';
    this._trace('state-playing');
    this.player.enabled = document.pointerLockElement === this.canvas;
    this.startTime = performance.now();
    this.audio.startAmbient();
    this.hud.show();
    this.hud.showPerformance(this.showFPS);
    this.hud.setObjective('Find the three brass keys');
    this.hud.setKeys(0, TOTAL_KEYS);
    this.hud.setBattery(this.player.battery);
    this.renderer.setAnimationLoop(() => this._tick());
    this._trace('render-loop-started');
    if (!this.player.enabled && !this.lockPending) this._showPointerLockRetry();
    // an unwelcome welcome
    this.welcomeCreak = setTimeout(() => this.audio.doorCreak(), 1200);
    this.welcomeThump = setTimeout(() => this.audio.thump(0.3), 4200);
  }

  _onCaught() {
    if (this.state !== 'playing') return;
    this.state = 'caught';
    this.renderer.setAnimationLoop(null);
    this.hud.showPerformance(false);
    this.player.enabled = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.audio.scream();
    this.audio.stopHeartbeat();
    this.audio.stopChaseMusic();
    this.audio.setBreathLevel(0);
    this.audio.setSizzle(0);
    this.hud.jumpscare(ghostFaceDataURL());
    this.hud.shake();
    setTimeout(() => {
      this.hud.hideJumpscare();
      this.hud.hide();
      this.hud.setDanger(false);
      document.getElementById('death-screen').classList.remove('hidden');
    }, 1500);
  }

  _onEscaped() {
    this.state = 'escaped';
    this.renderer.setAnimationLoop(null);
    this.hud.showPerformance(false);
    this.player.enabled = false;
    this.audio.stopHeartbeat();
    this.audio.stopChaseMusic();
    this.audio.setBreathLevel(0);
    this.audio.setSizzle(0);
    this.audio.setDroneIntensity(0);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    const seconds = Math.round((performance.now() - this.startTime) / 1000);
    const m = Math.floor(seconds / 60), s = seconds % 60;
    const banishLine = this.banishes > 0
      ? `<br/>You drove him back ${this.banishes} time${this.banishes === 1 ? '' : 's'} with nothing but a flashlight.`
      : '';
    document.getElementById('win-stats').innerHTML =
      `You found all three keys and walked out of the dark.${banishLine}<br/>Time inside the house: ${m}:${String(s).padStart(2, '0')}`;
    this.hud.hide();
    this.hud.setDanger(false);
    document.getElementById('win-screen').classList.remove('hidden');
  }

  /* ---------------- interaction ---------------- */

  _tryInteract() {
    const hit = this._lookTarget();
    if (!hit) return;
    const info = hit.userData.interact;
    switch (info.type) {
      case 'battery':
        this.house.removeBattery(info.group);
        this.player.addBattery(BATTERY_REFILL);
        this.audio.batteryPickup();
        this.hud.toast('Fresh batteries. The light is your weapon.');
        break;
      case 'note':
        this.audio.click();
        this.hud.showNote(info.text);
        break;
      case 'door':
        this.audio.doorCreak();
        info.door.toggle();
        break;
      case 'frontdoor':
        if (this.keysFound >= TOTAL_KEYS) {
          this.audio.unlock();
          info.door.setOpen(true, 1.4);
          this.escaping = true;
          this.hud.setObjective('RUN');
        } else {
          this.audio.lockedRattle();
          this.hud.toast(`Locked tight. Three keyholes. You have ${this.keysFound} key${this.keysFound === 1 ? '' : 's'}.`);
        }
        break;
    }
  }

  _collectNearbyKeys() {
    const { keys } = this.house;
    if (keys.length === 0) return;
    const { position } = this.player;
    this.keyReachOrigin.set(position.x, position.y - 0.45, position.z);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      const { x, z } = key.position;
      const y = key.userData.baseY;
      // Measure from the player's body, including keys on the floor or furniture.
      const reachY = THREE.MathUtils.clamp(y, position.y - EYE_HEIGHT + 0.25, position.y);
      if ((position.x - x) ** 2 + (reachY - y) ** 2 + (position.z - z) ** 2 > KEY_PICKUP_DISTANCE_SQUARED) continue;

      this.keyReachTarget.set(x, y, z);
      if (!this.house.keyPathBlocked(this.keyReachOrigin, this.keyReachTarget)) this._takeKey(key);
    }
  }

  _takeKey(key) {
    if (!this.house.removeKey(key)) return;
    this.keysFound++;
    this.audio.pickup();
    this.hud.setKeys(this.keysFound, TOTAL_KEYS);
    this.hud.flash('#211a08', 0.3, 120);

    if (key.userData.id === 'study') this.director.studyKeyScare();

    if (this.keysFound >= TOTAL_KEYS) {
      this._beginFinale();
    } else if (this.keysFound === 2) {
      this.hud.toast('One key left. You can feel him watching now.', 3000);
      this.audio.setDroneIntensity(0.45);
      this.audio.growl();
    } else {
      this.hud.toast(`A brass key. ${TOTAL_KEYS - this.keysFound} remain.`);
      this.audio.setDroneIntensity(0.2);
    }
  }

  _beginFinale() {
    this.hud.toast('The last key. Something just woke up.', 3200);
    this.hud.setObjective('GET TO THE FRONT DOOR');
    this.ghost.vanish(); // clear any stalker — he is gathering himself
    // a dead beat of silence... then everything goes wrong
    setTimeout(() => {
      if (this.state !== 'playing') return;
      this.house.setBlackout(true);
      this.player.flashlightFlicker(1.6);
      this.audio.staticBurst(0.35);
    }, 1400);
    setTimeout(() => {
      if (this.state !== 'playing') return;
      this.audio.scream();
      this.hud.flash('#300000', 0.26, 260);
      this.hud.setDanger(true);
      this.audio.setDroneIntensity(1);
      this.audio.startHeartbeat(96);
      this.audio.startChaseMusic();
      this.chaseActive = true;
      // he rises in the hallway, between you and the door if you're north
      const p = this.player.position;
      const spawn = p.z < 0.5 ? new THREE.Vector3(0, 0, 1.0) : new THREE.Vector3(0, 0, -6.5);
      this.ghost.startChase(spawn);
    }, 2600);
  }

  _lookTarget() {
    this.camera.updateMatrixWorld();
    this.rayHits.length = 0;
    this.raycaster.setFromCamera(this.rayCenter, this.camera);
    this.raycaster.intersectObjects(this.house.interactables, false, this.rayHits);
    return this.rayHits[0]?.object ?? null;
  }

  /* ---------------- fight back: the beam burns him ---------------- */

  _updateBurn(dt) {
    let burning = false;
    if (this.ghost.engaged && this.player.beamActive) {
      this.toGhost.copy(this.ghost.group.position).setY(1.9).sub(this.camera.position);
      const distanceSquared = this.toGhost.lengthSq();
      if (distanceSquared > 0 && distanceSquared < BURN_RANGE * BURN_RANGE) {
        const dist = Math.sqrt(distanceSquared);
        this.viewDirection.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        // generous cone up close, tight at range
        burning = this.viewDirection.dot(this.toGhost) >
          dist * Math.cos(0.22 + 0.9 / Math.max(dist, 1));
      }
    }

    this.player.burning = burning;
    if (burning) {
      const result = this.ghost.applyBurn(dt);
      this.audio.setSizzle(0.5 + this.ghost.burnMeter * 0.5);
      this.hud.setBurn(this.ghost.burnMeter);
      if (result === 'banished') {
        this.banishes++;
        this.audio.banishShriek();
        this.hud.flash('#cfd8ee', 0.5, 300);
        this.hud.shake();
        this.hud.setBurn(0);
        this.audio.setSizzle(0);
        this.audio.setBreathLevel(0);
        if (this.chaseActive) {
          this.hud.toast('He came apart in the beam — but he will reform. RUN.', 2600);
        } else {
          this.hud.toast('Banished. The dark went quiet again.', 2600);
          this.hud.setDanger(false);
        }
      }
    } else {
      this.ghost.stopBurn();
      this.audio.setSizzle(0);
      this.hud.setBurn(this.ghost.engaged ? this.ghost.burnMeter : 0);
    }
  }

  /* ---------------- main loop ---------------- */

  _tick() {
    if (!this.firstFrame) { this.firstFrame = true; this._trace('first-frame'); }
    const elapsed = this.clock.getDelta();
    // Bound catch-up after a long tab suspension. Player movement substeps this interval.
    const dt = Math.min(elapsed, 0.5);
    const t = this.clock.elapsedTime;

    this.house.update(dt, t);

    if (this.state === 'playing' && this.player.enabled) {
      this.player.update(dt, this.house.getColliders());
      this._collectNearbyKeys();
      this.director.update(dt, this.player.position);

      const caught = this.ghost.update(dt, this.player.position, t);
      if (caught) {
        this._onCaught();
        this._render(elapsed);
        return;
      }

      this._updateBurn(dt);
      this.hud.setBattery(this.player.battery);

      // his breathing closes in with him
      this.audioTimer -= dt;
      if (this.ghost.engaged) {
        this.hud.setDanger(true);
      } else {
        if (!this.chaseActive) this.hud.setDanger(false);
      }

      // heartbeat tempo scales with how close he is
      if (this.audioTimer <= 0) {
        this.audioTimer = 0.1;
        const d = this.ghost.distanceTo(this.player.position);
        this.audio.setBreathLevel(this.ghost.engaged ? THREE.MathUtils.clamp(1.3 - d / 9, 0, 1) : 0);
        if (this.chaseActive && this.ghost.mode !== 'hidden') {
          this.audio.startHeartbeat(Math.round(THREE.MathUtils.clamp(160 - d * 9, 88, 160) / 8) * 8);
        }
      }

      // interact prompt
      this.promptTimer -= dt;
      if (this.hud.noteOpen) this.hud.setPrompt(null);
      else if (this.promptTimer <= 0) {
        this.promptTimer = 0.05;
        const target = this._lookTarget();
        if (target) {
          const type = target.userData.interact.type;
          this.hud.setPrompt(
            type === 'battery' ? 'Take the batteries'
            : type === 'note' ? 'Read'
            : type === 'frontdoor' ? (this.keysFound >= TOTAL_KEYS ? 'Unlock the front door' : 'Front door')
            : 'Door');
        } else this.hud.setPrompt(null);
      }

      // escape: step through the open front door
      if (this.escaping && this.player.position.z > 7.5 &&
          this.player.position.x > -1.1 && this.player.position.x < 1.1) {
        this._onEscaped();
      }
    }

    this._render(elapsed);
  }

  _render(elapsed) {
    const { flashlight, flashTarget } = this.player;
    const chair = this.house.props.kitchenChair.position;
    const threshold = 0.000025;
    const time = this.clock.elapsedTime;
    const shadowReady = this.shadowPosition.x === Infinity ||
      time - this.lastShadowUpdate >= (this.graphics.shadowInterval ?? 0);
    if (this.player.beamActive && shadowReady &&
        (this.shadowPosition.distanceToSquared(flashlight.position) > threshold ||
         this.shadowTarget.distanceToSquared(flashTarget.position) > threshold ||
         !this.shadowChair.equals(chair))) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowUpdate = time;
      this.shadowPosition.copy(flashlight.position);
      this.shadowTarget.copy(flashTarget.position);
      this.shadowChair.copy(chair);
    }
    if (!this.player.beamActive) this.shadowPosition.x = Infinity;

    const info = this.renderer.info;
    info.reset();
    if (this.composer) this.composer.render(elapsed);
    else this.renderer.render(this.scene, this.camera);
    if (!this.firstRendered) { this.firstRendered = true; this._trace('first-render-completed'); }
    if (this.state === 'playing') this.director.onRendered();
    if (this.showFPS && this.state === 'playing') {
      this.statsElapsed += elapsed;
      this.statsFrames++;
      if (this.statsElapsed >= 0.75) {
        this.hud.setPerformance(this.statsFrames / this.statsElapsed, info);
        this.statsElapsed = 0;
        this.statsFrames = 0;
      }
    }
  }

  abortStartup() {
    // A void-returning legacy request may acquire the mouse AFTER setup throws.
    // Keep a short-lived cleanup listener so the title never retains a stale lock.
    const releaseLateLock = () => {
      document.removeEventListener('pointerlockchange', releaseLateLock);
      if (canvasOwner.get(this.canvas) === this && this.state === 'failed' && document.pointerLockElement === this.canvas) document.exitPointerLock();
    };
    document.addEventListener('pointerlockchange', releaseLateLock);
    setTimeout(() => document.removeEventListener('pointerlockchange', releaseLateLock), 5000);
    this.state = 'failed';
    this._disposeGame();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    document.getElementById('pause-screen').classList.add('hidden');
  }

  async _restart() {
    this.state = 'restarting';
    try {
      await this._disposeGame();
    } finally {
      location.reload();
    }
  }

  _disposeGame() {
    clearTimeout(this.lockTimer);
    clearTimeout(this.welcomeCreak);
    clearTimeout(this.welcomeThump);
    this.events.abort();
    this.renderer?.setAnimationLoop(null); this.player?.dispose(); this.hud?.dispose();
    this.audio?.stopHeartbeat();
    this.audio?.stopChaseMusic();
    const context = this.audio?.ctx;
    const audioClosed = context && context.state !== 'closed' ? context.close().catch(() => {}) : undefined;
    for (const pass of this.composer?.passes ?? []) pass.dispose();
    this.composer?.dispose();
    const resources = new Set();
    this.scene?.traverse(object => {
      if (object.isInstancedMesh) object.dispose();
      if (object.geometry) resources.add(object.geometry);
      if (object.skeleton) resources.add(object.skeleton);
      if (object.map?.isTexture) resources.add(object.map);
      const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
      for (const material of materials) {
        if (resources.has(material)) continue;
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
      object.shadow?.dispose();
    });
    for (const resource of resources) resource.dispose();
    this.renderer?.dispose();
    return audioClosed;
  }
}
