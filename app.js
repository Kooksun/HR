import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getDatabase,
  get,
  ref,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

/**
 * Horse Racing Arena bootstrap.
 * Phase 2 adds Firebase bootstrapping, simulation constants, and telemetry hooks.
 */

const TICK_MS = 1_000;
const CHEER_BOOST_FACTOR = 0.05;
const LANE_CONFIG = Object.freeze({
  horseEmoji: "🏇",
  finishEmoji: "🏁",
  laneHeightPx: 64,
});
const SESSION_PATH = "sessions";
const ClientMode = Object.freeze({
  HOST: "host",
  SPECTATOR: "spectator",
});

const requestFrame =
  typeof globalThis.requestAnimationFrame === "function"
    ? (callback) => globalThis.requestAnimationFrame(callback)
    : (callback) => globalThis.setTimeout(() => callback(Date.now()), 16);

const cancelFrame =
  typeof globalThis.cancelAnimationFrame === "function"
    ? (frameId) => globalThis.cancelAnimationFrame(frameId)
    : (frameId) => globalThis.clearTimeout(frameId);

const selectors = {
  hostForm: document.querySelector("#host-form"),
  playerInput: document.querySelector("#player-names"),
  startButton: document.querySelector("#start-button"),
  tracksContainer: document.querySelector("#tracks"),
  countdownModal: document.querySelector("#countdown"),
  countdownValue: document.querySelector(".countdown-value"),
  resultsModal: document.querySelector("#results-modal"),
  resultsList: document.querySelector("#results-list"),
  resultsClose: document.querySelector("#results-close"),
};

const state = {
  players: [],
  mode: ClientMode.HOST,
  sessionId: null,
  firebaseApp: null,
  database: null,
  rng: null,
  tick: 0,
  raceStatus: "idle",
  finishOrder: [],
  countdownCancel: null,
  animationFrameId: null,
  accumulator: 0,
  previousTimestamp: null,
  seed: null,
};

function logSession(event, payload = {}) {
  console.info(`[session] ${event}`, payload);
}

function logTick(tickNumber, payload = {}) {
  console.debug(`[tick:${tickNumber}]`, payload);
}

function logFirebase(event, payload = {}) {
  console.info(`[firebase] ${event}`, payload);
}

function disableHostControls() {
  selectors.playerInput?.setAttribute("disabled", "true");
  selectors.startButton?.setAttribute("disabled", "true");
  selectors.hostForm?.setAttribute("aria-disabled", "true");
}

function enableHostControls() {
  selectors.playerInput?.removeAttribute("disabled");
  selectors.startButton?.removeAttribute("disabled");
  selectors.hostForm?.removeAttribute("aria-disabled");
}

function cancelCountdown() {
  if (typeof state.countdownCancel === "function") {
    state.countdownCancel();
    state.countdownCancel = null;
  }
}

function stopRaceLoop() {
  if (state.animationFrameId !== null) {
    cancelFrame(state.animationFrameId);
    state.animationFrameId = null;
  }
  state.accumulator = 0;
  state.previousTimestamp = null;
}

function updateCountdownDisplay(value) {
  if (!selectors.countdownValue) {
    return;
  }
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  selectors.countdownValue.textContent = String(safeValue);
}

function scheduleCountdown({ seconds = 5, onTick, onComplete } = {}) {
  let remaining = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const safeOnTick = typeof onTick === "function" ? onTick : () => {};
  const safeOnComplete = typeof onComplete === "function" ? onComplete : () => {};
  let cancelled = false;

  safeOnTick(remaining);
  logSession("countdown:tick", { value: remaining });

  const intervalId = globalThis.setInterval(() => {
    if (cancelled) {
      globalThis.clearInterval(intervalId);
      return;
    }

    remaining -= 1;
    safeOnTick(remaining);
    logSession("countdown:tick", { value: remaining });

    if (remaining <= 0) {
      globalThis.clearInterval(intervalId);
      cancelled = true;
      safeOnComplete();
    }
  }, 1_000);

  return () => {
    if (!cancelled) {
      cancelled = true;
      globalThis.clearInterval(intervalId);
    }
  };
}

function loadFirebaseConfig() {
  if (window.__FIREBASE_CONFIG__ && typeof window.__FIREBASE_CONFIG__ === "object") {
    return window.__FIREBASE_CONFIG__;
  }

  const configTag = document.querySelector("#firebase-config");
  if (configTag?.textContent) {
    try {
      return JSON.parse(configTag.textContent);
    } catch (error) {
      throw new Error(`Invalid Firebase config JSON: ${error.message}`);
    }
  }

  throw new Error(
    "Firebase configuration missing. Define window.__FIREBASE_CONFIG__ or provide a #firebase-config script tag.",
  );
}

async function detectClientMode(database) {
  const sessionsRef = ref(database, SESSION_PATH);
  const snapshot = await get(sessionsRef);
  if (!snapshot.exists()) {
    return { mode: ClientMode.HOST, sessionId: null, session: null };
  }

  const sessions = snapshot.val();
  const [sessionId, session] =
    Object.entries(sessions).find(([, value]) => value && value.status !== "finished") ?? [];

  if (!sessionId) {
    return { mode: ClientMode.HOST, sessionId: null, session: null };
  }

  return { mode: ClientMode.SPECTATOR, sessionId, session };
}

async function bootstrapFirebase() {
  const config = loadFirebaseConfig();
  const firebaseApp = initializeApp(config);
  const database = getDatabase(firebaseApp);

  logFirebase("config:loaded", { projectId: config.projectId });

  const detection = await detectClientMode(database);
  state.mode = detection.mode;
  state.sessionId = detection.sessionId;
  state.firebaseApp = firebaseApp;
  state.database = database;

  logSession("mode:detected", {
    mode: detection.mode,
    sessionId: detection.sessionId,
    status: detection.session?.status ?? "none",
  });

  return detection;
}

function createRng(seed) {
  if (!Number.isFinite(seed)) {
    throw new Error("Seed must be a finite number.");
  }

  let stateValue = (Math.abs(Math.floor(seed)) >>> 0) || 1;
  return () => {
    stateValue = (1664525 * stateValue + 1013904223) % 0x100000000;
    return stateValue / 0x100000000;
  };
}

async function cheerTransaction(playerId, sessionId = state.sessionId) {
  if (!sessionId) {
    throw new Error("Cannot cheer without an active session.");
  }
  if (!state.database) {
    throw new Error("Database not initialised.");
  }

  const cheersRef = ref(state.database, `${SESSION_PATH}/${sessionId}/players/${playerId}/cheerCount`);
  return runTransaction(cheersRef, (current) => {
    const next = (typeof current === "number" ? current : 0) + 1;
    return Number.isNaN(next) ? 0 : next;
  });
}

function createPlayerState(basePlayer, laneIndex) {
  return {
    ...basePlayer,
    laneIndex,
    distance: 0,
    cheerCount: 0,
    rank: null,
    finished: false,
    finishTick: null,
    elements: {},
  };
}

function updateHorsePosition(player) {
  if (!player) {
    return;
  }
  const horseEl = player.elements?.horse;
  if (!horseEl) {
    return;
  }
  const progressPercent = Math.min(player.distance * 100, 100);
  horseEl.style.transform = `translate(${progressPercent}%, -50%) scaleX(-1)`;
}

function appendResultEntry(player) {
  if (!selectors.resultsList) {
    return;
  }
  const item = document.createElement("li");
  item.textContent = `${player.rank}. ${player.name}`;
  selectors.resultsList.appendChild(item);
}

function performRaceTick() {
  if (typeof state.rng !== "function") {
    state.rng = createRng(Date.now());
  }

  state.tick += 1;

  const tickSummary = [];

  state.players.forEach((player) => {
    if (player.finished) {
      tickSummary.push({
        playerId: player.id,
        distance: player.distance,
        finished: true,
        rank: player.rank,
        cheerCount: player.cheerCount,
        baseStep: 0,
        cheerBoost: 0,
        totalStep: 0,
      });
      return;
    }

    const baseStep = 0.2 + state.rng() * 0.6;
    const cheerBoost = player.cheerCount * CHEER_BOOST_FACTOR;
    const remainingDistance = Math.max(0, 1 - player.distance);
    const totalStep = Math.min(baseStep + cheerBoost, remainingDistance);

    player.distance = Math.min(1, player.distance + totalStep);
    updateHorsePosition(player);

    if (player.distance >= 1) {
      player.finished = true;
      player.finishTick = state.tick;
      player.rank = state.finishOrder.length + 1;
      state.finishOrder.push(player);
      appendResultEntry(player);
    }

    tickSummary.push({
      playerId: player.id,
      baseStep,
      cheerBoost,
      totalStep,
      distance: player.distance,
      cheerCount: player.cheerCount,
      finished: player.finished,
      rank: player.rank,
    });
  });

  logTick(state.tick, { players: tickSummary });

  if (state.finishOrder.length === state.players.length) {
    finishRace();
  }
}

function finishRace() {
  state.raceStatus = "finished";
  stopRaceLoop();

  selectors.resultsModal?.classList.remove("hidden");
  enableHostControls();
  selectors.resultsClose?.focus();

  logSession("race:completed", {
    finishOrder: state.finishOrder.map((player) => ({
      playerId: player.id,
      name: player.name,
      rank: player.rank,
      finishTick: player.finishTick,
    })),
  });
}

function startRaceLoop() {
  if (state.players.length === 0) {
    state.raceStatus = "idle";
    enableHostControls();
    return;
  }

  state.raceStatus = "running";
  state.accumulator = 0;
  state.previousTimestamp = null;

  const step = (timestamp) => {
    if (state.previousTimestamp === null) {
      state.previousTimestamp = timestamp;
    }

    const delta = timestamp - state.previousTimestamp;
    state.previousTimestamp = timestamp;
    state.accumulator += delta;

    while (state.accumulator >= TICK_MS && state.raceStatus === "running") {
      state.accumulator -= TICK_MS;
      performRaceTick();
    }

    if (state.raceStatus === "running") {
      state.animationFrameId = requestFrame(step);
    }
  };

  state.animationFrameId = requestFrame(step);
}

function renderInitialTracks() {
  if (!selectors.tracksContainer) {
    return;
  }

  selectors.tracksContainer.innerHTML = "";

  state.players.forEach((player) => {
    const track = document.createElement("article");
    track.className = "track";
    track.dataset.playerId = player.id;
    track.dataset.laneIndex = String(player.laneIndex);

    const name = document.createElement("div");
    name.className = "track-name";
    name.textContent = player.name;

    const lane = document.createElement("div");
    lane.className = "track-lane";
    lane.style.height = `${LANE_CONFIG.laneHeightPx}px`;

    const horse = document.createElement("span");
    horse.className = "horse";
    horse.setAttribute("role", "img");
    horse.setAttribute("aria-label", `${player.name} horse`);
    horse.textContent = LANE_CONFIG.horseEmoji;
    horse.style.transform = "translate(0%, -50%) scaleX(-1)";
    lane.appendChild(horse);

    const finish = document.createElement("div");
    finish.className = "finish-line";
    finish.textContent = LANE_CONFIG.finishEmoji;

    track.append(name, lane, finish);
    selectors.tracksContainer.appendChild(track);

    player.elements = {
      track,
      name,
      lane,
      horse,
      finish,
    };
  });
}

function parsePlayerNames(rawValue) {
  const seen = new Set();
  return rawValue
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((name, index) => ({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      laneIndex: index,
    }));
}

function handleStart(event) {
  event.preventDefault();
  if (state.raceStatus === "countdown" || state.raceStatus === "running") {
    return;
  }

  const rawValue = selectors.playerInput.value ?? "";
  const players = parsePlayerNames(rawValue);
  if (players.length < 2 || players.length > 10) {
    window.alert("Enter between 2 and 10 unique player names (comma separated).");
    return;
  }

  cancelCountdown();
  stopRaceLoop();

  state.players = players.map((player, index) => createPlayerState(player, index));
  state.finishOrder = [];
  state.tick = 0;
  state.seed =
    typeof window.__RACE_SEED__ === "number" && Number.isFinite(window.__RACE_SEED__)
      ? window.__RACE_SEED__
      : Date.now();
  state.rng = createRng(state.seed);
  state.raceStatus = "countdown";

  if (selectors.resultsList) {
    selectors.resultsList.innerHTML = "";
  }
  selectors.resultsModal?.classList.add("hidden");

  renderInitialTracks();
  state.players.forEach(updateHorsePosition);

  logSession("host:players-registered", {
    players: players.map((p) => p.name),
    seed: state.seed,
  });

  disableHostControls();
  selectors.countdownModal?.classList.remove("hidden");
  updateCountdownDisplay(5);

  state.countdownCancel = scheduleCountdown({
    seconds: 5,
    onTick: updateCountdownDisplay,
    onComplete: () => {
      state.countdownCancel = null;
      selectors.countdownModal?.classList.add("hidden");
      logSession("countdown:complete");
      logSession("race:start", { tickIntervalMs: TICK_MS, playerCount: state.players.length });
      startRaceLoop();
    },
  });
}

function registerEventListeners() {
  selectors.hostForm?.addEventListener("submit", handleStart);
  selectors.resultsClose?.addEventListener("click", () => {
    selectors.resultsModal?.classList.add("hidden");
    selectors.resultsList?.replaceChildren();
    enableHostControls();
    state.raceStatus = "idle";
    logSession("results:closed");
    selectors.playerInput?.focus();
  });
}

function init() {
  registerEventListeners();
  selectors.countdownModal?.classList.add("hidden");
  selectors.resultsModal?.classList.add("hidden");

  bootstrapFirebase()
    .then((detection) => {
      if (detection.mode === ClientMode.SPECTATOR) {
        selectors.hostForm?.classList.add("hidden");
      } else {
        selectors.hostForm?.classList.remove("hidden");
      }
    })
    .catch((error) => {
      logFirebase("error", { message: error.message });
      selectors.hostForm?.classList.remove("hidden");
    });
}

init();

export {
  CHEER_BOOST_FACTOR,
  ClientMode,
  LANE_CONFIG,
  SESSION_PATH,
  TICK_MS,
  cheerTransaction,
  createRng,
  loadFirebaseConfig,
  logFirebase,
  logSession,
  logTick,
  parsePlayerNames,
  renderInitialTracks,
  scheduleCountdown,
  state,
};
