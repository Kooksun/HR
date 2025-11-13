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

const TICK_MS = 500;
const CHEER_BOOST_FACTOR = 0.0004;
const BASE_LAP_DISTANCE = 1.5;
const DEFAULT_LAPS_REQUIRED = 1;
const COUNTDOWN_SECONDS = 5;
const TRACK_GEOMETRY = Object.freeze({
  viewBoxWidth: 800,
  viewBoxHeight: 520,
  radiusX: 320,
  radiusY: 200,
  startAngleDeg: 90,
  finishAngleDeg: 90,
  pathWidth: 600,
  pathHeight: 340,
  cornerRadius: 170,
  startReference: { x: 400, y: 100 },
});
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
  lapCountInput: document.querySelector("#lap-count"),
  startButton: document.querySelector("#start-button"),
  tracksContainer: document.querySelector("#tracks"),
  countdownModal: document.querySelector("#countdown"),
  countdownValue: document.querySelector(".countdown-value"),
  countdownLights: document.querySelectorAll(".countdown-light"),
  resultsModal: document.querySelector("#results-modal"),
  resultsList: document.querySelector("#results-list"),
  resultsClose: document.querySelector("#results-close"),
  spectatorPanel: document.querySelector("#spectator-panel"),
  spectatorStatus: document.querySelector("#spectator-status"),
  cheerButtons: document.querySelector("#cheer-buttons"),
  casterBoard: document.querySelector("#caster-board"),
  casterText: document.querySelector("#caster-text"),
  playerRoster: document.querySelector("#player-roster"),
  playerRosterList: document.querySelector("#player-roster-list"),
  runnerLayer: document.querySelector("#runner-layer"),
  trackSvg: document.querySelector("#oval-track-svg"),
  trackPath: document.querySelector("#track-middle-path"),
  lapIndicator: document.querySelector("#lap-indicator"),
};

const state = {
  players: [],
  lapsRequired: DEFAULT_LAPS_REQUIRED,
  mode: ClientMode.HOST,
  sessionId: null,
  firebaseApp: null,
  database: null,
  auth: null,
  rng: null,
  tick: 0,
  raceStatus: "idle",
  finishOrder: [],
  casterAnnouncements: new Set(),
  previousRanking: [],
  casterLock: false,
  casterLockTimer: null,
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
  totalRaceDistance: BASE_LAP_DISTANCE * DEFAULT_LAPS_REQUIRED,
  trackGeometry: TRACK_GEOMETRY,
  trackPathLength: 0,
  trackStartOffset: 0,
};

if (typeof window !== "undefined") {
  window.__APP_STATE__ = state;
}

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function normalizeRadians(angle) {
  let normalized = angle % (2 * Math.PI);
  if (normalized < 0) {
    normalized += 2 * Math.PI;
  }
  return normalized;
}

function getRaceDistance(laps = DEFAULT_LAPS_REQUIRED) {
  const safeLaps = Math.max(DEFAULT_LAPS_REQUIRED, Math.floor(laps) || DEFAULT_LAPS_REQUIRED);
  return BASE_LAP_DISTANCE * safeLaps;
}

function progressToAngle(totalProgress, laps = state.lapsRequired) {
  const safeProgress = clamp(totalProgress, 0, 1);
  const safeLaps = Math.max(DEFAULT_LAPS_REQUIRED, Math.floor(laps) || DEFAULT_LAPS_REQUIRED);
  const revolutions = safeProgress * safeLaps;
  const startRadians = degreesToRadians(TRACK_GEOMETRY.startAngleDeg);
  return normalizeRadians(startRadians + revolutions * 2 * Math.PI);
}

function angleToPoint(angle, geometry = TRACK_GEOMETRY) {
  const {
    viewBoxWidth,
    viewBoxHeight,
    radiusX = TRACK_GEOMETRY.radiusX,
    radiusY = TRACK_GEOMETRY.radiusY,
  } = geometry;

  const centerX = geometry.centerX ?? viewBoxWidth / 2;
  const centerY = geometry.centerY ?? viewBoxHeight / 2;

  return {
    x: centerX + radiusX * Math.cos(angle),
    y: centerY - radiusY * Math.sin(angle),
  };
}

function calculateLapMetrics(distance, laps = state.lapsRequired) {
  const totalDistance = getRaceDistance(laps);
  const safeDistance = clamp(Number(distance) || 0, 0, totalDistance);
  const normalized = totalDistance === 0 ? 0 : safeDistance / totalDistance;
  const safeLaps = Math.max(DEFAULT_LAPS_REQUIRED, Math.floor(laps) || DEFAULT_LAPS_REQUIRED);
  const lapProgressRaw = normalized * safeLaps;
  const lapsCompleted = Math.min(safeLaps, Math.floor(lapProgressRaw));
  const lapProgress = lapProgressRaw - lapsCompleted;
  const angleRadians = progressToAngle(normalized, safeLaps);

  return {
    totalDistance,
    normalized,
    lapsCompleted,
    lapProgress,
    angleRadians,
    angleDegrees: radiansToDegrees(angleRadians),
  };
}

function getPlayerInitial(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    return "?";
  }
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const iterator = segmenter.segment(trimmed)[Symbol.iterator]();
      const first = iterator.next();
      if (!first.done && first.value?.segment) {
        return first.value.segment;
      }
    } catch {
      // no-op; fallback below
    }
  }
  const [firstChar] = Array.from(trimmed);
  return firstChar ?? trimmed.charAt(0) ?? "?";
}

function comparePlayersByStanding(a, b) {
  const aRank = Number.isFinite(a.rank) ? a.rank : null;
  const bRank = Number.isFinite(b.rank) ? b.rank : null;

  if (aRank != null && bRank != null) {
    return aRank - bRank;
  }
  if (aRank != null) {
    return -1;
  }
  if (bRank != null) {
    return 1;
  }

  const distanceDelta = (b.distance ?? 0) - (a.distance ?? 0);
  if (Math.abs(distanceDelta) > Number.EPSILON) {
    return distanceDelta;
  }

  const lapDelta = (b.lapsCompleted ?? 0) - (a.lapsCompleted ?? 0);
  if (lapDelta !== 0) {
    return lapDelta;
  }

  return (a.laneIndex ?? 0) - (b.laneIndex ?? 0);
}

function getPlayersByStanding(players = state.players) {
  return [...players].sort(comparePlayersByStanding);
}

function updateRunnerStackingOrder(orderedPlayers = getPlayersByStanding()) {
  const total = orderedPlayers.length;
  orderedPlayers.forEach((player, index) => {
    player.currentStanding = index + 1;
    const runner = player.elements?.runner;
    if (runner) {
      const priority = total - index;
      runner.style.zIndex = String(1000 + priority);
      runner.dataset.standing = String(player.currentStanding);
    }
  });
}

function updateRosterOrder(orderedPlayers = getPlayersByStanding()) {
  const rosterList = selectors.playerRosterList;
  if (!rosterList || orderedPlayers.length === 0) {
    return;
  }
  // Use a lightweight FLIP animation so roster cards glide into their new standing.
  const previousRects = new Map();
  orderedPlayers.forEach((player) => {
    const card = player.elements?.rosterCard;
    if (card) {
      previousRects.set(card, card.getBoundingClientRect());
    }
  });
  const fragment = document.createDocumentFragment();
  let appended = 0;
  orderedPlayers.forEach((player, index) => {
    const card = player.elements?.rosterCard;
    if (!card) {
      return;
    }
    card.dataset.standing = String(index + 1);
    fragment.appendChild(card);
    appended += 1;
  });
  if (appended === orderedPlayers.length) {
    rosterList.appendChild(fragment);
  } else {
    return;
  }

  const prefersReducedMotion = Boolean(
    globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)")?.matches,
  );

  orderedPlayers.forEach((player) => {
    const card = player.elements?.rosterCard;
    if (!card) {
      return;
    }
    const previousRect = previousRects.get(card);
    if (!previousRect) {
      return;
    }
    const nextRect = card.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      return;
    }
    if (!prefersReducedMotion && typeof card.animate === "function") {
      card.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: 400,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
      return;
    }
    card.style.transition = "none";
    card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    card.offsetWidth; // force reflow so transition below kicks in
    card.style.transition = "transform 400ms cubic-bezier(0.22, 1, 0.36, 1)";
    card.style.transform = "";
    card.addEventListener(
      "transitionend",
      () => {
        card.style.transition = "";
      },
      { once: true },
    );
  });
}

function generatePlayerColor(index = 0) {
  const normalizedIndex = Number.isFinite(index) ? index : 0;
  const hue = Math.round(((normalizedIndex * GOLDEN_RATIO_CONJUGATE) % 1) * 360);
  return `hsl(${hue} 70% 55%)`;
}

function sanitizeLapCount(rawValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return clamp(Math.floor(rawValue), DEFAULT_LAPS_REQUIRED, 50);
  }
  const parsed = Number.parseInt(String(rawValue ?? "").trim(), 10);
  if (Number.isFinite(parsed)) {
    return clamp(parsed, DEFAULT_LAPS_REQUIRED, 50);
  }
  return DEFAULT_LAPS_REQUIRED;
}

function applyLapsRequired(nextValue) {
  const sanitized = sanitizeLapCount(nextValue);
  state.lapsRequired = sanitized;
  state.totalRaceDistance = getRaceDistance(sanitized);
  if (selectors.lapCountInput) {
    selectors.lapCountInput.value = String(sanitized);
  }
  updateCentralLapIndicator();
  return sanitized;
}

function applyLapMetricsToPlayer(player, distanceOverride = null) {
  if (!player) {
    return null;
  }
  const distanceValue =
    typeof distanceOverride === "number" && Number.isFinite(distanceOverride)
      ? distanceOverride
      : player.distance ?? 0;
  const metrics = calculateLapMetrics(distanceValue, state.lapsRequired);
  player.lapsCompleted = metrics.lapsCompleted;
  player.lapProgress = metrics.lapProgress;
  player.totalProgress = metrics.normalized;
  player.angleRadians = metrics.angleRadians;
  player.angleDegrees = metrics.angleDegrees;
  return metrics;
}

function initializeTrackPath() {
  const pathElement = selectors.trackPath ?? document.querySelector("#track-middle-path");
  selectors.trackPath = pathElement;
  if (!pathElement || typeof pathElement.getTotalLength !== "function") {
    state.trackPathLength = 0;
    return;
  }
  const totalLength = pathElement.getTotalLength();
  state.trackPathLength = totalLength;
  const target =
    state.trackGeometry?.startReference ?? {
      x: state.trackGeometry.viewBoxWidth - 160,
      y: state.trackGeometry.viewBoxHeight * 0.25,
    };
  let bestOffset = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const steps = 600;
  for (let i = 0; i <= steps; i++) {
    const offset = (totalLength * i) / steps;
    const point = pathElement.getPointAtLength(offset);
    const dx = point.x - target.x;
    const dy = point.y - target.y;
    const score = dx * dx + dy * dy;
    if (score < bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  state.trackStartOffset = bestOffset;
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
    lapsRequired: state.lapsRequired,
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
      lapsRequired: state.lapsRequired,
      totalRaceDistance: state.totalRaceDistance,
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
        lapsRequired: cached.lapsRequired ?? state.lapsRequired,
        totalRaceDistance: cached.totalRaceDistance,
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
      const { sessionId, players, origin, lapsRequired } = payload ?? {};
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
      enterSpectatorMode(sessionId, {
        players: playersSnapshot,
        lapsRequired: lapsRequired ?? state.lapsRequired,
      });
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

function updateCasterText(message, { force = false, lock = 0, append = false } = {}) {
  if (state.casterLock && !force) {
    return; // Don't override a locked message
  }
  if (!selectors.casterText) {
    return;
  }

  if (append) {
    selectors.casterText.innerHTML += message;
  } else {
    selectors.casterText.innerHTML = message;
  }

  if (lock > 0) {
    state.casterLock = true;
    if (state.casterLockTimer) {
      clearTimeout(state.casterLockTimer);
    }
    state.casterLockTimer = setTimeout(() => {
      state.casterLock = false;
      state.casterLockTimer = null;
    }, lock);
  }
}

function clearCasterText() {
  if (selectors.casterText) {
    selectors.casterText.innerHTML = "";
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
      existing.distance = typeof remote.distance === "number" ? remote.distance : existing.distance ?? 0;
      existing.rank = remote.rank ?? existing.rank ?? null;
      applyLapMetricsToPlayer(existing, existing.distance);
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
  state.players.forEach(updateHorsePosition);
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
    if (player.elements?.cheerBadge) {
      player.elements.cheerBadge.textContent = `🎉 ${player.cheerCount ?? 0}`;
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
    wrapper.style.setProperty("--player-accent", player.accentColor);

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

  if (sessionData.lapsRequired) {
    applyLapsRequired(sessionData.lapsRequired);
  }
  if (Number.isFinite(sessionData.totalRaceDistance)) {
    state.totalRaceDistance = sessionData.totalRaceDistance;
  }

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
  hideElement(selectors.playerRoster);
  showElement(selectors.spectatorPanel);
  setSpectatorStatus("Connected as spectator. Choose a horse to cheer!");
  renderSpectatorButtons();
  renderRaceScene();
  state.players.forEach((player) => {
    applyLapMetricsToPlayer(player, player.distance ?? 0);
    updateHorsePosition(player);
  });
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
  showElement(selectors.playerRoster);
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
        lapsRequired: state.lapsRequired,
        totalRaceDistance: state.totalRaceDistance,
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
    state.totalRaceDistance = getRaceDistance(state.lapsRequired);
    state.cheerButtonRefs.clear();
    state.casterAnnouncements.clear();
    state.previousRanking = [];
    state.casterLock = false;
    if (state.casterLockTimer) {
      clearTimeout(state.casterLockTimer);
      state.casterLockTimer = null;
    }

    renderRaceScene();
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
  selectors.lapCountInput?.setAttribute("disabled", "true");
  selectors.startButton?.setAttribute("disabled", "true");
  selectors.hostForm?.setAttribute("aria-disabled", "true");
}

function enableHostControls() {
  selectors.playerInput?.removeAttribute("disabled");
  selectors.lapCountInput?.removeAttribute("disabled");
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
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (selectors.countdownValue) {
    const label =
      safeValue === 0
        ? "Lights out! Go!"
        : `${safeValue} ${safeValue === 1 ? "light" : "lights"} remaining`;
    selectors.countdownValue.textContent = label;
  }

  if (selectors.countdownLights && selectors.countdownLights.length > 0) {
    const activeCount = Math.min(selectors.countdownLights.length, safeValue);
    selectors.countdownLights.forEach((light, index) => {
      const shouldBeActive = safeValue > 0 && index < activeCount;
      light.classList.toggle("countdown-light--active", shouldBeActive);
    });
  }
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
  const accentColor = generatePlayerColor(laneIndex ?? 0);
  const initialDistance =
    typeof basePlayer.distance === "number" && Number.isFinite(basePlayer.distance)
      ? basePlayer.distance
      : 0;
  return {
    ...basePlayer,
    laneIndex,
    distance: initialDistance,
    cheerCount: 0,
    rank: null,
    finished: false,
    finishTick: null,
    accentColor,
    lapsCompleted: 0,
    lapProgress: 0,
    totalProgress: 0,
    angleRadians: degreesToRadians(TRACK_GEOMETRY.startAngleDeg),
    angleDegrees: TRACK_GEOMETRY.startAngleDeg,
    elements: {},
  };
}

function updateHorsePosition(player) {
  if (!player) {
    return;
  }
  const runner = player.elements?.runner;
  const geometry = state.trackGeometry ?? TRACK_GEOMETRY;
  const path = selectors.trackPath;
  const totalLength = state.trackPathLength;
  if (runner && path && typeof path.getPointAtLength === "function" && totalLength > 0) {
    const lapProgress = Number.isFinite(player.lapProgress)
      ? clamp(player.lapProgress, 0, 1)
      : clamp(player.totalProgress ?? 0, 0, 1);
    const startOffset = state.trackStartOffset ?? 0;
    const direction = -1; // use negative to move counter-clockwise along the SVG path
    const offsetDistance = (direction * lapProgress * totalLength) % totalLength;
    const lengthOnPath = (startOffset + offsetDistance + totalLength) % totalLength;
    const point = path.getPointAtLength(lengthOnPath);
    const delta = Math.max(1, totalLength * 0.002);
    const aheadOffset = (lengthOnPath + direction * delta + totalLength) % totalLength;
    const aheadPoint = path.getPointAtLength(aheadOffset);
    const angleRadians = Math.atan2(aheadPoint.y - point.y, aheadPoint.x - point.x);
    player.angleRadians = angleRadians;
    player.angleDegrees = radiansToDegrees(angleRadians);
    const xPercent = (point.x / geometry.viewBoxWidth) * 100;
    const yPercent = (point.y / geometry.viewBoxHeight) * 100;
    runner.style.left = `${xPercent}%`;
    runner.style.top = `${yPercent}%`;
    runner.style.transform = `translate(-50%, -50%) rotate(${player.angleDegrees}deg)`;
  } else if (runner) {
    const fallbackAngle = player.angleRadians ?? degreesToRadians(TRACK_GEOMETRY.startAngleDeg);
    const point = angleToPoint(fallbackAngle, geometry);
    const xPercent = (point.x / geometry.viewBoxWidth) * 100;
    const yPercent = (point.y / geometry.viewBoxHeight) * 100;
    runner.style.left = `${xPercent}%`;
    runner.style.top = `${yPercent}%`;
    runner.style.transform = `translate(-50%, -50%) rotate(${player.angleDegrees || 0}deg)`;
  }

  if (player.elements?.cheerBadge) {
    player.elements.cheerBadge.textContent = `🎉 ${player.cheerCount ?? 0}`;
  }
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
  const totalRaceDistance = state.totalRaceDistance ?? getRaceDistance(state.lapsRequired);

  const tickSummary = [];

  let announcementMade = false;

  state.players.forEach((player) => {
    if (player.finished) {
      tickSummary.push({
        playerId: player.id,
        name: player.name,
        distance: Number(player.distance.toFixed(4)),
        finished: true,
        lap: player.lapsCompleted,
        lapProgress: Number(player.lapProgress.toFixed(4)),
      });
      return;
    }

    const baseStep = 0.01 + state.rng() * 0.03;
    const cheerBoost = player.cheerCount * CHEER_BOOST_FACTOR;
    const remainingDistance = Math.max(0, totalRaceDistance - player.distance);
    const totalStep = Math.min(baseStep + cheerBoost, remainingDistance);

    player.distance = Math.min(totalRaceDistance, player.distance + totalStep);

    const lapMetrics = applyLapMetricsToPlayer(player);

    updateHorsePosition(player);
    if (player.elements.cheerBadge) {
      player.elements.cheerBadge.textContent = `🎉 ${player.cheerCount ?? 0}`;
    }

    if (player.distance >= totalRaceDistance && !player.finished) {
      player.finished = true;
      player.finishTick = state.tick;
      const rank = state.finishOrder.length + 1;
      player.rank = rank;
      state.finishOrder.push(player);
      appendResultEntry(player);
      if (player.elements.runner) {
        player.elements.runner.classList.add("runner-finished");
      }
      if (player.elements.runnerBadge) {
        player.elements.runnerBadge.textContent = `${rank}`;
      }
      if (player.elements.statusLabel) {
        player.elements.statusLabel.textContent = `${rank}위`;
      }
      if (player.elements.rosterCard) {
        player.elements.rosterCard.classList.add("player-card--finished");
      }

      if (rank === 1) {
        const finishMessage = `우승! <span class="caster-name">${
          player.name
        }</span> 선수가 우승합니다!`;
        updateCasterText(finishMessage, { force: true });
      } else if (rank === 2) {
        const finishMessage = ` 그리고 ${rank}등, <span class="caster-name">${player.name}</span> 선수!`;
        updateCasterText(finishMessage, { force: true, append: true });
      } else if (rank === 3) {
        const finishMessage = ` ${rank}등, <span class="caster-name">${player.name}</span> 선수!`;
        updateCasterText(finishMessage, { force: true, append: true });
      }
      announcementMade = true;
    }
    tickSummary.push({
      playerId: player.id,
      name: player.name,
      baseStep: Number(baseStep.toFixed(4)),
      cheerBoost: Number(cheerBoost.toFixed(4)),
      totalStep: Number(totalStep.toFixed(4)),
      distance: Number(player.distance.toFixed(4)),
      lap: player.lapsCompleted + 1,
      lapProgress: Number(player.lapProgress.toFixed(4)),
      angleDeg: Number(player.angleDegrees.toFixed(2)),
    });
  });

  const orderedPlayers = getPlayersByStanding();
  const newRanking = orderedPlayers.map((p) => p.id);

  if (state.previousRanking.length === 0) {
    state.previousRanking = [...newRanking];
  }

  updateRunnerStackingOrder(orderedPlayers);
  updateRosterOrder(orderedPlayers);

  // --- Caster Logic (only if no one has finished yet) ---
  if (state.finishOrder.length === 0) {
    const newLeaderId = newRanking[0];
    const oldLeaderId = state.previousRanking[0];

    // 1. Leader overtakes
    if (newLeaderId !== oldLeaderId) {
      const newLeader = state.players.find((p) => p.id === newLeaderId);
      const oldLeader = state.players.find((p) => p.id === oldLeaderId);
      if (newLeader && oldLeader) {
        updateCasterText(
          `<span class="caster-name">${
            newLeader.name
          }</span> 선수가 <span class="caster-name">${
            oldLeader.name
          }</span> 선수를 추월하며 선두로 나섭니다!`,
        );
        announcementMade = true;
      }
    }

    // 2. Last place overtakes
    if (!announcementMade && state.players.length > 2) {
      const oldLastPlaceId = state.previousRanking[state.previousRanking.length - 1];
      const oldLastPlacePlayer = state.players.find((p) => p.id === oldLastPlaceId);
      const newRankOfOldLast = newRanking.findIndex((id) => id === oldLastPlaceId);

      if (oldLastPlacePlayer && newRankOfOldLast < state.players.length - 1) {
        const overtakenPlayerId = state.previousRanking[newRankOfOldLast];
        const overtakenPlayer = state.players.find((p) => p.id === overtakenPlayerId);
        if (overtakenPlayer) {
          updateCasterText(
            `꼴찌의 반란! <span class="caster-name">${
              oldLastPlacePlayer.name
            }</span> 선수가 <span class="caster-name">${overtakenPlayer.name}</span> 선수를 추월합니다!`,
          );
          announcementMade = true;
        }
      }
    }

    // 3. Checkpoint announcements
    if (!announcementMade) {
      const leader = state.players.find((p) => p.id === newLeaderId);
      if (leader) {
        const checkpoints = [
          { distance: totalRaceDistance * 0.25, point: "1/4" },
          { distance: totalRaceDistance * 0.5, point: "절반" },
          { distance: totalRaceDistance * 0.75, point: "3/4" },
        ];

        for (const checkpoint of checkpoints) {
          if (
            leader.distance >= checkpoint.distance &&
            !state.casterAnnouncements.has(checkpoint.point)
          ) {
            state.casterAnnouncements.add(checkpoint.point);
            let message = `${checkpoint.point} 지점을 <span class="caster-name">${
              leader.name
            }</span> 선수가 통과합니다!`;
            if (newRanking.length > 1) {
              const secondPlace = state.players.find((p) => p.id === newRanking[1]);
              if (secondPlace) {
                message += ` 그 다음은 <span class="caster-name">${
                  secondPlace.name
                }</span> 선수!`;
              }
            }
            updateCasterText(message, { lock: 1200 });
            announcementMade = true;
            break; // Announce one checkpoint per tick
          }
        }
      }
    }
    state.previousRanking = newRanking;
  }
  // --- End Caster Logic ---

  updateCentralLapIndicator();
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

function renderPlayerRoster() {
  if (!selectors.playerRosterList) {
    return;
  }
  selectors.playerRosterList.replaceChildren();

  if (state.players.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "roster-empty";
    emptyState.textContent = "Enter player names to populate the roster.";
    selectors.playerRosterList.appendChild(emptyState);
    return;
  }

  const orderedPlayers = getPlayersByStanding();

  orderedPlayers.forEach((player, index) => {
    const card = document.createElement("article");
    card.className = "player-card";
    card.dataset.playerId = player.id;
    card.dataset.standing = String(index + 1);
    card.style.setProperty("--player-accent", player.accentColor);

    const number = document.createElement("span");
    number.className = "player-number";
    number.textContent = getPlayerInitial(player.name);

    const meta = document.createElement("div");
    meta.className = "player-meta";

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;

    const cheerBadge = document.createElement("span");
    cheerBadge.className = "player-cheer-count";
    cheerBadge.textContent = `🎉 ${player.cheerCount ?? 0}`;

    meta.append(name, cheerBadge);

    const status = document.createElement("span");
    status.className = "player-status";
    status.textContent = "";

    card.append(number, meta, status);
    selectors.playerRosterList.appendChild(card);

    player.elements = {
      ...(player.elements ?? {}),
      rosterCard: card,
      cheerBadge,
      statusLabel: status,
      playerNumber: number,
    };
  });
}

function renderRunnerLayer() {
  if (!selectors.runnerLayer) {
    return;
  }
  selectors.runnerLayer.replaceChildren();

  const orderedPlayers = getPlayersByStanding();
  const renderOrder = orderedPlayers.slice().reverse();

  renderOrder.forEach((player) => {
    const runner = document.createElement("div");
    runner.className = "runner-marker";
    runner.dataset.playerId = player.id;
    runner.style.setProperty("--player-accent", player.accentColor);

    const emoji = document.createElement("span");
    emoji.className = "runner-emoji";
    emoji.textContent = LANE_CONFIG.horseEmoji;

    const badge = document.createElement("span");
    badge.className = "runner-badge";
    badge.textContent = getPlayerInitial(player.name);

    runner.append(emoji, badge);
    selectors.runnerLayer.appendChild(runner);

    player.elements = {
      ...(player.elements ?? {}),
      runner,
      runnerEmoji: emoji,
      runnerBadge: badge,
    };
  });

  updateRunnerStackingOrder(orderedPlayers);
}

function updateCentralLapIndicator() {
  const indicator = selectors.lapIndicator;
  if (!indicator) {
    return;
  }
  if (state.lapsRequired <= 1 || state.players.length === 0) {
    indicator.textContent = "";
    indicator.classList.add("hidden");
    return;
  }
  const [leader] = getPlayersByStanding();
  if (!leader) {
    indicator.textContent = "";
    indicator.classList.add("hidden");
    return;
  }
  const currentLap = Math.min(state.lapsRequired, (leader.lapsCompleted ?? 0) + 1);
  indicator.textContent = `Lap ${currentLap} / ${state.lapsRequired}`;
  indicator.classList.remove("hidden");
}

function renderRaceScene() {
  renderPlayerRoster();
  renderRunnerLayer();
  updateCentralLapIndicator();
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

  const lapInputValue = selectors.lapCountInput?.value ?? state.lapsRequired;
  applyLapsRequired(lapInputValue);

  leaveSpectatorMode();
  cancelCountdown();
  stopRaceLoop();
  clearPlayersSubscription();
  stopSessionBroadcastLoop();
  clearCasterText();
  state.casterAnnouncements.clear();
  state.previousRanking = [];
  state.casterLock = false;
  if (state.casterLockTimer) {
    clearTimeout(state.casterLockTimer);
    state.casterLockTimer = null;
  }

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

  renderRaceScene();
  state.players.forEach((player) => {
    applyLapMetricsToPlayer(player, 0);
    updateHorsePosition(player);
  });

  logSession("host:players-registered", {
    players: players.map((p) => p.name),
    seed: state.seed,
    lapsRequired: state.lapsRequired,
  });

  await createSessionInFirebase();
  state.raceStatus = "countdown";
  updateSessionPatch({ status: "countdown" });

  disableHostControls();
  const playerCount = state.players.length;
  const countdownLockMs = Math.max(0, COUNTDOWN_SECONDS * 1_000 - 250);

  selectors.countdownModal?.classList.remove("hidden");
  updateCountdownDisplay(COUNTDOWN_SECONDS);
  updateCasterText(`${playerCount}명의 선수들이 긴장속에 출발을 기다리고 있습니다!`, {
    lock: countdownLockMs,
    force: true,
  });

  state.countdownCancel = scheduleCountdown({
    seconds: COUNTDOWN_SECONDS,
    onTick: updateCountdownDisplay,
    onComplete: () => {
      state.countdownCancel = null;
      selectors.countdownModal?.classList.add("hidden");
      logSession("countdown:complete");
      updateSessionPatch({ status: "running" });
      logSession("race:start", { tickIntervalMs: TICK_MS, playerCount: state.players.length });
      updateCasterText(`모든 선수들이 지금 힘차게 출발했습니다!`, {
        lock: 1_200,
        force: true,
      });
      startRaceLoop();
    },
  });
}

function registerEventListeners() {
  selectors.hostForm?.addEventListener("submit", handleStart);
  selectors.lapCountInput?.addEventListener("change", (event) => {
    applyLapsRequired(event?.target?.value ?? state.lapsRequired);
  });
  selectors.resultsClose?.addEventListener("click", async () => {
    if (state.mode === ClientMode.HOST) {
      updateSessionPatch({ status: "finished" });
    }
    await cleanupSession({ reason: "results-close" });
    clearCasterText();
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
  applyLapsRequired(state.lapsRequired);
  initializeTrackPath();
  renderRaceScene();

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
  calculateLapMetrics,
  progressToAngle,
  angleToPoint,
  generatePlayerColor,
  sanitizeLapCount,
  getRaceDistance,
};

export {
  BASE_LAP_DISTANCE,
  CHEER_BOOST_FACTOR,
  ClientMode,
  LANE_CONFIG,
  SESSION_PATH,
  TICK_MS,
  TRACK_GEOMETRY,
  angleToPoint,
  applyLapsRequired,
  calculateLapMetrics,
  cheerTransaction,
  createRng,
  loadFirebaseConfig,
  logFirebase,
  logSession,
  logTick,
  parsePlayerNames,
  progressToAngle,
  renderRaceScene,
  scheduleCountdown,
  state,
  __TEST_ONLY__,
};
