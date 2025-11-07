import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getDatabase,
  get,
  ref,
  runTransaction,
  set,
  update,
  onValue,
  remove,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

/**
 * Horse Racing Arena bootstrap.
 * Phase 2 adds Firebase bootstrapping, simulation constants, and telemetry hooks.
 */

const TICK_MS = 1_000;
const CHEER_BOOST_FACTOR = 0.0005;
const LANE_CONFIG = Object.freeze({
  horseEmoji: "🏇",
  finishEmoji: "🏁",
  laneHeightPx: 32,
});
const SESSION_PATH = "sessions";
const ClientMode = Object.freeze({
  HOST: "host",
  SPECTATOR: "spectator",
});
const LOCAL_SESSION_KEY = "horse-racing-session";

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
  spectatorPanel: document.querySelector("#spectator-panel"),
  spectatorStatus: document.querySelector("#spectator-status"),
  cheerButtons: document.querySelector("#cheer-buttons"),
};

const state = {
  players: [],
  mode: ClientMode.HOST,
  sessionId: null,
  firebaseApp: null,
  database: null,
  auth: null,
  rng: null,
  tick: 0,
  raceStatus: "idle",
  finishOrder: [],
  countdownCancel: null,
  animationFrameId: null,
  accumulator: 0,
  previousTimestamp: null,
  seed: null,
  sessionRef: null,
  playersUnsubscribe: null,
  cheerButtonRefs: new Map(),
  offlineMode: false,
  bus: null,
  sessionBroadcastTimer: null,
  forcedMode: null,
  localCachePollTimer: null,
  cleanupPromise: null,
};

if (typeof window !== "undefined") {
  window.__APP_STATE__ = state;
}

function logSession(event, payload = {}) {
  console.info(`[session] ${event}`, payload);
}

function logTick(tickNumber, payload = {}) {
  console.debug(`[tick:${tickNumber}]`, payload);
}

function logFirebase(event, payload = {}) {
  console.info(`[firebase] ${event}`, payload);
}

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.floor(Math.random() * 1_000)}`;
}

async function ensureAnonymousAuth(firebaseApp) {
  if (!firebaseApp) {
    throw new Error("Firebase app not initialised");
  }

  if (state.auth?.currentUser) {
    return state.auth.currentUser;
  }

  const auth = getAuth(firebaseApp);
  state.auth = auth;
  try {
    const cred = await signInAnonymously(auth);
    logFirebase("auth:anonymous", { uid: cred.user?.uid ?? "unknown" });
    return cred.user;
  } catch (error) {
    logFirebase("auth:error", { message: error.message });
    throw error;
  }
}

function setupBroadcastChannel() {
  if (state.bus || typeof BroadcastChannel === "undefined") {
    return;
  }

  const channel = new BroadcastChannel("horse-racing-arena");
  channel.onmessage = handleBusMessage;
  state.bus = channel;
}

function publishBus(type, payload = {}) {
  if (!state.bus) {
    return;
  }
  try {
    state.bus.postMessage({ type, payload });
  } catch (error) {
    logSession("bus:error", { message: error.message, type });
  }
}

function getSessionBroadcastPayload() {
  return {
    origin: "host",
    sessionId: state.sessionId,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      laneIndex: player.laneIndex,
      cheerCount: player.cheerCount,
    })),
  };
}

function startSessionBroadcastLoop() {
  stopSessionBroadcastLoop();
  if (!state.bus) {
    return;
  }
  let iterations = 0;
  state.sessionBroadcastTimer = globalThis.setInterval(() => {
    iterations += 1;
    publishBus("session-created", getSessionBroadcastPayload());
    if (iterations >= 5) {
      stopSessionBroadcastLoop();
    }
  }, 1_000);
}

function stopSessionBroadcastLoop() {
  if (state.sessionBroadcastTimer) {
    globalThis.clearInterval(state.sessionBroadcastTimer);
    state.sessionBroadcastTimer = null;
  }
}

function persistSessionCache(owner = "host") {
  if (typeof localStorage === "undefined" || !state.sessionId) {
    return;
  }
  try {
    const payload = {
      owner,
      sessionId: state.sessionId,
      players: state.players.map((player) => ({
        id: player.id,
        name: player.name,
        laneIndex: player.laneIndex,
        cheerCount: player.cheerCount,
      })),
      updatedAt: Date.now(),
    };
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(payload));
  } catch (error) {
    logSession("cache:error", { message: error.message });
  }
}

function loadSessionCache() {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    logSession("cache:load-error", { message: error.message });
    return null;
  }
}

function clearSessionCache() {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch (error) {
    logSession("cache:clear-error", { message: error.message });
  }
}

function playersArrayToSnapshot(playersArray = []) {
  return playersArray.reduce((acc, player, index) => {
    if (!player?.id) {
      return acc;
    }
    acc[player.id] = {
      name: player.name ?? player.id,
      laneIndex: player.laneIndex ?? index,
      cheerCount: player.cheerCount ?? 0,
    };
    return acc;
  }, {});
}

function startLocalCachePoll() {
  stopLocalCachePoll();
  state.localCachePollTimer = globalThis.setInterval(() => {
    const cached = loadSessionCache();
    if (cached?.sessionId) {
      enterSpectatorMode(cached.sessionId, {
        players: playersArrayToSnapshot(cached.players),
      });
      stopLocalCachePoll();
    }
  }, 1_000);
}

function stopLocalCachePoll() {
  if (state.localCachePollTimer) {
    globalThis.clearInterval(state.localCachePollTimer);
    state.localCachePollTimer = null;
  }
}

function handleBusMessage(event) {
  const data = event?.data;
  if (!data || typeof data !== "object") {
    return;
  }

  const { type, payload } = data;
  switch (type) {
    case "session-created": {
      const { sessionId, players, origin } = payload ?? {};
      if (!sessionId || !players) {
        return;
      }
      if (origin === "host" && state.sessionId === sessionId) {
        return;
      }
      const playersSnapshot = {};
      players.forEach((player, index) => {
        playersSnapshot[player.id] = {
          name: player.name,
          laneIndex: player.laneIndex ?? index,
          cheerCount: player.cheerCount ?? 0,
        };
      });
      enterSpectatorMode(sessionId, { players: playersSnapshot });
      break;
    }
    case "cheer": {
      const { sessionId, playerId, delta = 1 } = payload ?? {};
      if (!sessionId || !playerId || sessionId !== state.sessionId) {
        return;
      }
      if (state.mode === ClientMode.HOST && !state.offlineMode) {
        // Host will sync via Firebase; no need to double-apply.
        return;
      }
      const target = state.players.find((player) => player.id === playerId);
      if (!target) {
        return;
      }
      target.cheerCount = (target.cheerCount ?? 0) + delta;
      updateSpectatorCheerCounts();
      break;
    }
    case "session-finished": {
      const { sessionId } = payload ?? {};
      if (state.mode === ClientMode.SPECTATOR && sessionId === state.sessionId) {
        setSpectatorStatus("Race finished. Thanks for cheering!");
      }
      break;
    }
    default:
  }
}

function setSpectatorStatus(message) {
  if (selectors.spectatorStatus) {
    selectors.spectatorStatus.textContent = message;
  }
}

function hideElement(element) {
  element?.classList.add("hidden");
}

function showElement(element) {
  element?.classList.remove("hidden");
}

function clearPlayersSubscription() {
  if (typeof state.playersUnsubscribe === "function") {
    state.playersUnsubscribe();
    state.playersUnsubscribe = null;
  }
}

function hydratePlayersFromSnapshot(snapshotValue) {
  if (!snapshotValue) {
    return;
  }

  const playersList = Array.isArray(state.players) ? [...state.players] : [];
  const mapped = new Map(playersList.map((player) => [player.id, player]));

  Object.entries(snapshotValue).forEach(([playerId, remote]) => {
    const existing = mapped.get(playerId);
    if (existing) {
      existing.cheerCount = remote.cheerCount ?? existing.cheerCount ?? 0;
    } else {
      mapped.set(
        playerId,
        createPlayerState(
          {
            id: playerId,
            name: remote.name ?? playerId,
          },
          remote.laneIndex ?? playersList.length,
        ),
      );
    }
  });

  state.players = Array.from(mapped.values()).sort((a, b) => a.laneIndex - b.laneIndex);
}

function subscribeToPlayers(sessionId) {
  if (!state.database || !sessionId) {
    return;
  }

  clearPlayersSubscription();

  const playersRef = ref(state.database, `${SESSION_PATH}/${sessionId}/players`);
  state.playersUnsubscribe = onValue(
    playersRef,
    (snapshot) => {
      hydratePlayersFromSnapshot(snapshot.val());
      if (state.mode === ClientMode.SPECTATOR) {
        renderSpectatorButtons();
      } else {
        updateSpectatorCheerCounts();
      }
    },
    (error) => {
      logFirebase("players:subscription-error", { message: error.message });
    },
  );
}

function updateSpectatorCheerCounts() {
  if (!state.cheerButtonRefs?.size) {
    return;
  }
  state.players.forEach((player) => {
    const buttonElements = state.cheerButtonRefs.get(player.id);
    if (buttonElements?.countLabel) {
      buttonElements.countLabel.textContent = String(player.cheerCount ?? 0);
    }
  });
}

function renderSpectatorButtons() {
  if (!selectors.cheerButtons) {
    return;
  }

  selectors.cheerButtons.replaceChildren();
  state.cheerButtonRefs.clear();

  state.players.forEach((player) => {
    const wrapper = document.createElement("div");
    wrapper.className = "cheer-control";

    const label = document.createElement("span");
    label.className = "cheer-label";
    label.textContent = player.name;

    const count = document.createElement("span");
    count.className = "cheer-count";
    count.textContent = String(player.cheerCount ?? 0);

    const cheerButton = document.createElement("button");
    cheerButton.type = "button";
    cheerButton.className = "cheer-button";
    cheerButton.dataset.role = "cheer-button";
    cheerButton.dataset.playerId = player.id;
    cheerButton.setAttribute("aria-label", `Cheer for ${player.name}`);
    cheerButton.textContent = "응원 👏";
    cheerButton.addEventListener("click", () => handleCheerAction(player.id, 1));

    const hinderButton = document.createElement("button");
    hinderButton.type = "button";
    hinderButton.className = "hinder-button";
    hinderButton.dataset.role = "hinder-button";
    hinderButton.dataset.playerId = player.id;
    hinderButton.setAttribute("aria-label", `Hinder ${player.name}`);
    hinderButton.textContent = "방해 👎";
    hinderButton.addEventListener("click", () => handleCheerAction(player.id, -1));

    const buttonGroup = document.createElement("div");
    buttonGroup.className = "button-group";
    buttonGroup.append(cheerButton, hinderButton);

    wrapper.append(label, count, buttonGroup);
    selectors.cheerButtons.appendChild(wrapper);
    state.cheerButtonRefs.set(player.id, { cheerButton, hinderButton, countLabel: count });
  });

  updateSpectatorCheerCounts();
}

function enterSpectatorMode(sessionId, sessionData = {}) {
  stopLocalCachePoll();
  state.mode = ClientMode.SPECTATOR;
  state.sessionId = sessionId;

  const playersSnapshot = sessionData.players ?? {};
  state.players = Object.entries(playersSnapshot).map(([playerId, payload], index) =>
    createPlayerState(
      {
        id: playerId,
        name: payload.name ?? playerId,
      },
      payload.laneIndex ?? index,
    ),
  );
  state.players.forEach((player) => {
    player.cheerCount = playersSnapshot[player.id]?.cheerCount ?? 0;
  });

  hideElement(selectors.hostForm);
  hideElement(selectors.tracksContainer);
  showElement(selectors.spectatorPanel);
  setSpectatorStatus("Connected as spectator. Choose a horse to cheer!");
  renderSpectatorButtons();
  subscribeToPlayers(sessionId);
  persistSessionCache("spectator");
}

function leaveSpectatorMode() {
  if (state.mode === ClientMode.SPECTATOR) {
    state.mode = ClientMode.HOST;
    state.sessionId = null;
    state.cheerButtonRefs.clear();
    selectors.cheerButtons?.replaceChildren();
    hideElement(selectors.spectatorPanel);
    setSpectatorStatus("Searching for an active race…");
  }
  showElement(selectors.hostForm);
  showElement(selectors.tracksContainer);
}

function handleCheerAction(playerId, delta) {
  if (!playerId) {
    return;
  }

  const payload = {
    origin: "spectator",
    sessionId: state.sessionId,
    playerId,
    delta,
  };

  const useOffline = state.offlineMode || !state.database;
  const cheerPromise = useOffline
    ? Promise.reject(new Error("offline-mode"))
    : cheerTransaction(playerId, delta);

  cheerPromise
    .then(() => {
      const event = delta > 0 ? "cheer:committed" : "hinder:committed";
      logFirebase(event, { playerId, sessionId: state.sessionId, delta });
      publishBus("cheer", payload);
    })
    .catch((error) => {
      const event = delta > 0 ? "cheer:error" : "hinder:error";
      publishBus("cheer", payload);
      logFirebase(event, { message: error.message, playerId, delta });
    });
}

async function createSessionInFirebase() {
  let remoteEnabled = Boolean(state.database);
  if (!remoteEnabled) {
    state.offlineMode = true;
    logFirebase("session:error", { message: "Database not initialised" });
  } else {
    await ensureAnonymousAuth(state.firebaseApp);
  }

  state.sessionId = createSessionId();

  if (remoteEnabled) {
    const sessionRef = ref(state.database, `${SESSION_PATH}/${state.sessionId}`);
    state.sessionRef = sessionRef;

    const playersPayload = {};
    state.players.forEach((player) => {
      playersPayload[player.id] = {
        name: player.name,
        laneIndex: player.laneIndex,
        cheerCount: 0,
        distance: 0,
      };
    });

    state.offlineMode = false;
    try {
      await set(sessionRef, {
        status: "pending",
        seed: state.seed,
        tick: 0,
        createdAt: new Date().toISOString(),
        finishOrder: [],
        players: playersPayload,
      });

      logFirebase("session:created", { sessionId: state.sessionId, playerCount: state.players.length });
      subscribeToPlayers(state.sessionId);
    } catch (error) {
      state.offlineMode = true;
      logFirebase("session:create-error", { message: error.message });
    }
  }

  publishBus("session-created", getSessionBroadcastPayload());
  startSessionBroadcastLoop();

  if (state.offlineMode) {
    logSession("session:offline-mode", { sessionId: state.sessionId });
  }

  logSession("cache:persist", { owner: "host", sessionId: state.sessionId });
  persistSessionCache("host");
}

function updateSessionPatch(patch) {
  if (!state.database || !state.sessionId || !patch) {
    return;
  }
  const sessionRef = ref(state.database, `${SESSION_PATH}/${state.sessionId}`);
  update(sessionRef, patch).catch((error) => {
    logFirebase("session:update-error", { message: error.message });
  });
}

async function cleanupSession({ reason = "manual", publish = true, resetUi = true } = {}) {
  if (state.cleanupPromise) {
    return state.cleanupPromise;
  }

  const executor = async () => {
    const activeSessionId = state.sessionId;
    const hadSession = Boolean(activeSessionId);

    cancelCountdown();
    stopRaceLoop();
    clearPlayersSubscription();
    stopSessionBroadcastLoop();

    if (hadSession && publish) {
      publishBus("session-finished", { sessionId: activeSessionId });
    }

    state.sessionId = null;
    state.sessionRef = null;
    state.raceStatus = "idle";
    state.mode = ClientMode.HOST;

    let removed = false;
    if (hadSession && state.database && !state.offlineMode) {
      try {
        const sessionRef = ref(state.database, `${SESSION_PATH}/${activeSessionId}`);
        await remove(sessionRef);
        removed = true;
        logFirebase("session:deleted", { sessionId: activeSessionId, reason });
      } catch (error) {
        logFirebase("session:delete-error", {
          sessionId: activeSessionId,
          reason,
          message: error.message,
        });
      }
    } else if (hadSession) {
      logFirebase("session:delete-skipped", {
        sessionId: activeSessionId,
        reason,
        offline: true,
      });
    }

    state.players = [];
    state.finishOrder = [];
    state.tick = 0;
    state.rng = null;
    state.seed = null;
    state.cheerButtonRefs.clear();

    selectors.tracksContainer?.replaceChildren?.();
    selectors.cheerButtons?.replaceChildren?.();
    selectors.resultsList?.replaceChildren?.();
    selectors.countdownModal?.classList.add("hidden");
    selectors.resultsModal?.classList.add("hidden");

    clearSessionCache();
    showElement(selectors.hostForm);
    hideElement(selectors.spectatorPanel);
    setSpectatorStatus("Waiting for host to start a race…");
    enableHostControls();

    if (resetUi) {
      selectors.playerInput?.focus();
    }

    logSession("session:cleanup", {
      sessionId: activeSessionId,
      reason,
      removed,
    });

    return removed;
  };

  const promise = executor().finally(() => {
    state.cleanupPromise = null;
  });
  state.cleanupPromise = promise;
  return promise;
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

  await ensureAnonymousAuth(firebaseApp);

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

async function cheerTransaction(playerId, delta = 1, sessionId = state.sessionId) {
  if (!sessionId) {
    throw new Error("Cannot cheer/hinder without an active session.");
  }
  if (!state.database) {
    throw new Error("Database not initialised.");
  }

  const cheersRef = ref(state.database, `${SESSION_PATH}/${sessionId}/players/${playerId}/cheerCount`);
  return runTransaction(cheersRef, (current) => {
    const currentVal = typeof current === "number" ? current : 0;
    const next = currentVal + delta; // Allow negative scores
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
  horseEl.style.left = `${progressPercent}%`;
  horseEl.style.transform = `translateX(-50%) translateY(-50%) scaleX(-1)`;
}

function appendResultEntry(player) {
  if (!selectors.resultsList) {
    return;
  }
  const item = document.createElement("li");
  item.textContent = `${player.rank}등 ${player.name}`;
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

    const baseStep = 0.015 + state.rng() * 0.035;
    const cheerBoost = player.cheerCount * CHEER_BOOST_FACTOR;
    const remainingDistance = Math.max(0, 1 - player.distance);
    const totalStep = Math.min(baseStep + cheerBoost, remainingDistance);

    player.distance = Math.min(1, player.distance + totalStep);
    updateHorsePosition(player);
    if (player.elements.cheerCountDisplay) {
      player.elements.cheerCountDisplay.textContent = ` (🎉 ${player.cheerCount ?? 0})`;
    }

    if (player.distance >= 1) {
      player.finished = true;
      player.finishTick = state.tick;
      player.rank = state.finishOrder.length + 1;
      state.finishOrder.push(player);
      appendResultEntry(player);
      if (player.elements.rankDisplay) {
        player.elements.rankDisplay.textContent = `${player.rank}등`;
        player.elements.rankDisplay.style.display = "block";
      }
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

  if (state.mode === ClientMode.HOST && state.sessionId) {
    const patch = { tick: state.tick };
    state.players.forEach((player) => {
      patch[`players/${player.id}/distance`] = Number(player.distance.toFixed(4));
      patch[`players/${player.id}/cheerCount`] = player.cheerCount ?? 0;
      if (player.rank != null) {
        patch[`players/${player.id}/rank`] = player.rank;
      }
    });
    updateSessionPatch(patch);
  }

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

  if (state.mode === ClientMode.HOST && state.sessionId) {
    updateSessionPatch({
      status: "finished",
      finishOrder: state.finishOrder.map((player) => player.id),
    });
  }

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



    const nameSpan = document.createElement("span");

    nameSpan.textContent = player.name;



    const cheerCountDisplay = document.createElement("span");

    cheerCountDisplay.className = "cheer-count-display";

    cheerCountDisplay.textContent = ` (🎉 ${player.cheerCount ?? 0})`;



    name.append(nameSpan, cheerCountDisplay);



    const lane = document.createElement("div");

    lane.className = "track-lane";

    lane.style.height = `${LANE_CONFIG.laneHeightPx}px`;



    const horse = document.createElement("span");

    horse.className = "horse";

    horse.setAttribute("role", "img");

    horse.setAttribute("aria-label", `${player.name} horse`);

    horse.textContent = LANE_CONFIG.horseEmoji;

    horse.style.left = "0%";

    horse.style.transform = "translateY(-50%) scaleX(-1)";

    horse.style.transition =

      "transform 0.75s cubic-bezier(0.4, 0, 0.2, 1), left 0.75s cubic-bezier(0.4, 0, 0.2, 1)";

    lane.appendChild(horse);



    const finish = document.createElement("div");

    finish.className = "finish-line";

    finish.textContent = LANE_CONFIG.finishEmoji;



    const rankDisplay = document.createElement("div");

    rankDisplay.className = "rank-display";

    rankDisplay.textContent = ""; // Initially empty

    lane.appendChild(rankDisplay);



    track.append(name, lane, finish);

    selectors.tracksContainer.appendChild(track);



    player.elements = {

      track,

      name,

      lane,

      horse,

      finish,

      rankDisplay,

      cheerCountDisplay,

    };

  });

}



function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function parsePlayerNames(rawValue) {
  const seen = new Set();
  const players = [];
  rawValue
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .forEach((name) => {
      const id = name.toLowerCase().replace(/[^a-z0-9\uac00-\ud7a3]+/g, "-");
      if (!seen.has(id)) {
        seen.add(id);
        players.push({
          id,
      name,
          laneIndex: players.length,
        });
      }
    });
  return players;
}

async function handleStart(event) {
  event.preventDefault();
  if (["pending", "countdown", "running"].includes(state.raceStatus)) {
    return;
  }

  const rawValue = selectors.playerInput.value ?? "";
  let players = parsePlayerNames(rawValue);
  shuffleArray(players);
  if (players.length < 2 || players.length > 8) {
    window.alert("Enter between 2 and 8 unique player names (comma separated).");
    return;
  }

  leaveSpectatorMode();
  cancelCountdown();
  stopRaceLoop();
  clearPlayersSubscription();
  stopSessionBroadcastLoop();

  state.players = players.map((player, index) => createPlayerState(player, index));
  state.finishOrder = [];
  state.tick = 0;
  state.seed =
    typeof window.__RACE_SEED__ === "number" && Number.isFinite(window.__RACE_SEED__)
      ? window.__RACE_SEED__
      : Date.now();
  state.rng = createRng(state.seed);
  state.raceStatus = "pending";

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

  await createSessionInFirebase();
  state.raceStatus = "countdown";
  updateSessionPatch({ status: "countdown" });

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
      updateSessionPatch({ status: "running" });
      logSession("race:start", { tickIntervalMs: TICK_MS, playerCount: state.players.length });
      startRaceLoop();
    },
  });
}

function registerEventListeners() {
  selectors.hostForm?.addEventListener("submit", handleStart);
  selectors.resultsClose?.addEventListener("click", async () => {
    if (state.mode === ClientMode.HOST) {
      updateSessionPatch({ status: "finished" });
    }
    await cleanupSession({ reason: "results-close" });
    logSession("results:closed");
  });

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("beforeunload", () => {
      if (state.mode === ClientMode.HOST && state.sessionId) {
        cleanupSession({ reason: "unload", resetUi: false }).catch(() => {});
      }
    });
  }
}

function init() {
  if (typeof window !== "undefined") {
    const search = window.location?.search ?? "";
    if (typeof search === "string" && search.length > 0) {
      const params = new URLSearchParams(search);
      if (params.get("mode") === "spectator") {
        state.forcedMode = ClientMode.SPECTATOR;
      }
    }
  }

  setupBroadcastChannel();
  registerEventListeners();
  selectors.countdownModal?.classList.add("hidden");
  selectors.resultsModal?.classList.add("hidden");

  bootstrapFirebase()
    .then((detection) => {
      const localSession = loadSessionCache();

      if (state.forcedMode === ClientMode.SPECTATOR) {
        state.mode = ClientMode.SPECTATOR;
        if (detection.sessionId) {
          enterSpectatorMode(detection.sessionId, detection.session ?? {});
        } else if (localSession?.sessionId) {
          enterSpectatorMode(localSession.sessionId, {
            players: playersArrayToSnapshot(localSession.players),
          });
        } else {
          hideElement(selectors.hostForm);
          showElement(selectors.spectatorPanel);
          setSpectatorStatus("Waiting for host to start a race…");
          startLocalCachePoll();
        }
        return;
      }

      if (detection.mode === ClientMode.SPECTATOR && detection.sessionId) {
        enterSpectatorMode(detection.sessionId, detection.session ?? {});
      } else {
        leaveSpectatorMode();
        if (localSession?.owner === "host" && Date.now() - (localSession.updatedAt ?? 0) > 60_000) {
          clearSessionCache();
        }
      }
    })
    .catch((error) => {
      logFirebase("error", { message: error.message });
      if (state.forcedMode === ClientMode.SPECTATOR) {
        state.mode = ClientMode.SPECTATOR;
        hideElement(selectors.hostForm);
        showElement(selectors.spectatorPanel);
        setSpectatorStatus("Unable to reach Firebase. Waiting for local race data…");
        startLocalCachePoll();
      } else {
        leaveSpectatorMode();
      }
    });
}

init();

const __TEST_ONLY__ = {
  performRaceTick,
  cleanupSession,
};

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
  __TEST_ONLY__,
};
