import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js", () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock("https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js", () => ({
  getAuth: vi.fn(() => ({})),
  signInAnonymously: vi.fn(() => Promise.resolve({ user: { uid: "auth-test" } })),
}));

vi.mock("https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js", () => ({
  getDatabase: vi.fn(() => ({})),
  get: vi.fn(() => Promise.resolve({ exists: () => false })),
  ref: vi.fn(() => ({})),
  runTransaction: vi.fn(() => Promise.resolve({ committed: true })),
}));

describe("simulation bootstrap", () => {
  let createRng;
  let scheduleCountdown;
  let testHelpers;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();

    globalThis.window = {
      __FIREBASE_CONFIG__: { projectId: "test-project", databaseURL: "https://example.com" },
    };
    const stubElement = () => ({
      className: "",
      dataset: {},
      style: {},
      appendChild: vi.fn(),
      append: vi.fn(),
      replaceChildren: vi.fn(),
      setAttribute: vi.fn(),
      textContent: "",
    });

    globalThis.document = {
      querySelector: vi.fn(() => null),
      createElement: vi.fn(() => stubElement()),
    };

    ({ createRng, scheduleCountdown, __TEST_ONLY__: testHelpers } = await import("../../app.js"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces deterministic sequences for identical seeds", () => {
    expect(typeof createRng).toBe("function");

    const left = createRng(42);
    const right = createRng(42);

    const leftSamples = Array.from({ length: 5 }, () => left());
    const rightSamples = Array.from({ length: 5 }, () => right());

    expect(leftSamples).toEqual(rightSamples);
    expect(leftSamples.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("runs countdown ticks every second and reports completion", () => {
    expect(typeof scheduleCountdown).toBe("function");

    const onTick = vi.fn();
    const onComplete = vi.fn();
    const cancel = scheduleCountdown({ seconds: 5, onTick, onComplete });

    vi.advanceTimersByTime(5_000);

    expect(onTick.mock.calls.map(([value]) => value)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(typeof cancel).toBe("function");

    cancel();
  });

  it("calculates lap metrics for multi-lap races", () => {
    const laps = 3;
    const totalDistance = testHelpers.getRaceDistance(laps);
    const halfwayDistance = totalDistance / 2;

    const metrics = testHelpers.calculateLapMetrics(halfwayDistance, laps);

    expect(metrics.totalDistance).toBeCloseTo(totalDistance, 5);
    expect(metrics.normalized).toBeCloseTo(0.5, 5);
    expect(metrics.lapsCompleted).toBe(1);
    expect(metrics.lapProgress).toBeCloseTo(0.5, 5);
  });

  it("maps normalized progress to CCW angles starting at 1 o'clock", () => {
    const startAngle = testHelpers.progressToAngle(0, 1);
    const quarterTurn = testHelpers.progressToAngle(0.25, 1);
    const fullTurn = testHelpers.progressToAngle(1, 1);

    expect(quarterTurn).toBeGreaterThan(startAngle);
    expect(Math.abs(fullTurn - startAngle)).toBeLessThan(1e-9);
  });

  it("generates deterministic player colors and clamps lap input", () => {
    const colorZeroA = testHelpers.generatePlayerColor(0);
    const colorZeroB = testHelpers.generatePlayerColor(0);
    const colorOne = testHelpers.generatePlayerColor(1);

    expect(colorZeroA).toBe(colorZeroB);
    expect(colorZeroA).not.toBe(colorOne);
    expect(testHelpers.sanitizeLapCount("8")).toBe(8);
    expect(testHelpers.sanitizeLapCount("0")).toBe(1);
    expect(testHelpers.sanitizeLapCount(999)).toBe(50);
  });
});
