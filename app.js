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

function renderInitialTracks() {
  selectors.tracksContainer.innerHTML = "";
  state.players.forEach((player, laneIndex) => {
    const track = document.createElement("article");
    track.className = "track";
    track.dataset.playerId = player.id;

    const name = document.createElement("div");
    name.className = "track-name";
    name.textContent = player.name;

    const lane = document.createElement("div");
    lane.className = "track-lane";

    const horse = document.createElement("span");
    horse.className = "horse";
    horse.setAttribute("role", "img");
    horse.setAttribute("aria-label", `${player.name} horse`);
    horse.textContent = LANE_CONFIG.horseEmoji;
    lane.appendChild(horse);

    const finish = document.createElement("div");
    finish.className = "finish-line";
    finish.textContent = LANE_CONFIG.finishEmoji;

    track.append(name, lane, finish);
    selectors.tracksContainer.appendChild(track);
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
  const rawValue = selectors.playerInput.value ?? "";
  const players = parsePlayerNames(rawValue);
  if (players.length < 2 || players.length > 10) {
    window.alert("Enter between 2 and 10 unique player names (comma separated).");
    return;
  }

  state.players = players;
  renderInitialTracks();
  logSession("host:players-registered", { players: players.map((p) => p.name) });
  // Countdown, Firebase sync, and race logic implemented in later phases.
}

function registerEventListeners() {
  selectors.hostForm?.addEventListener("submit", handleStart);
  selectors.resultsClose?.addEventListener("click", () => {
    selectors.resultsModal?.classList.add("hidden");
    selectors.resultsList.innerHTML = "";
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
  state,
};
