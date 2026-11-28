import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Accepts a Vite, preview, published or file:// URL. Uses Chromium CDP directly.
const browserPath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:5173';
const profile = await mkdtemp(join(tmpdir(), 'bridge-horror-browser-'));
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Chrome nÃ£o iniciou: ${stderr.slice(-1000)}`)), 45000);
    browser.once('error', (error) => { clearTimeout(timer); reject(error); });
    browser.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  const networkRequests = [];
  const documentStatuses = new Map();
  const audioContexts = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
    if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) {
      networkRequests.push(message.params.request.url);
    }
    if (message.method === 'Network.responseReceived' && message.params.type === 'Document') {
      const { url, status } = message.params.response;
      documentStatuses.set(url, status);
    }
    if (['WebAudio.contextCreated', 'WebAudio.contextChanged'].includes(message.method)) {
      const { contextId, contextState } = message.params.context;
      if (message.method === 'WebAudio.contextCreated' || audioContexts.has(contextId)) {
        audioContexts.set(contextId, contextState);
      }
    }
    if (message.method === 'WebAudio.contextWillBeDestroyed') audioContexts.delete(message.params.contextId);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolveRequest, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params = {}) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const waitFor = async (expression, message, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(80);
    }
    const diagnostics = await evaluate(`({
      url: location.href,
      status: document.getElementById('start-status')?.textContent,
      pause: document.getElementById('pause-status')?.textContent,
      stages: window.startupStages,
    })`);
    assert.fail(`${message}: ${JSON.stringify({ diagnostics, errors })}`);
  };
  await command('Runtime.enable');
  await command('Log.enable');
  await command('Page.enable');
  await command('Network.enable');
  await command('WebAudio.enable');
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.startupStages=[];
    window.addEventListener('bridge-startup',event=>{window.testGame=event.detail.game;startupStages.push(event.detail.stage);});
  `});
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  const scenarios=process.argv.slice(3);if(!scenarios.length)scenarios.push('normal','audio-constructor','audio-resume','pointer-promise','pointer-throw','pointer-event','pointer-timeout','pointer-unsupported','pointer-void','renderer-retry','first-render-retry');
  const click=async selector=>{
    const point=await evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  const press = async (code, key) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', code, key });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
  };
  for(const scenario of scenarios){
    errors.length=0;
    audioContexts.clear();
    networkRequests.length = 0;
    const target=new URL(url);target.searchParams.set('debugStartup','1');
    if (target.protocol === 'file:') {
      await command('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    }
    const navigation = await command('Page.navigate', { url: target.href });
    assert.ok(!navigation.errorText, `${target.href}: ${navigation.errorText}`);
    const status = documentStatuses.get(target.href);
    assert.ok(!status || status < 400, `${target.href}: HTTP ${status}`);
    if (scenario === 'source-file') {
      await waitFor('document.getElementById("start-status")?.textContent.includes("dist/index.html")', 'Missing local source-file guidance');
      assert.equal(await evaluate('document.getElementById("start-btn").disabled'), true);
      assert.equal(await evaluate('document.querySelector("#start-status a")?.getAttribute("href")'), './dist/index.html');
      console.log(JSON.stringify({ url, scenario, errors }));
      continue;
    }
    await waitFor('Boolean(document.getElementById("start-btn"))&&!document.getElementById("start-btn").disabled','Start disabled',30000);
    await evaluate(`document.getElementById("graphics-quality").value="${['medium', 'high'].includes(scenario) ? scenario : 'low'}"`);
    await evaluate('document.getElementById("show-fps").checked = true');
    await evaluate('document.getElementById("show-fps").dispatchEvent(new Event("change", { bubbles: true }))');
    if(scenario==='audio-constructor')await evaluate('window.AudioContext=class{constructor(){throw new Error("Injected unavailable audio device")}}');
    if(scenario==='audio-resume')await evaluate('Object.defineProperty(AudioContext.prototype,"state",{get:()=>"suspended"});AudioContext.prototype.resume=function(){return Promise.reject(new Error("Injected audio resume rejection"))}');
    if(scenario.startsWith('pointer-'))await evaluate(`(()=>{
      const canvas=document.getElementById('game');globalThis.nativeLock=canvas.requestPointerLock;
      if('${scenario}'==='pointer-promise')canvas.requestPointerLock=()=>Promise.reject(new DOMException('Injected denial','NotAllowedError'));
      if('${scenario}'==='pointer-throw')canvas.requestPointerLock=()=>{throw new DOMException('Injected denial','SecurityError')};
      if('${scenario}'==='pointer-event')canvas.requestPointerLock=()=>{setTimeout(()=>document.dispatchEvent(new Event('pointerlockerror')),0)};
      if('${scenario}'==='pointer-timeout')canvas.requestPointerLock=()=>{};
      if('${scenario}'==='pointer-unsupported')canvas.requestPointerLock=undefined;
      if('${scenario}'==='pointer-void')canvas.requestPointerLock=function(){nativeLock.call(this)?.catch(()=>{});};
    })()`);
    if(scenario==='renderer-retry')await evaluate(`(()=>{const canvas=document.getElementById('game'),original=canvas.getContext;canvas.getContext=function(...args){canvas.getContext=original;throw new Error('Injected first renderer failure')};})()`);
    if (scenario === 'first-render-retry') await evaluate(`
      window.addEventListener('bridge-startup', function inject(event) {
        if (event.detail.stage !== 'first-render') return;
        window.removeEventListener('bridge-startup', inject);
        event.detail.game.renderer.render = () => { throw new Error('Injected first frame failure'); };
      });
    `);
    await click('#start-btn');
    if(scenario.endsWith('-retry')){
      await waitFor(`!document.getElementById("start-btn").disabled&&document.getElementById("start-status").textContent.includes(${JSON.stringify(scenario.replace(/-retry$/, ''))})`,'Failure did not permit retry');
      assert.equal(await evaluate('document.getElementById("title-screen").classList.contains("hidden")'),false);
      errors.length=0;await delay(1500);await click('#start-btn');
      await delay(1000);console.log(JSON.stringify(await evaluate('({stage:globalThis.testGame?.startupStage,state:globalThis.testGame?.state,status:document.getElementById("start-status").textContent,disabled:document.getElementById("start-btn").disabled,stages:startupStages})')));
    }
    await waitFor('window.testGame?.state==="playing"&&startupStages.includes("first-render-completed")&&startupStages.includes("first-frame")','Scene did not start',30000);
    assert.equal(await evaluate('document.getElementById("title-screen").classList.contains("hidden")'),true);
    if(scenario.startsWith('pointer-')&&scenario!=='pointer-void'){
      await waitFor('!document.getElementById("pause-screen").classList.contains("hidden")&&document.getElementById("pause-status").textContent.includes("retry")','No mouse failure feedback',10000);
      assert.equal(await evaluate('testGame.player.enabled'),false);
      await evaluate('document.getElementById("game").requestPointerLock=nativeLock');
      await click('#resume-btn');
    }
    if(scenario.endsWith('-retry') && !await evaluate('document.pointerLockElement===document.getElementById("game")')) {
      await waitFor('!document.getElementById("pause-screen").classList.contains("hidden")','Retry lock status missing',6000);
      await delay(1500); await click('#resume-btn');
    }
    await waitFor('document.pointerLockElement===document.getElementById("game")&&testGame.player.enabled','No real pointer lock',10000);
    const before=await evaluate('({z:testGame.player.position.z,yaw:testGame.player.yaw,frames:testGame.renderer.info.render.frame})');
    await command('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w'});await delay(350);
    await command('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w'});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:690,y:330,movementX:50,movementY:-30});
    await delay(150);
    const after=await evaluate('({z:testGame.player.position.z,yaw:testGame.player.yaw,frames:testGame.renderer.info.render.frame,state:testGame.state,house:!!testGame.house,monster:!!testGame.ghost,audio:testGame.audio.available,stages:startupStages})');
    assert.ok(after.z<before.z-.05,'W did not move the actual player');
    assert.ok(Math.abs(after.yaw-before.yaw)>.005,'Mouse did not rotate the camera');
    assert.ok(after.frames>before.frames,'Render loop stalled');assert.ok(after.house&&after.monster);
    await command('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyF',key:'f'});
    await command('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyF',key:'f'});
    assert.equal(await evaluate('testGame.player.flashlightOn'),false);
    await command('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyF',key:'f'});
    await command('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyF',key:'f'});
    assert.equal(await evaluate('testGame.player.flashlightOn'),true);
    assert.equal(await evaluate('document.getElementById("pause-screen").classList.contains("hidden")'),true);
    if (['normal', 'medium', 'high', 'escape'].includes(scenario)) {
      await waitFor('testGame.audio.ctx?.state === "running"', 'Web Audio did not start');
      await waitFor('document.getElementById("performance-stats").textContent.includes("FPS")', 'Performance HUD did not update');
      if (process.env.STARTUP_SCREENSHOT) {
        const { data } = await command('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
        await writeFile(process.env.STARTUP_SCREENSHOT, Buffer.from(data, 'base64'));
      }
      await evaluate(`
        window.aimAt = type => {
          const object = testGame.house.interactables.find(mesh => mesh.userData.interact.type === type &&
            (type !== 'door' || mesh.userData.interact.door === testGame.house.props.studyDoor));
          const info = object.userData.interact;
          const target = object.getWorldPosition(object.position.clone());
          const player = testGame.player;
          player.velocity.set(0, 0, 0);
          player.bobPhase = 0;
          player.position.set(target.x, 1.62, target.z + (target.z > 6.8 ? -1.2 : 1.2));
          player.yaw = target.z > 6.8 ? Math.PI : 0;
          player.pitch = Math.atan2(target.y - player.position.y, 1.2);
          player.update(0, []);
          const hit = testGame._lookTarget()?.userData.interact;
          return Boolean(hit && hit.type === type && hit.group === info.group && hit.door === info.door);
        };
        window.placePlayer = (x, z) => {
          testGame.player.position.set(x, 1.62, z);
          testGame.player.velocity.set(0, 0, 0);
        };
        window.placeAcrossBarrier = (x, y, z, playerX, playerZ) => {
          const key = testGame.house.keys.find(key => key.userData.id === 'study');
          const { x: originalX, z: originalZ } = key.position;
          const originalY = key.userData.baseY;
          window.restoreBarrierKey = () => {
            key.position.set(originalX, originalY, originalZ);
            key.userData.baseY = originalY;
          };
          key.position.set(x, y, z);
          key.userData.baseY = y;
          placePlayer(playerX, playerZ);
        };
        window.approachKey = (id, index) => {
          const key = testGame.house.keys.find(key => key.userData.id === id);
          if (!key) return false;
          const angle = index * Math.PI / 4;
          const x = key.position.x + 1.18 * Math.sin(angle);
          const z = key.position.z + 1.18 * Math.cos(angle);
          if (testGame.house.getColliders().some(box => {
            const dx = Math.max(box.minX - x, 0, x - box.maxX);
            const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
            return dx * dx + dz * dz < 0.32 ** 2;
          })) return true;
          placePlayer(x, z);
          testGame.player.pitch = 0;
          testGame.player.yaw = angle + Math.PI; // Look away from the key.
          return true;
        };
      `);
      const collect = async room => {
        const before = await evaluate('testGame.keysFound');
        const previousHUD = await evaluate('document.getElementById("keys").textContent');
        for (let index = 0; index < 8; index++) {
          if (!await evaluate(`approachKey("${room}", ${index})`)) break;
          await delay(110);
        }
        assert.equal(await evaluate('testGame.keysFound'), before + 1, `${room} key was not collected exactly once`);
        assert.notEqual(await evaluate('document.getElementById("keys").textContent'), previousHUD, 'Key HUD did not change');
        assert.equal(await evaluate(`testGame.house.keys.some(key => key.userData.id === "${room}")`), false);
      };
      assert.ok(await evaluate('aimAt("note")'), 'Note raycast missed');
      await press('KeyE', 'e');
      assert.ok(await evaluate('testGame.hud.noteOpen'));
      await press('KeyE', 'e');
      assert.ok(await evaluate('aimAt("battery")'), 'Battery raycast missed');
      const batteryCount = 'new Set(testGame.house.interactables.filter(mesh => mesh.userData.interact.type === "battery").map(mesh => mesh.userData.interact.group)).size';
      const batteries = await evaluate(batteryCount);
      await press('KeyE', 'e');
      assert.equal(await evaluate(batteryCount), batteries - 1);
      if (scenario === 'escape') {
        for (const [name, placement] of [
          ['wall', '-3.86, 0.8, -3, -4.67, -3'],
          ['closed door', '-7.25, 0.8, -1.48, -7.25, -0.48'],
          ['furniture', '6.5, 0.6, 5.3, 6.5, 6.43'],
        ]) {
          await evaluate(`placeAcrossBarrier(${placement})`);
          await delay(350);
          assert.equal(await evaluate('testGame.keysFound'), 0, `Picked up a key through ${name}`);
          await evaluate('restoreBarrierKey()');
        }
      }
      await collect('kitchen');
      assert.ok(await evaluate('aimAt("door")'), 'Door raycast missed');
      await press('KeyE', 'e');
      await waitFor('testGame.house.props.studyDoor.isOpen && testGame.house.props.studyDoor.aabb() === null', 'Door did not swing and release its collider');
      await evaluate('document.exitPointerLock()');
      await waitFor('!testGame.player.enabled && !document.getElementById("pause-screen").classList.contains("hidden")', 'Pause did not appear');
      await click('#resume-btn');
      await waitFor('testGame.player.enabled', 'Resume did not restore controls');
      const stats = await evaluate('({ calls: testGame.renderer.info.render.calls, triangles: testGame.renderer.info.render.triangles })');
      if (scenario === 'escape') {
        for (const room of ['bedroom', 'study']) await collect(room);
        await waitFor('testGame.keysFound === 3 && testGame.house.blackout && testGame.chaseActive', 'Finale did not start');
        assert.ok(await evaluate('aimAt("frontdoor")'), 'Front door raycast missed');
        await press('KeyE', 'e');
        await waitFor('testGame.escaping && testGame.house.props.frontDoor.isOpen', 'Front door did not unlock');
        await command('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
        await waitFor('testGame.state === "escaped" && !document.getElementById("win-screen").classList.contains("hidden")', 'Walking through the door did not complete the game');
        await command('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
        await click('#again-btn');
      } else {
        // Exercise the defeat-to-restart flow without waiting for a random encounter.
        await evaluate('testGame._onCaught()');
        await waitFor('!document.getElementById("scare-face").classList.contains("hidden")', 'Jumpscare did not appear', 1500);
        await waitFor('document.getElementById("retry-btn").getBoundingClientRect().width > 0', 'Defeat screen did not appear', 12000);
        await click('#retry-btn');
      }
      await waitFor('document.getElementById("title-screen")?.classList.contains("hidden") === false && document.getElementById("start-btn")?.disabled === false', 'Restart did not reload the title');
      await click('#start-btn');
      await waitFor('window.testGame?.player.enabled && testGame.firstRendered && testGame.keysFound === 0', 'Second game did not start cleanly', 30000);
      assert.equal(await evaluate('testGame.house.keys.length'), 3);
      const activeAudioContexts = [...audioContexts.values()].filter(state => state !== 'closed').length;
      assert.equal(activeAudioContexts, 1, 'An obsolete audio context remained active after restart');
      console.log(JSON.stringify({ interactions: ['note', 'battery', 'automatic key', 'door'], pause: true, restart: true,
        activeAudioContexts, completedEscape: scenario === 'escape', ...stats }));
    }
    if (target.protocol === 'file:') assert.deepEqual(networkRequests, [], 'Local build attempted HTTP requests');
    assert.deepEqual(errors,[],`Browser errors: ${JSON.stringify(errors)}`);
    const report={url,scenario,moved:before.z-after.z,rotated:after.yaw-before.yaw,renderedFrames:after.frames-before.frames,audio:after.audio,stages:after.stages};
    console.log(JSON.stringify(report));
    await evaluate('document.exitPointerLock()');await delay(200);
  }
  await send('Browser.close');
} finally {
  socket?.close();
  if (browser.exitCode === null) await Promise.race([once(browser, 'exit'), delay(3000)]);
  if (browser.exitCode === null) browser.kill();
  // O Ãºnico diretÃ³rio removido Ã© o perfil temporÃ¡rio criado por este teste.
  const absoluteProfile = resolve(profile);
  assert.equal(dirname(absoluteProfile), resolve(tmpdir()));
  assert.ok(absoluteProfile.split(/[\\/]/).at(-1).startsWith('bridge-horror-browser-'));
  try {
    await rm(absoluteProfile, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 });
  } catch (error) {
    // Crashpad pode manter arquivos abertos apÃ³s o Chrome sair no Windows.
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    console.warn('Perfil temporÃ¡rio do Chrome ainda em uso; mantido no diretÃ³rio temporÃ¡rio.');
  }
}





