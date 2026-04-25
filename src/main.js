import './styles/index.css';

const STORAGE_KEY = 'pomodorino.v1';
const TICK_MS = 250;
const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

/** @typedef {'work' | 'shortBreak' | 'longBreak'} TimerMode */

const MODE_LABELS = {
  work: 'Work',
  shortBreak: 'Break',
  longBreak: 'Long break',
};

const DEFAULT_SETTINGS = {
  workMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  autoSwitch: true,
};

const appEl = mustElement('app');
const modeEl = mustElement('timer-mode');
const displayEl = mustElement('timer-display');
const nextEl = mustElement('timer-next');
const toggleBtn = mustElement('timer-start-pause');
const resetBtn = mustElement('timer-reset');
const sessionCountEl = mustElement('session-count');
const activeTaskLabelEl = mustElement('active-task-label');
const activeTaskDetailEl = mustElement('active-task-detail');
const timerFeedbackEl = mustElement('timer-feedback');
const tasksPendingCountEl = mustElement('tasks-pending-count');
const tasksDoneCountEl = mustElement('tasks-done-count');
const tasksFormEl = mustElement('tasks-form');
const taskInputEl = mustElement('task-input');
const tasksListEl = mustElement('tasks-list');
const settingsFormEl = mustElement('settings-form');
const settingsResetDefaultEl = mustElement('settings-reset-default');
const modeTabEls = Array.from(document.querySelectorAll('[data-mode-tab]'));

const settingsInputs = {
  workMin: mustElement('work-minutes'),
  shortBreakMin: mustElement('short-break-minutes'),
  longBreakMin: mustElement('long-break-minutes'),
  autoSwitch: mustElement('auto-switch'),
};

let tickId = null;
let hasPromptedNotificationPermission = false;
let feedbackTimeoutId = null;

const state = initState();
hydrateFromStorage();
syncTimerFromRunningState();
render();

function mustElement(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Pomodorino: missing DOM node #${id}`);
  }
  return el;
}

function initState() {
  return {
    timer: {
      mode: /** @type {TimerMode} */ ('work'),
      isRunning: false,
      remainingSec: DEFAULT_SETTINGS.workMin * 60,
      targetEndMs: null,
      blockedOnFinish: false,
    },
    settings: { ...DEFAULT_SETTINGS },
    sessions: {
      completedPomodoros: 0,
      completedInCycle: 0,
    },
    tasks: [],
    tasksActiveId: null,
    meta: {
      schemaVersion: 1,
      updatedAt: Date.now(),
    },
  };
}

function clampMinutes(value) {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, value));
}

function durationForMode(mode) {
  if (mode === 'work') return state.settings.workMin * 60;
  if (mode === 'shortBreak') return state.settings.shortBreakMin * 60;
  return state.settings.longBreakMin * 60;
}

function modeTabLabel(mode) {
  if (mode === 'work') return 'Work';
  if (mode === 'shortBreak') return 'Break';
  return 'Long break';
}

function formatMmSs(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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

function nextModeAfterWork() {
  if (state.sessions.completedInCycle >= 4) {
    return 'longBreak';
  }
  return 'shortBreak';
}

function nextModeHint() {
  if (state.timer.mode === 'work') {
    return `Up next: ${modeTabLabel(nextModeAfterWork())}`;
  }
  return 'Up next: Work';
}

function stopTick() {
  if (tickId !== null) {
    clearInterval(tickId);
    tickId = null;
  }
}

function startTick() {
  stopTick();
  tickId = setInterval(handleTick, TICK_MS);
}

function syncTimerFromRunningState() {
  if (state.timer.isRunning) {
    startTick();
  } else {
    stopTick();
  }
}

function startTimer() {
  if (state.timer.isRunning) return;
  if (!hasPromptedNotificationPermission) {
    requestNotificationPermission();
    hasPromptedNotificationPermission = true;
  }
  if (state.timer.remainingSec <= 0) {
    state.timer.remainingSec = durationForMode(state.timer.mode);
  }
  state.timer.isRunning = true;
  state.timer.blockedOnFinish = false;
  state.timer.targetEndMs = Date.now() + state.timer.remainingSec * 1000;
  syncTimerFromRunningState();
  saveState();
  render();
}

function pauseTimer() {
  if (!state.timer.isRunning) return;
  updateRemainingFromClock();
  state.timer.isRunning = false;
  state.timer.targetEndMs = null;
  syncTimerFromRunningState();
  saveState();
  render();
}

function resetTimer() {
  state.timer.isRunning = false;
  state.timer.targetEndMs = null;
  state.timer.blockedOnFinish = false;
  state.timer.remainingSec = durationForMode(state.timer.mode);
  syncTimerFromRunningState();
  saveState();
  render();
}

function setMode(mode) {
  state.timer.mode = mode;
  state.timer.isRunning = false;
  state.timer.targetEndMs = null;
  state.timer.blockedOnFinish = false;
  state.timer.remainingSec = durationForMode(mode);
  syncTimerFromRunningState();
  saveState();
  render();
}

function advancePhase() {
  if (state.timer.mode === 'work') {
    const task = activeTask();
    if (task && !task.done) {
      task.pomodorosCompleted += 1;
      showFeedback(`+1 focus session added to "${task.title}".`);
    } else {
      showFeedback('+1 focus session completed.');
    }
    state.sessions.completedPomodoros += 1;
    state.sessions.completedInCycle += 1;
    state.timer.mode = nextModeAfterWork();
  } else {
    if (state.timer.mode === 'longBreak') {
      state.sessions.completedInCycle = 0;
    }
    state.timer.mode = 'work';
  }

  state.timer.remainingSec = durationForMode(state.timer.mode);
  state.timer.targetEndMs = null;
  playCompletionBeep();

  if (state.settings.autoSwitch) {
    state.timer.isRunning = true;
    state.timer.blockedOnFinish = false;
    state.timer.targetEndMs = Date.now() + state.timer.remainingSec * 1000;
  } else {
    state.timer.isRunning = false;
    state.timer.blockedOnFinish = true;
  }
}

function updateRemainingFromClock() {
  if (!state.timer.isRunning || !state.timer.targetEndMs) return;
  const sec = Math.ceil((state.timer.targetEndMs - Date.now()) / 1000);
  state.timer.remainingSec = Math.max(0, sec);
}

function handleTick() {
  if (!state.timer.isRunning) return;
  updateRemainingFromClock();
  if (state.timer.remainingSec <= 0) {
    advancePhase();
    syncTimerFromRunningState();
    saveState();
    render();
    return;
  }
  render();
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function playCompletionBeep() {
  try {
    const audioContext = new window.AudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.04;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch {
    // Do nothing if audio playback is unavailable.
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    const body = state.timer.mode === 'work' ? 'Back to focus.' : 'Time for a break.';
    new Notification('Pomodorino', { body });
  }
}

function showFeedback(message) {
  timerFeedbackEl.textContent = message;
  if (feedbackTimeoutId !== null) {
    clearTimeout(feedbackTimeoutId);
  }
  feedbackTimeoutId = setTimeout(() => {
    timerFeedbackEl.textContent = '';
  }, 3500);
}

function addTask(title) {
  state.tasks.push({
    id: crypto.randomUUID(),
    title,
    done: false,
    pomodorosCompleted: 0,
  });
  saveState();
  render();
}

function toggleTask(taskId) {
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) return;
  task.done = !task.done;
  if (task.done && state.tasksActiveId === taskId) {
    state.tasksActiveId = null;
  }
  saveState();
  render();
}

function deleteTask(taskId) {
  state.tasks = state.tasks.filter((entry) => entry.id !== taskId);
  if (state.tasksActiveId === taskId) {
    state.tasksActiveId = null;
  }
  saveState();
  render();
}

function setActiveTask(taskId) {
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task || task.done) return;
  state.tasksActiveId = taskId;
  saveState();
  render();
}

function activeTask() {
  return state.tasks.find((task) => task.id === state.tasksActiveId) ?? null;
}

function saveState() {
  state.meta.updatedAt = Date.now();
  const safe = {
    timer: {
      mode: state.timer.mode,
      isRunning: state.timer.isRunning,
      remainingSec: state.timer.remainingSec,
      targetEndMs: state.timer.targetEndMs,
      blockedOnFinish: state.timer.blockedOnFinish,
    },
    settings: { ...state.settings },
    sessions: { ...state.sessions },
    tasks: state.tasks.map((task) => ({ ...task })),
    tasksActiveId: state.tasksActiveId,
    meta: {
      schemaVersion: 1,
      updatedAt: state.meta.updatedAt,
    },
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

function hydrateFromStorage() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    const settings = parsed.settings ?? {};
    state.settings.workMin = clampMinutes(Number(settings.workMin) || DEFAULT_SETTINGS.workMin);
    state.settings.shortBreakMin = clampMinutes(Number(settings.shortBreakMin) || DEFAULT_SETTINGS.shortBreakMin);
    state.settings.longBreakMin = clampMinutes(Number(settings.longBreakMin) || DEFAULT_SETTINGS.longBreakMin);
    state.settings.autoSwitch = Boolean(settings.autoSwitch);

    const timer = parsed.timer ?? {};
    state.timer.mode = ['work', 'shortBreak', 'longBreak'].includes(timer.mode) ? timer.mode : 'work';
    state.timer.isRunning = Boolean(timer.isRunning);
    state.timer.remainingSec = Math.max(0, Math.floor(Number(timer.remainingSec) || durationForMode(state.timer.mode)));
    state.timer.targetEndMs = Number.isFinite(timer.targetEndMs) ? timer.targetEndMs : null;
    state.timer.blockedOnFinish = Boolean(timer.blockedOnFinish);

    const sessions = parsed.sessions ?? {};
    state.sessions.completedPomodoros = Math.max(0, Math.floor(Number(sessions.completedPomodoros) || 0));
    state.sessions.completedInCycle = Math.max(0, Math.floor(Number(sessions.completedInCycle) || 0));

    state.tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter((task) => task && typeof task.title === 'string')
          .map((task) => ({
            id: typeof task.id === 'string' ? task.id : crypto.randomUUID(),
            title: task.title.trim().slice(0, 80) || 'Untitled task',
            done: Boolean(task.done),
            pomodorosCompleted: Math.max(0, Math.floor(Number(task.pomodorosCompleted) || 0)),
          }))
      : [];
    state.tasksActiveId = typeof parsed.tasksActiveId === 'string' ? parsed.tasksActiveId : null;
    const activeEntry = state.tasks.find((task) => task.id === state.tasksActiveId && !task.done);
    if (!activeEntry) {
      state.tasksActiveId = null;
    }

    if (state.timer.isRunning && state.timer.targetEndMs) {
      const remainingSec = Math.ceil((state.timer.targetEndMs - Date.now()) / 1000);
      if (remainingSec <= 0) {
        state.timer.isRunning = false;
        state.timer.targetEndMs = null;
        state.timer.remainingSec = 0;
      } else {
        state.timer.remainingSec = remainingSec;
      }
    } else {
      state.timer.isRunning = false;
      state.timer.targetEndMs = null;
      if (state.timer.remainingSec <= 0) {
        state.timer.remainingSec = durationForMode(state.timer.mode);
      }
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function renderTasks() {
  tasksListEl.textContent = '';
  if (state.tasks.length === 0) {
    const li = document.createElement('li');
    li.className = 'tasks__empty';
    li.textContent = 'No tasks yet. Add one to start tracking focused work.';
    tasksListEl.append(li);
    return;
  }

  state.tasks.forEach((task) => {
    const li = document.createElement('li');
    li.className = `task-item${task.done ? ' is-done' : ''}`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'task-item__toggle';
    toggle.setAttribute('aria-label', task.done ? `Reopen "${task.title}"` : `Mark "${task.title}" as done`);
    toggle.textContent = task.done ? 'Reopen' : 'Mark done';
    toggle.addEventListener('click', () => toggleTask(task.id));

    const title = document.createElement('p');
    title.className = 'task-item__title';
    title.textContent = task.title;
    if (task.pomodorosCompleted > 0) {
      title.textContent = `${task.title} (${task.pomodorosCompleted})`;
    }

    const track = document.createElement('button');
    const isTracking = task.id === state.tasksActiveId;
    track.type = 'button';
    track.className = `task-item__track${isTracking ? ' is-active' : ''}`;
    track.setAttribute('aria-label', isTracking ? `"${task.title}" is the active task` : `Set "${task.title}" as active task`);
    track.setAttribute('aria-pressed', isTracking ? 'true' : 'false');
    track.disabled = task.done;
    track.textContent = isTracking ? 'Active' : 'Set active';
    track.addEventListener('click', () => setActiveTask(task.id));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'task-item__delete';
    remove.setAttribute('aria-label', `Delete "${task.title}"`);
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => deleteTask(task.id));

    li.append(toggle, title, track, remove);
    tasksListEl.append(li);
  });
}

function renderSettings() {
  settingsInputs.workMin.value = String(state.settings.workMin);
  settingsInputs.shortBreakMin.value = String(state.settings.shortBreakMin);
  settingsInputs.longBreakMin.value = String(state.settings.longBreakMin);
  settingsInputs.autoSwitch.checked = state.settings.autoSwitch;
}

function renderTabs() {
  modeTabEls.forEach((tab) => {
    const isCurrent = tab.dataset.modeTab === state.timer.mode;
    tab.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
    tab.classList.toggle('is-active', isCurrent);
  });
}

function render() {
  appEl.dataset.mode = state.timer.mode;
  modeEl.textContent = MODE_LABELS[state.timer.mode];
  displayEl.textContent = formatMmSs(state.timer.remainingSec);
  displayEl.dateTime = isoDuration(state.timer.remainingSec);
  toggleBtn.textContent = state.timer.isRunning ? 'Pause' : 'Start';
  toggleBtn.setAttribute('aria-pressed', state.timer.isRunning ? 'true' : 'false');
  sessionCountEl.textContent = String(state.sessions.completedPomodoros);
  nextEl.textContent = state.timer.blockedOnFinish
    ? 'Session complete. Press Start to begin the next phase.'
    : nextModeHint();

  const pendingCount = state.tasks.filter((task) => !task.done).length;
  const doneCount = state.tasks.length - pendingCount;
  tasksPendingCountEl.textContent = String(pendingCount);
  tasksDoneCountEl.textContent = String(doneCount);
  const trackingTask = activeTask();
  activeTaskLabelEl.textContent = trackingTask?.title ?? 'No task selected';
  if (trackingTask) {
    const countLabel = trackingTask.pomodorosCompleted === 1 ? '1 focus session' : `${trackingTask.pomodorosCompleted} focus sessions`;
    activeTaskDetailEl.textContent = `This task: ${countLabel}.`;
  } else {
    activeTaskDetailEl.textContent = 'Pick a task below, or start a general focus session.';
  }

  renderTabs();
  renderTasks();
  renderSettings();
}

toggleBtn.addEventListener('click', () => {
  if (state.timer.isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
});

resetBtn.addEventListener('click', () => {
  resetTimer();
});

modeTabEls.forEach((tab) => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.modeTab;
    if (mode === 'work' || mode === 'shortBreak' || mode === 'longBreak') {
      setMode(mode);
    }
  });
});

tasksFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = taskInputEl.value.trim();
  if (!title) return;
  addTask(title);
  taskInputEl.value = '';
  taskInputEl.focus();
});

settingsFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const nextWork = clampMinutes(Number(settingsInputs.workMin.value));
  const nextShort = clampMinutes(Number(settingsInputs.shortBreakMin.value));
  const nextLong = clampMinutes(Number(settingsInputs.longBreakMin.value));
  state.settings.workMin = nextWork;
  state.settings.shortBreakMin = nextShort;
  state.settings.longBreakMin = nextLong;
  state.settings.autoSwitch = settingsInputs.autoSwitch.checked;
  if (!state.timer.isRunning) {
    state.timer.remainingSec = durationForMode(state.timer.mode);
  } else {
    state.timer.targetEndMs = Date.now() + state.timer.remainingSec * 1000;
  }
  saveState();
  render();
});

settingsResetDefaultEl.addEventListener('click', () => {
  state.settings = { ...DEFAULT_SETTINGS };
  state.timer.isRunning = false;
  state.timer.targetEndMs = null;
  state.timer.remainingSec = durationForMode(state.timer.mode);
  syncTimerFromRunningState();
  saveState();
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLElement) {
    const isTypingTarget =
      event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA' ||
      event.target.isContentEditable;
    if (isTypingTarget) return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    if (state.timer.isRunning) pauseTimer();
    else startTimer();
  } else if (event.key.toLowerCase() === 'r') {
    resetTimer();
  } else if (event.key === '1') {
    setMode('work');
  } else if (event.key === '2') {
    setMode('shortBreak');
  } else if (event.key === '3') {
    setMode('longBreak');
  }
});
