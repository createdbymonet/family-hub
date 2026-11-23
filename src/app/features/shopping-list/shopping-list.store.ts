import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';

import { LIMITS } from '../../../../shared/contracts';
import { ApiFailure } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { DEMO_SHOPPING_ITEMS } from '../../core/demo-data';
import { ShoppingItem } from './shopping-item.model';
import { ShoppingListApi } from './shopping-list.api';

@Injectable({ providedIn: 'root' })
export class ShoppingListStore {
  private readonly api = inject(ShoppingListApi);
  private readonly auth = inject(AuthService);
  private readonly itemState = signal<readonly ShoppingItem[]>([]);
  private readonly demoState = signal(false);
  private mode: 'demo' | 'family' | null = null;
  private epoch = 0;
  private disposed = false;
  private authGeneration = this.auth.generation();
  private loadTask: Promise<void> | null = null;
  private retryCreate: { readonly id: string; readonly name: string } | null = null;

  readonly items = computed(() => {
    const items = this.itemState();
    return this.demoState() ||
      (this.auth.session() !== null && this.auth.generation() === this.authGeneration)
      ? items
      : [];
  });
  readonly completedCount = computed(() => this.items().filter((item) => item.completed).length);
  readonly remainingCount = computed(() => this.items().length - this.completedCount());
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly isDemo = this.demoState.asReadonly();

  constructor() {
    effect(() => {
      const generation = this.auth.generation();
      if (this.authGeneration !== generation) {
        this.authGeneration = generation;
        if (this.mode === 'family') {
          this.clear();
        }
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      this.clear();
    });
  }

  load(demo = false, activity = true, preserveError = false): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
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
      this.itemState.set(DEMO_SHOPPING_ITEMS);
      return Promise.resolve();
    }
    if (this.disposed || !this.auth.session() || this.saving()) {
      return Promise.resolve();
    }
    if (this.loadTask) {
      return this.loadTask;
    }
    const epoch = this.epoch;
    const generation = this.auth.generation();
    this.loading.set(true);
    if (!preserveError) {
      this.error.set('');
    }
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

  private async fetchItems(epoch: number, generation: number, activity: boolean): Promise<void> {
    try {
      const items = await this.api.list(activity);
      if (this.current(epoch, generation)) {
        this.itemState.set(items);
      }
    } catch (error: unknown) {
      if (this.current(epoch, generation)) {
        this.error.set(
          this.errorMessage(error, 'Could not load your shopping list. Please retry.'),
        );
      }
    }
  }

  async add(name: string): Promise<ShoppingItem | null> {
    if (!this.canMutate()) {
      return null;
    }
    const trimmedName = name.trim();
    if (!this.validName(trimmedName)) {
      return null;
    }
    if (!this.retryCreate || this.retryCreate.name !== trimmedName) {
      this.retryCreate = { id: crypto.randomUUID(), name: trimmedName };
    }
    const candidate = this.retryCreate;
    return this.mutate(
      () => this.api.create(candidate.id, candidate.name),
      (item) => {
        this.retryCreate = null;
        this.itemState.update((items) => [...items.filter((entry) => entry.id !== item.id), item]);
      },
    );
  }

  async setCompleted(item: ShoppingItem, completed: boolean): Promise<boolean> {
    const saved = await this.mutate(
      () => this.api.update(item, { completed }),
      (updated) => this.replace(updated),
    );
    return saved !== null;
  }

  async update(item: ShoppingItem, name: string): Promise<boolean> {
    const trimmedName = name.trim();
    if (!this.validName(trimmedName)) {
      return false;
    }
    const saved = await this.mutate(
      () => this.api.update(item, { name: trimmedName }),
      (updated) => this.replace(updated),
    );
    return saved !== null;
  }

  async remove(item: ShoppingItem): Promise<boolean> {
    const removed = await this.mutate(
      async () => {
        await this.api.remove(item);
        return item;
      },
      () => this.itemState.update((items) => items.filter((entry) => entry.id !== item.id)),
    );
    return removed !== null;
  }

  private async mutate<T>(
    request: () => Promise<T>,
    apply: (result: T) => void,
  ): Promise<T | null> {
    if (!this.canMutate()) {
      return null;
    }
    const epoch = ++this.epoch;
    const generation = this.auth.generation();
    this.loadTask = null;
    this.loading.set(false);
    this.saving.set(true);
    this.error.set('');
    let result: T | null = null;
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
            ? 'This item changed on another device. The list has been refreshed; review and try again.'
            : this.errorMessage(
                error,
                'Could not save your change. Your input has been kept. Please retry.',
              ),
        );
      }
    } finally {
      if (this.current(epoch, generation)) {
        this.saving.set(false);
      }
    }
    if (this.current(epoch, generation) && (result !== null || conflict)) {
      await this.load(false, false, conflict);
    }
    return this.current(epoch, generation) ? result : null;
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

  private canMutate(): boolean {
    return (
      !this.disposed && this.mode === 'family' && this.auth.session() !== null && !this.saving()
    );
  }

  private replace(item: ShoppingItem): void {
    this.itemState.update((items) => items.map((entry) => (entry.id === item.id ? item : entry)));
  }

  private validName(name: string): boolean {
    return name.length > 0 && name.length <= LIMITS.shoppingName;
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof ApiFailure && error.status === 401
      ? 'Your session has expired. Please sign in again.'
      : fallback;
  }

  private clear(): void {
    this.epoch++;
    this.itemState.set([]);
    this.loading.set(false);
    this.saving.set(false);
    this.error.set('');
    this.loadTask = null;
    this.retryCreate = null;
  }
}
