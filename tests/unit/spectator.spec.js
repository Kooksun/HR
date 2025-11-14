import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

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
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  onValue: vi.fn((ref, callback) => {
    if (typeof callback === "function") {
      callback({ val: () => ({}) });
    }
    return vi.fn();
  }),
}));

const createElementStub = () => ({
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
  style: {},
  textContent: "",
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

describe("spectator cheer mode (pre-implementation)", () => {
  beforeEach(() => {
    vi.resetModules();
    getMock.mockReset();
    getMock.mockResolvedValue({
      exists: () => false,
      val: () => ({}),
    });

    globalThis.window = {
      __FIREBASE_CONFIG__: {
        projectId: "test-project",
        databaseURL: "https://example.com",
      },
      alert: vi.fn(),
    };

    globalThis.document = {
      querySelector: vi.fn(() => createElementStub()),
      createElement: vi.fn(() => createElementStub()),
    };
  });

  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
  });

  it("switches to spectator mode when an active session already exists", async () => {
    getMock.mockResolvedValueOnce({
      exists: () => true,
      val: () => ({
        "session-abc": { status: "running", players: { kim: { name: "Kim" } } },
      }),
    });

    const mod = await import("../../app.js");
    const { ClientMode, state } = mod;

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.mode).toBe(ClientMode.SPECTATOR);
  });

  it("applies cheer amplification when processing race ticks", async () => {
    const mod = await import("../../app.js");
    const { state, __TEST_ONLY__ } = mod;

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(__TEST_ONLY__).toBeDefined();
    expect(typeof __TEST_ONLY__?.performRaceTick).toBe("function");

    state.mode = mod.ClientMode.HOST;
    state.sessionId = null;
    state.players = [
      {
        id: "kim",
        name: "Kim",
        cheerCount: 3,
        distance: 0,
        laneIndex: 0,
        finished: false,
        elements: { horse: { style: {} } },
      },
    ];
    state.finishOrder = [];
    state.rng = () => 0.5;
    state.raceStatus = "running";

    __TEST_ONLY__.performRaceTick();

    expect(state.players[0].distance).toBeGreaterThan(0);
  });
});
