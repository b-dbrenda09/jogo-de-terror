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

title.addEventListener('click', (event) => {
  if (button.disabled || settings.contains(event.target)) return;
  button.disabled = true;

  try {
    const game = new Game(canvas, { quality: quality.value, showFPS: showFPS.checked });
    game.start();
    title.classList.add('hidden');
  } catch (error) {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    console.error('Could not start Bridge Horror House:', error);
    status.textContent = 'The game could not start. Reload the page and try again.';
  }
});

button.disabled = false;
