import { computed, DestroyRef, effect, inject, signal } from '@angular/core';

import { ApiFailure } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';

export interface SharedEntry {
  readonly id: string;
  readonly version: number;
}

export interface SharedEntriesApi<T extends SharedEntry, Input, Changes> {
  list(activity: boolean): Promise<readonly T[]>;
  create(id: string, input: Input): Promise<T>;
  update(item: T, changes: Changes): Promise<T>;
  remove(item: T): Promise<void>;
}

/** Shared lifecycle for the two household collections; private state never survives a session. */
export class SharedEntriesStore<T extends SharedEntry, Input, Changes> {
  private readonly auth = inject(AuthService);
  private readonly state = signal<readonly T[]>([]);
  private readonly demoState = signal(false);
  private mode: 'demo' | 'family' | null = null;
  private epoch = 0;
  private disposed = false;
  private authGeneration = this.auth.generation();
  private loadTask: Promise<void> | null = null;
  private retryCreate: { id: string; fingerprint: string } | null = null;

  readonly items = computed(() =>
    this.demoState() ||
    (this.auth.session() !== null && this.auth.generation() === this.authGeneration)
      ? this.state()
      : [],
  );
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly isDemo = this.demoState.asReadonly();

  constructor(
    private readonly api: SharedEntriesApi<T, Input, Changes>,
    private readonly fixtures: readonly T[],
    private readonly validInput: (input: Input) => boolean,
  ) {
    effect(() => {
      const generation = this.auth.generation();
      if (generation !== this.authGeneration) {
        this.authGeneration = generation;
        if (this.mode === 'family') this.clear();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      this.clear();
    });
  }

  load(demo = false, activity = true, preserveError = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!demo && this.authGeneration !== this.auth.generation()) {
      this.authGeneration = this.auth.generation();
      this.clear();
    }
    const mode = demo ? 'demo' : 'family';
    if (this.mode !== mode) {
      this.clear();
      this.mode = mode;
      this.demoState.set(demo);
    }
    if (demo) {
      this.state.set(this.fixtures);
      return Promise.resolve();
    }
    if (!this.auth.session() || this.saving()) return Promise.resolve();
    if (this.loadTask) return this.loadTask;
    const epoch = this.epoch;
    const generation = this.auth.generation();
    this.loading.set(true);
    if (!preserveError) this.error.set('');
    const task = this.fetchItems(epoch, generation, activity);
    this.loadTask = task;
    void task.finally(() => {
      if (this.loadTask === task) {
        this.loadTask = null;
        this.loading.set(false);
      }
    });
    return task;
  }

  async create(input: Input): Promise<T | null> {
    if (!this.canMutate() || !this.validInput(input)) return null;
    const fingerprint = JSON.stringify(input);
    if (this.retryCreate?.fingerprint !== fingerprint) {
      this.retryCreate = { id: crypto.randomUUID(), fingerprint };
    }
    const id = this.retryCreate.id;
    return this.mutate(
      () => this.api.create(id, input),
      (item) => {
        this.retryCreate = null;
        this.state.update((items) => [...items.filter((entry) => entry.id !== item.id), item]);
      },
    );
  }

  async update(item: T, changes: Changes): Promise<boolean> {
    return (
      (await this.mutate(
        () => this.api.update(item, changes),
        (updated) =>
          this.state.update((items) =>
            items.map((entry) => (entry.id === updated.id ? updated : entry)),
          ),
      )) !== null
    );
  }

  async remove(item: T): Promise<boolean> {
    return (
      (await this.mutate(
        async () => {
          await this.api.remove(item);
          return item;
        },
        () => this.state.update((items) => items.filter((entry) => entry.id !== item.id)),
      )) !== null
    );
  }

  private async fetchItems(epoch: number, generation: number, activity: boolean): Promise<void> {
    try {
      const items = await this.api.list(activity);
      if (this.current(epoch, generation)) this.state.set(items);
    } catch (error: unknown) {
      if (this.current(epoch, generation)) {
        this.error.set(this.errorMessage(error, 'Could not load the list. Please retry.'));
      }
    }
  }

  private async mutate<R>(
    request: () => Promise<R>,
    apply: (result: R) => void,
  ): Promise<R | null> {
    if (!this.canMutate()) return null;
    const epoch = ++this.epoch;
    const generation = this.auth.generation();
    this.loadTask = null;
    this.loading.set(false);
    this.saving.set(true);
    this.error.set('');
    let result: R | null = null;
    let conflict = false;
    try {
      const response = await request();
      if (this.current(epoch, generation)) {
        apply(response);
        result = response;
      }
    } catch (error: unknown) {
      if (this.current(epoch, generation)) {
        conflict = error instanceof ApiFailure && error.status === 409;
        this.error.set(
          conflict
            ? 'This entry changed on another device. The list has been refreshed; review and try again.'
            : this.errorMessage(
                error,
                'Could not save your change. Your input has been kept. Please retry.',
              ),
        );
      }
    } finally {
      if (this.current(epoch, generation)) this.saving.set(false);
    }
    if (this.current(epoch, generation) && (result !== null || conflict)) {
      await this.load(false, false, conflict);
    }
    return this.current(epoch, generation) ? result : null;
  }

  private canMutate(): boolean {
    return (
      !this.disposed &&
      this.mode === 'family' &&
      !!this.auth.session() &&
      this.auth.generation() === this.authGeneration &&
      !this.saving()
    );
  }

  private current(epoch: number, generation: number): boolean {
    return (
      !this.disposed &&
      this.mode === 'family' &&
      this.epoch === epoch &&
      this.auth.generation() === generation &&
      this.auth.session() !== null
    );
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof ApiFailure && error.status === 401
      ? 'Your session has expired. Please sign in again.'
      : fallback;
  }

  private clear(): void {
    this.epoch++;
    this.state.set([]);
    this.loading.set(false);
    this.saving.set(false);
    this.error.set('');
    this.loadTask = null;
    this.retryCreate = null;
  }
}
