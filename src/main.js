import './style.css';

const WORK_DURATION_SEC = 25 * 60;
const BREAK_DURATION_SEC = 5 * 60;

/** @typedef {'work' | 'break'} TimerMode */

const appEl = document.getElementById('app');
const modeEl = document.getElementById('timer-mode');
const displayEl = document.getElementById('timer-display');
const toggleBtn = document.getElementById('timer-start-pause');
const resetBtn = document.getElementById('timer-reset');

if (!appEl || !modeEl || !displayEl || !toggleBtn || !resetBtn) {
  throw new Error('Pomodoro timer: required DOM nodes are missing.');
}

/** @type {TimerMode} */
let currentMode = 'work';
let timeRemaining = WORK_DURATION_SEC;
let isRunning = false;
/** @type {ReturnType<typeof setInterval> | null} */
let tickId = null;

/**
 * @param {TimerMode} mode
 * @returns {number}
 */
function durationForMode(mode) {
  return mode === 'work' ? WORK_DURATION_SEC : BREAK_DURATION_SEC;
}

/**
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatMmSs(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * @param {number} totalSeconds
 * @returns {string}
 */
function isoDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  let str = 'PT';
  if (h) str += `${h}H`;
  if (m) str += `${m}M`;
  if (s > 0 || (!h && !m)) str += `${s}S`;
  return str;
}

/**
 * @param {TimerMode} mode
 * @returns {string}
 */
function modeLabel(mode) {
  return mode === 'work' ? 'Work' : 'Break';
}

function stopTick() {
  if (tickId !== null) {
    clearInterval(tickId);
    tickId = null;
  }
}

function syncDom() {
  appEl.dataset.mode = currentMode;
  modeEl.textContent = modeLabel(currentMode);
  displayEl.textContent = formatMmSs(timeRemaining);
  displayEl.dateTime = isoDuration(timeRemaining);
  toggleBtn.textContent = isRunning ? 'Pause' : 'Start';
  toggleBtn.setAttribute('aria-pressed', isRunning ? 'true' : 'false');
}

function advancePhase() {
  currentMode = currentMode === 'work' ? 'break' : 'work';
  timeRemaining = durationForMode(currentMode);
}

function tick() {
  if (!isRunning) return;

  timeRemaining -= 1;

  if (timeRemaining <= 0) {
    advancePhase();
  }

  syncDom();
}

function setRunning(next) {
  if (next === isRunning) return;
  isRunning = next;
  if (isRunning) {
    tickId = setInterval(tick, 1000);
  } else {
    stopTick();
  }
  syncDom();
}

function reset() {
  stopTick();
  isRunning = false;
  timeRemaining = durationForMode(currentMode);
  syncDom();
}

toggleBtn.addEventListener('click', () => {
  setRunning(!isRunning);
});

resetBtn.addEventListener('click', () => {
  reset();
});

syncDom();
