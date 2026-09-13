export interface LatestTaskHandlers<T> {
  onSuccess(value: T): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
}

export class LatestTaskScheduler<T> {
  private revision = 0;
  private timer: NodeJS.Timeout | undefined;
  private activeController: AbortController | undefined;
  private readonly activeTasks = new Set<Promise<void>>();
  private disposed = false;

  public constructor(
    private readonly worker: (signal: AbortSignal, revision: number) => Promise<T>,
    private readonly handlers: LatestTaskHandlers<T>,
  ) {}

  public schedule(delayMs: number): number {
    const revision = ++this.revision;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.launch(revision);
    }, delayMs);
    return revision;
  }

  public runNow(): number {
    const revision = ++this.revision;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.launch(revision);
    return revision;
  }

  public isCurrent(revision: number): boolean {
    return !this.disposed && revision === this.revision;
  }

  public async whenIdle(): Promise<void> {
    while (this.activeTasks.size > 0) {
      await Promise.allSettled([...this.activeTasks]);
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.revision += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.activeController?.abort();
    this.activeController = undefined;
  }

  private launch(revision: number): void {
    if (this.disposed || revision !== this.revision) {
      return;
    }
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;

    const task = (async () => {
      try {
        const value = await this.worker(controller.signal, revision);
        if (this.isCurrent(revision) && !controller.signal.aborted) {
          await this.handlers.onSuccess(value);
        }
      } catch (error) {
        if (this.isCurrent(revision) && !controller.signal.aborted && !isAbortError(error)) {
          await this.handlers.onError(error);
        }
      } finally {
        if (this.activeController === controller) {
          this.activeController = undefined;
        }
      }
    })();
    this.activeTasks.add(task);
    void task.finally(() => this.activeTasks.delete(task));
  }
}

export function abortError(): Error {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
