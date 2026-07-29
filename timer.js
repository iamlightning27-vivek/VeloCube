//----Timer Start----
(function () {
  const timeEl = document.querySelector('.time');
  const HOLD_DURATION = 500; // ms

  // states: 'idle' | 'holding' | 'ready' | 'running'
  let state = 'idle';
  let holdTimeoutId = null;
  let startTimestamp = null;
  let rafId = null;

  function formatTime(ms) {
    const totalSeconds = ms / 1000;
    return totalSeconds.toFixed(2);
  }

  function setColor(color) {
    timeEl.style.color = color;
  }

  function updateDisplay() {
    const elapsed = performance.now() - startTimestamp;
    timeEl.textContent = formatTime(elapsed);
    rafId = requestAnimationFrame(updateDisplay);
  }

  function startHolding() {
    if (state !== 'idle') return;
    state = 'holding';
    holdTimeoutId = setTimeout(() => {
      state = 'ready';
      setColor('lightgreen');
    }, HOLD_DURATION);

    // A new solve is starting, so hide the previous solve's action buttons
    hidePostActions();

    //Increasing font size during running

    timeEl.style.transition = "font-size 0.3s ease-in-out";
    timeEl.style.fontSize = "25vw";

  }

  function cancelHolding() {
    // Released before reaching 0.5s -> just go back to idle, no start
    if (holdTimeoutId) {
      clearTimeout(holdTimeoutId);
      holdTimeoutId = null;
    }
    state = 'idle';
    setColor('white');
  }

  function releaseToStart() {
    // Called on release when state === 'ready'
    if (holdTimeoutId) {
      clearTimeout(holdTimeoutId);
      holdTimeoutId = null;
    }
    state = 'running';
    setColor('white');
    startTimestamp = performance.now();
    rafId = requestAnimationFrame(updateDisplay);
  }

  function stopTimer() {
    // Capture the exact elapsed time at the moment of stopping,
    // so the recorded solve matches what's displayed.
    const elapsed = performance.now() - startTimestamp;

    state = 'idle';
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    setColor('white');
    timeEl.style.fontSize = '20vw';
    timeEl.textContent = formatTime(elapsed);

    // Record this solve against the scramble that was used for it,
    // then generate the next scramble and reveal the edit buttons.
    recordSolve(elapsed, currentScramble);
    newScramble();
    showPostActions();
  }

  // ---- Handling logic shared by touch/mouse and keyboard ----

  function handlePressStart() {
    if (state === 'running') {
      stopTimer();
    } else if (state === 'idle') {
      startHolding();
    }
    // if state is 'holding' or 'ready' already, ignore (avoids repeat events)
  }

  function handlePressEnd() {
    if (state === 'holding') {
      cancelHolding();
    } else if (state === 'ready') {
      releaseToStart();
    }
    // if state is 'idle' or 'running', nothing to do on release
  }

  // Ignore taps/clicks/keys that land on the history or post-solve UI,
  // so interacting with them doesn't also start/stop the timer.
  function isControlUI(e) {
    return e.target.closest('#historyBtn, #historyPanel, #postActions, #sessionBtn, #sessionPanel');
  }

  // ---- Touch / mouse events ----

  document.addEventListener('touchstart', function (e) {
    if (isControlUI(e)) return;
    e.preventDefault();
    handlePressStart();
  }, { passive: false });

  document.addEventListener('touchend', function (e) {
    if (isControlUI(e)) return;
    e.preventDefault();
    handlePressEnd();
  }, { passive: false });

  document.addEventListener('mousedown', function (e) {
    if (isControlUI(e)) return;
    handlePressStart();
  });

  document.addEventListener('mouseup', function (e) {
    if (isControlUI(e)) return;
    handlePressEnd();
  });

  // ---- Keyboard (spacebar) events ----

  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (e.repeat) return; // ignore held-key auto-repeat
      handlePressStart();
    }
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      handlePressEnd();
    }
  });
})();

//----Scramble Generate----
const scrambleEl = document.querySelector('.scramble');
const SCRAMBLE_LENGTH = 20;
const FACES = ['R', 'L', 'U', 'D', 'F', 'B'];
const MODIFIERS = ['', "'", '2'];

// Holds the scramble currently shown on screen, so a finishing solve
// can be recorded against the scramble it was actually solved with.
let currentScramble = '';

function generateScramble() {
  const moves = [];
  let lastFace = null;

  for (let i = 0; i < SCRAMBLE_LENGTH; i++) {
    let face;
    do {
      face = FACES[Math.floor(Math.random() * FACES.length)];
    } while (face === lastFace);

    const modifier = MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)];
    moves.push(face + modifier);
    lastFace = face;
  }

  return moves.join(' ');
}

function newScramble() {
  currentScramble = generateScramble();
  if (scrambleEl) {
    scrambleEl.textContent = currentScramble;
  }
}

// Ensure the DOM (including .scramble div) is ready before generating
document.addEventListener('DOMContentLoaded', newScramble);

//----Sessions & Solve History & Stats----
const SESSIONS_KEY = 'cubeSessions';
let sessions = [];
let currentSessionId = null;
let lastSolveId = null; // id of the most recently recorded solve

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getCurrentSession() {
  return sessions.find(s => s.id === currentSessionId) || sessions[0];
}

function saveSessions() {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify({ sessions, currentSessionId }));
  } catch (e) {
    // storage full or unavailable - stats still work for this session
  }
}

function loadSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY));
    if (raw && Array.isArray(raw.sessions) && raw.sessions.length) {
      sessions = raw.sessions;
      currentSessionId = raw.currentSessionId || sessions[0].id;
      return;
    }
  } catch (e) {
    // fall through to fresh/migrated setup below
  }

  // Migrate solves saved by an older version of this timer (single array,
  // no sessions) into a first session, so nothing is lost.
  let migratedSolves = [];
  try {
    const old = JSON.parse(localStorage.getItem('cubeSolves'));
    if (Array.isArray(old)) {
      migratedSolves = old.map(s => ({ ...s, id: s.id || generateId() }));
    }
  } catch (e) {
    // no old data to migrate
  }
  localStorage.removeItem('cubeSolves');

  const firstSession = { id: generateId(), name: 'Session 1', solves: migratedSolves };
  sessions = [firstSession];
  currentSessionId = firstSession.id;
  saveSessions();
}

loadSessions();

function formatMs(ms) {
  return (ms / 1000).toFixed(2);
}

// The time to use for maths: DNF counts as infinitely slow,
// +2 adds a two second penalty.
function getEffectiveTime(solve) {
  if (solve.penalty === 'DNF') return Infinity;
  if (solve.penalty === '+2') return solve.time + 2000;
  return solve.time;
}

// The text to show for a single solve (in history or on the timer).
function formatSolve(solve) {
  if (solve.penalty === 'DNF') return 'DNF';
  const t = getEffectiveTime(solve);
  return formatMs(t) + (solve.penalty === '+2' ? '+' : '');
}

// Average of N: take the last N solves, drop the single best and
// single worst, average what's left. Returns null if not enough solves,
// Infinity if the result is a DNF average.
function averageOfN(n) {
  const solves = getCurrentSession().solves;
  if (solves.length < n) return null;
  const lastN = solves.slice(-n).map(getEffectiveTime);
  const sorted = [...lastN].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, sorted.length - 1);
  if (trimmed.some(t => t === Infinity)) return Infinity;
  const sum = trimmed.reduce((a, b) => a + b, 0);
  return sum / trimmed.length;
}

function recordSolve(timeMs, scrambleText) {
  const solve = {
    id: generateId(),
    time: timeMs,
    scramble: scrambleText,
    date: Date.now(),
    penalty: null // null | '+2' | 'DNF'
  };
  getCurrentSession().solves.push(solve);
  lastSolveId = solve.id;
  saveSessions();
  updateStatsUI();
  renderHistory();
}

function updateStatsUI() {
  const statBest = document.getElementById('statBest');
  const statMean = document.getElementById('statMean');
  const statCount = document.getElementById('statCount');
  const statAo5 = document.getElementById('statAo5');
  const statAo12 = document.getElementById('statAo12');
  const statAo50 = document.getElementById('statAo50');

  const solves = getCurrentSession().solves;
  const validTimes = solves
    .map(getEffectiveTime)
    .filter(t => t !== Infinity);

  statCount.textContent = solves.length;
  statBest.textContent = validTimes.length ? formatMs(Math.min(...validTimes)) : '-';
  statMean.textContent = validTimes.length
    ? formatMs(validTimes.reduce((a, b) => a + b, 0) / validTimes.length)
    : '-';

  const ao5 = averageOfN(5);
  const ao12 = averageOfN(12);
  const ao50 = averageOfN(50);

  statAo5.textContent = ao5 === null ? '-' : (ao5 === Infinity ? 'DNF' : formatMs(ao5));
  statAo12.textContent = ao12 === null ? '-' : (ao12 === Infinity ? 'DNF' : formatMs(ao12));
  statAo50.textContent = ao50 === null ? '-' : (ao50 === Infinity ? 'DNF' : formatMs(ao50));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderHistory() {
  const listEl = document.getElementById('historyList');
  if (!listEl) return;
  const solves = getCurrentSession().solves;

  if (solves.length === 0) {
    listEl.innerHTML = '<div class="history-empty">No solves yet</div>';
    return;
  }

  // Newest first
  const rows = solves
    .map((s, i) => {
      return `
        <div class="history-item" data-id="${s.id}">
          <div class="history-item-top">
            <div class="history-item-left">
              <span class="history-index">#${i + 1}</span>
              <span class="history-time">${formatSolve(s)}</span>
            </div>
            <button class="history-delete-btn" data-id="${s.id}" title="Delete solve">&times;</button>
          </div>
          <div class="history-scramble">${escapeHtml(s.scramble)}</div>
        </div>
      `;
    })
    .reverse();

  listEl.innerHTML = rows.join('');
}

//----Post-solve action buttons (delete / +2 / DNF)----

function showPostActions() {
  const postActions = document.getElementById('postActions');
  if (postActions) postActions.classList.add('visible');
}

function hidePostActions() {
  const postActions = document.getElementById('postActions');
  if (postActions) postActions.classList.remove('visible');
}

// Deletes any solve by id, from any panel (post-solve buttons or history list).
function deleteSolveById(id) {
  const session = getCurrentSession();
  const idx = session.solves.findIndex(s => s.id === id);
  if (idx === -1) return;
  session.solves.splice(idx, 1);

  if (lastSolveId === id) {
    lastSolveId = null;
    hidePostActions();
    const timeEl = document.querySelector('.time');
    timeEl.style.color = 'white';
    timeEl.textContent = '0.00';
  }

  saveSessions();
  updateStatsUI();
  renderHistory();
}

function deleteLastSolve() {
  if (!lastSolveId) return;
  deleteSolveById(lastSolveId);
}

function applyPlus2() {
  const solve = getCurrentSession().solves.find(s => s.id === lastSolveId);
  if (!solve || solve.penalty === 'DNF') return;
  solve.penalty = '+2';
  saveSessions();
  updateStatsUI();
  renderHistory();
  document.querySelector('.time').textContent = formatSolve(solve);
}

function applyDNF() {
  const solve = getCurrentSession().solves.find(s => s.id === lastSolveId);
  if (!solve) return;
  solve.penalty = 'DNF';
  saveSessions();
  updateStatsUI();
  renderHistory();
  document.querySelector('.time').textContent = 'DNF';
}

//----History panel: open/close + swipe-right-to-close----

function initHistorySwipe() {
  const panel = document.getElementById('historyPanel');
  if (!panel) return;

  let startX = null;
  let currentX = null;

  panel.addEventListener('touchstart', function (e) {
    startX = e.touches[0].clientX;
    currentX = startX;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', function (e) {
    if (startX === null) return;
    currentX = e.touches[0].clientX;
    const deltaX = Math.max(0, currentX - startX);
    panel.style.transform = `translateX(${deltaX}px)`;
  }, { passive: true });

  panel.addEventListener('touchend', function () {
    if (startX === null) return;
    const deltaX = currentX - startX;
    panel.style.transition = '';
    panel.style.transform = '';

    if (deltaX > 80) {
      panel.classList.remove('open');
    }
    startX = null;
    currentX = null;
  });
}

//----Sessions: render, switch, create----

function renderSessions() {
  const listEl = document.getElementById('sessionList');
  if (!listEl) return;

  const rows = sessions.map(s => {
    const active = s.id === currentSessionId ? ' active' : '';
    return `
      <div class="session-item${active}" data-id="${s.id}">
        <span class="session-item-name">${escapeHtml(s.name)}</span>
        <span class="session-item-count">${s.solves.length} solves</span>
      </div>
    `;
  });

  listEl.innerHTML = rows.join('');
}

function switchSession(id) {
  if (id === currentSessionId) return;
  currentSessionId = id;
  lastSolveId = null;
  hidePostActions();
  saveSessions();

  const timeEl = document.querySelector('.time');
  timeEl.style.color = 'white';
  timeEl.textContent = '0.00';

  updateStatsUI();
  renderHistory();
  renderSessions();
  newScramble(); // fresh scramble to go with the fresh session
}

function createNewSession() {
  const session = {
    id: generateId(),
    name: 'Session ' + (sessions.length + 1),
    solves: []
  };
  sessions.push(session);
  switchSession(session.id);
}

function initSessionSwipe() {
  const panel = document.getElementById('sessionPanel');
  if (!panel) return;

  let startX = null;
  let currentX = null;

  panel.addEventListener('touchstart', function (e) {
    startX = e.touches[0].clientX;
    currentX = startX;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', function (e) {
    if (startX === null) return;
    currentX = e.touches[0].clientX;
    const deltaX = Math.min(0, currentX - startX);
    panel.style.transform = `translateX(${deltaX}px)`;
  }, { passive: true });

  panel.addEventListener('touchend', function () {
    if (startX === null) return;
    const deltaX = currentX - startX;
    panel.style.transition = '';
    panel.style.transform = '';

    if (deltaX < -80) {
      panel.classList.remove('open');
    }
    startX = null;
    currentX = null;
  });
}

document.addEventListener('DOMContentLoaded', function () {
  const historyBtn = document.getElementById('historyBtn');
  const historyPanel = document.getElementById('historyPanel');
  const closeHistory = document.getElementById('closeHistory');

  const sessionBtn = document.getElementById('sessionBtn');
  const sessionPanel = document.getElementById('sessionPanel');
  const closeSession = document.getElementById('closeSession');

  historyBtn.addEventListener('click', function () {
    sessionPanel.classList.remove('open');
    historyPanel.classList.add('open');
  });

  closeHistory.addEventListener('click', function () {
    historyPanel.classList.remove('open');
  });

  sessionBtn.addEventListener('click', function () {
    historyPanel.classList.remove('open');
    renderSessions();
    sessionPanel.classList.add('open');
  });

  closeSession.addEventListener('click', function () {
    sessionPanel.classList.remove('open');
  });

  document.getElementById('sessionList').addEventListener('click', function (e) {
    const item = e.target.closest('.session-item');
    if (!item) return;
    switchSession(item.dataset.id);
  });

  document.getElementById('newSessionBtn').addEventListener('click', createNewSession);

  document.getElementById('historyList').addEventListener('click', function (e) {
    const btn = e.target.closest('.history-delete-btn');
    if (!btn) return;
    deleteSolveById(btn.dataset.id);
  });

  document.getElementById('btnDelete').addEventListener('click', deleteLastSolve);
  document.getElementById('btnPlus2').addEventListener('click', applyPlus2);
  document.getElementById('btnDNF').addEventListener('click', applyDNF);

  initHistorySwipe();
  initSessionSwipe();
  updateStatsUI();
  renderHistory();
  renderSessions();
});
