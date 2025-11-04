import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js", () => ({
  initializeApp: vi.fn(() => ({})),
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

    ({ createRng, scheduleCountdown } = await import("../../app.js"));
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
});
