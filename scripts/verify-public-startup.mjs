import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Execute com o servidor Vite ativo. Usa Chrome headless e CDP, sem bibliotecas extras.
const browserPath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:5173';
const profile = await mkdtemp(join(tmpdir(), 'kawaii-browser-'));
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
    assert.fail(message);
  };
  await command('Runtime.enable');
  await command('Log.enable');
  await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.startupStages=[];
    Object.defineProperty(Object.prototype,'state',{configurable:true,set(value){
      Object.defineProperty(this,'state',{value,writable:true,configurable:true,enumerable:true});
      if(value==='title'&&this.canvas?.id==='game'){window.testGame=this;delete Object.prototype.state;}
    }});
    window.addEventListener('bridge-startup',event=>{window.testGame=event.detail.game;startupStages.push(event.detail.stage);});
  `});
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  const scenarios=process.argv.slice(3);if(!scenarios.length)scenarios.push('normal','audio-constructor','audio-resume','pointer-promise','pointer-throw','pointer-event','pointer-timeout','pointer-unsupported','pointer-void','renderer-retry');
  const click=async selector=>{
    const point=await evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  for(const scenario of scenarios){
    errors.length=0;
    const target=new URL(url);target.searchParams.set('debugStartup','1');
    await command('Page.navigate',{url:target.href});
    await delay(3000);console.log(JSON.stringify(await evaluate('({url:location.href,title:document.title,body:document.body?.innerText.slice(0,1500)})')));
    await waitFor('Boolean(document.getElementById("start-btn"))&&!document.getElementById("start-btn").disabled','Start disabled',15000);
    await evaluate('document.getElementById("graphics-quality").value="low"');
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
    await click('#start-btn');
    if(scenario==='renderer-retry'){
      await waitFor('!document.getElementById("start-btn").disabled&&document.getElementById("start-status").textContent.includes("renderer")','Failure did not permit retry');
      assert.equal(await evaluate('document.getElementById("title-screen").classList.contains("hidden")'),false);
      errors.length=0;await delay(1500);await click('#start-btn');
      await delay(1000);console.log(JSON.stringify(await evaluate('({stage:globalThis.testGame?.startupStage,state:globalThis.testGame?.state,status:document.getElementById("start-status").textContent,disabled:document.getElementById("start-btn").disabled,stages:startupStages})')));
    }
    await waitFor('globalThis.testGame?.state==="playing"','Scene did not start',30000);
    assert.equal(await evaluate('document.getElementById("title-screen").classList.contains("hidden")'),true);
    if(scenario.startsWith('pointer-')&&scenario!=='pointer-void'){
      await waitFor('!document.getElementById("pause-screen").classList.contains("hidden")&&document.getElementById("pause-status").textContent.includes("retry")','No mouse failure feedback',10000);
      assert.equal(await evaluate('testGame.player.enabled'),false);
      await evaluate('document.getElementById("game").requestPointerLock=nativeLock');
      await click('#resume-btn');
    }
    await waitFor('document.pointerLockElement===document.getElementById("game")&&testGame.player.enabled','No real pointer lock',10000);
    const before=await evaluate('({z:testGame.player.position.z,yaw:testGame.player.yaw,frames:testGame.renderer.info.render.frame})');
    await command('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w'});await delay(350);
    await command('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w'});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:690,y:330,movementX:50,movementY:-30});
    await delay(150);
    const after=await evaluate('({z:testGame.player.position.z,yaw:testGame.player.yaw,frames:testGame.renderer.info.render.frame,state:testGame.state,house:!!testGame.house,monster:!!testGame.ghost,audio:!!testGame.audio,stages:startupStages})');
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
    assert.deepEqual(errors,[],`Browser errors: ${JSON.stringify(errors)}`);
    console.log(JSON.stringify({url,scenario,moved:before.z-after.z,rotated:after.yaw-before.yaw,renderedFrames:after.frames-before.frames,audio:after.audio,stages:after.stages}));
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
  assert.ok(absoluteProfile.split(/[\\/]/).at(-1).startsWith('kawaii-browser-'));
  try {
    await rm(absoluteProfile, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 });
  } catch (error) {
    // Crashpad pode manter arquivos abertos apÃ³s o Chrome sair no Windows.
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    console.warn('Perfil temporÃ¡rio do Chrome ainda em uso; mantido no diretÃ³rio temporÃ¡rio.');
  }
}





