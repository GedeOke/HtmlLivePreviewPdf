import { describe, expect, it, vi } from "vitest";
import { LatestTaskScheduler, abortError } from "../../src/latestTaskScheduler";

describe("LatestTaskScheduler", () => {
  it("debounces requests and runs only the newest revision", async () => {
    vi.useFakeTimers();
    const work = vi.fn((_signal: AbortSignal, revision: number) => Promise.resolve(revision));
    const success = vi.fn();
    const scheduler = new LatestTaskScheduler(work, { onSuccess: success, onError: vi.fn() });

    scheduler.schedule(300);
    scheduler.schedule(300);
    const newest = scheduler.schedule(300);
    await vi.advanceTimersByTimeAsync(300);
    await scheduler.whenIdle();

    expect(work).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(newest);
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("suppresses stale results and abort errors", async () => {
    const completions = new Map<number, (value: number) => void>();
    const success = vi.fn();
    const failure = vi.fn();
    const scheduler = new LatestTaskScheduler<number>(
      (signal, revision) =>
        new Promise<number>((resolve, reject) => {
          completions.set(revision, resolve);
          signal.addEventListener("abort", () => reject(abortError()), { once: true });
        }),
      { onSuccess: success, onError: failure },
    );

    const first = scheduler.runNow();
    const second = scheduler.runNow();
    completions.get(first)?.(first);
    completions.get(second)?.(second);
    await scheduler.whenIdle();

    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(second);
    expect(failure).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});
