import { Game } from './Game.js';

const canvas = document.getElementById('game');
const title = document.getElementById('title-screen');
const button = document.getElementById('start-btn');
const status = document.getElementById('start-status');
const settings = document.getElementById('graphics-settings');
const quality = document.getElementById('graphics-quality');
const showFPS = document.getElementById('show-fps');

try {
  const saved = JSON.parse(localStorage.getItem('bridge-horror-graphics'));
  if (saved && ['low', 'medium', 'high'].includes(saved.quality)) quality.value = saved.quality;
  showFPS.checked = saved?.showFPS === true;
} catch {
  // Storage can be unavailable in private or embedded browsers.
}

settings.addEventListener('change', () => {
  try {
    localStorage.setItem('bridge-horror-graphics', JSON.stringify({
      quality: quality.value, showFPS: showFPS.checked,
    }));
  } catch {
    // The current controls also work without persistent storage.
  }
});

let game;
button.addEventListener('click', () => {
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = '';

  try {
    game ??= new Game(canvas, { quality: quality.value, showFPS: showFPS.checked });
    game._trace('start-click');
    game.start();
    title.classList.add('hidden');
    game._trace('menu-hidden');
  } catch (error) {
    const stage = game?.startupStage ?? 'start';
    game?.abortStartup(); game = null;
    console.error('Could not start Bridge Horror House:', error);
    status.textContent = `The game could not start (${stage}). ${error.message} Click to try again.`;
    button.disabled = false;
  }
});

button.disabled = false;
