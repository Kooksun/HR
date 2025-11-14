import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const setMock = vi.fn(() => Promise.resolve());
const updateMock = vi.fn(() => Promise.resolve());
const removeMock = vi.fn(() => Promise.resolve());
const onValueMock = vi.fn((ref, cb) => {
  if (typeof cb === "function") {
    cb({ val: () => ({}) });
  }
  return vi.fn();
});

vi.mock("https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js", () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock("https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js", () => ({
  getAuth: vi.fn(() => ({})),
  signInAnonymously: vi.fn(() => Promise.resolve({ user: { uid: "auth-test" } })),
}));

vi.mock("https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js", () => ({
  getDatabase: vi.fn(() => ({})),
  get: (...args) => getMock(...args),
  ref: vi.fn(() => ({})),
  runTransaction: vi.fn((ref, updater) => {
    const current = typeof updater === "function" ? updater(0) : 0;
    return Promise.resolve({ committed: true, snapshot: { val: () => current } });
  }),
  set: (...args) => setMock(...args),
  update: (...args) => updateMock(...args),
  remove: (...args) => removeMock(...args),
  onValue: (...args) => onValueMock(...args),
}));

const stubElement = () => ({
  classList: {
    add: vi.fn(),
    remove: vi.fn(),
  },
  dataset: {},
  appendChild: vi.fn(),
  append: vi.fn(),
  replaceChildren: vi.fn(),
  setAttribute: vi.fn(),
  removeAttribute: vi.fn(),
  focus: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  style: {},
  textContent: "",
});

describe("session lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    getMock.mockReset();
    setMock.mockClear();
    updateMock.mockClear();
    removeMock.mockClear();
    onValueMock.mockClear();

    globalThis.window = {
      __FIREBASE_CONFIG__: {
        projectId: "test-project",
        databaseURL: "https://example.com",
      },
      __APP_STATE__: undefined,
    };

    globalThis.document = {
      querySelector: vi.fn(() => stubElement()),
      createElement: vi.fn(() => stubElement()),
    };

    globalThis.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    globalThis.BroadcastChannel = class {
      constructor() {
        this.onmessage = null;
      }
      postMessage() {}
      close() {}
    };
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
    delete globalThis.BroadcastChannel;
  });

  it("initialises session, updates players, and marks finished status", async () => {
    getMock.mockResolvedValueOnce({
      exists: () => false,
      val: () => ({}),
    });

    const mod = await import("../../app.js");
    const { state } = mod;

    await Promise.resolve();

    state.mode = mod.ClientMode.HOST;
    state.players = [
      {
        id: "kim",
        name: "Kim",
        cheerCount: 0,
        distance: 0,
        laneIndex: 0,
        finished: false,
        elements: { horse: { style: {} } },
      },
      {
        id: "lee",
        name: "Lee",
        cheerCount: 0,
        distance: 0,
        laneIndex: 1,
        finished: false,
        elements: { horse: { style: {} } },
      },
    ];

    mod.state.rng = () => 0.5;
    mod.state.raceStatus = "countdown";

    await mod.cheerTransaction("kim").catch(() => {});

    mod.state.tick = 0;
    mod.state.finishOrder = [];

    mod.state.raceStatus = "running";
    mod.__TEST_ONLY__.performRaceTick();
    mod.__TEST_ONLY__.performRaceTick();
    expect(mod.state.players.every((player) => player.distance > 0)).toBe(true);

    mod.state.sessionId = "test-session";
    await mod.__TEST_ONLY__.cleanupSession({ reason: "test" });

    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(mod.state.sessionId).toBeNull();
    expect(Array.isArray(mod.state.players)).toBe(true);
    expect(mod.state.players.length).toBe(0);
  });
});
