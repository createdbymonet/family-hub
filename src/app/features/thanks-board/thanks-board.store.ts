import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';

import { ApiFailure } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { ThanksBoardApi } from './thanks-board.api';
import { LIMITS, ReactionCode, ThanksPost } from './thanks-post.model';

interface RequestContext {
  readonly generation: number;
  readonly userId: string;
}

@Injectable()
export class ThanksBoardStore {
  private readonly api = inject(ThanksBoardApi);
  private readonly auth = inject(AuthService);
  private disposed = false;
  private readonly postState = signal<readonly ThanksPost[]>([]);
  private readonly stateGeneration = signal<number | null>(null);
  private readonly pendingState = signal<ReadonlySet<string>>(new Set());
  private readonly loadingState = signal(false);
  private readonly loadingEarlierState = signal(false);
  private readonly errorState = signal('');
  private errorKind: 'load' | 'mutation' | null = null;
  private readonly cursorState = signal<string | null>(null);
  private revision = 0;
  private loadRequest: { generation: number; revision: number; promise: Promise<void> } | null =
    null;
  private earlierRequest: Promise<void> | null = null;
  private refreshRequested = false;
  private createAttempt: { id: string; message: string } | null = null;

  readonly posts = computed(() => (this.hasCurrentState() ? this.postState() : []));
  readonly loading = computed(() => this.hasCurrentState() && this.loadingState());
  readonly loadingEarlier = computed(() => this.hasCurrentState() && this.loadingEarlierState());
  readonly error = computed(() => (this.hasCurrentState() ? this.errorState() : ''));
  readonly hasEarlier = computed(() => this.hasCurrentState() && this.cursorState() !== null);
  readonly creating = computed(() => this.isPending('create'));

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      this.clear(null);
    });
    effect(() => {
      const generation = this.auth.generation();
      const session = this.auth.session();
      if (!session || this.stateGeneration() !== generation) {
        this.clear(session ? generation : null);
      }
    });
  }

  isPending(key: string): boolean {
    return this.hasCurrentState() && this.pendingState().has(key);
  }

  async load(activity = true): Promise<void> {
    const context = this.context();
    if (!context) return;
    this.prepare(context);
    if (this.pendingState().size) {
      this.refreshRequested = true;
      return;
    }
    if (this.loadRequest?.generation === context.generation) {
      if (this.loadRequest.revision !== this.revision) this.refreshRequested = true;
      return this.loadRequest.promise;
    }

    this.loadingState.set(true);
    if (activity || this.errorKind !== 'mutation') {
      this.errorState.set('');
      this.errorKind = null;
    }
    const revision = this.revision;
    const request = this.api
      .list(activity)
      .then((page) => {
        if (!this.isCurrent(context) || revision !== this.revision) return;
        this.postState.set(page.posts);
        this.cursorState.set(page.nextCursor);
        if (this.errorKind === 'load') {
          this.errorState.set('');
          this.errorKind = null;
        }
      })
      .catch((error: unknown) => {
        if (
          this.isCurrent(context) &&
          revision === this.revision &&
          this.errorKind !== 'mutation'
        ) {
          this.errorState.set(this.message(error, 'Could not load updates. Please try again.'));
          this.errorKind = 'load';
        }
      })
      .finally(() => {
        if (this.loadRequest?.promise === request) this.loadRequest = null;
        if (this.isCurrent(context)) {
          this.loadingState.set(false);
          this.flushRefresh();
        }
      });
    this.loadRequest = { generation: context.generation, revision, promise: request };
    return request;
  }

  async loadEarlier(): Promise<void> {
    const context = this.context();
    const cursor = this.cursorState();
    if (!context || !cursor || this.pendingState().size || this.loadingState()) return;
    if (this.earlierRequest) return this.earlierRequest;
    this.loadingEarlierState.set(true);
    this.errorState.set('');
    this.errorKind = null;
    const revision = this.revision;
    const request = this.api
      .list(true, cursor)
      .then((page) => {
        if (!this.isCurrent(context) || revision !== this.revision) return;
        const current = this.postState();
        const currentIds = new Set(current.map((post) => post.id));
        this.postState.set([...page.posts.filter((post) => !currentIds.has(post.id)), ...current]);
        this.cursorState.set(page.nextCursor);
      })
      .catch((error: unknown) => {
        if (this.isCurrent(context) && revision === this.revision) {
          this.errorState.set(
            this.message(error, 'Could not load earlier updates. Please try again.'),
          );
          this.errorKind = 'load';
        }
      })
      .finally(() => {
        if (this.earlierRequest === request) this.earlierRequest = null;
        if (this.isCurrent(context)) this.loadingEarlierState.set(false);
      });
    this.earlierRequest = request;
    return request;
  }

  async addPost(message: string): Promise<boolean> {
    const trimmed = message.trim();
    if (!this.validateMessage(trimmed)) return false;
    if (this.createAttempt?.message !== trimmed) {
      this.createAttempt = { id: crypto.randomUUID(), message: trimmed };
    }
    const attempt = this.createAttempt;
    return this.mutate(
      'create',
      () => this.api.create(attempt.id, trimmed),
      (post) => {
        this.upsert(post);
        this.createAttempt = null;
      },
    );
  }

  async updatePost(post: ThanksPost, message: string): Promise<boolean> {
    if (!this.isOwnPost(post)) return false;
    const trimmed = message.trim();
    if (!this.validateMessage(trimmed)) return false;
    return this.mutate(
      `post:${post.id}`,
      () => this.api.update(post, trimmed),
      (updated) => {
        this.upsert(updated);
      },
    );
  }

  async deletePost(post: ThanksPost): Promise<boolean> {
    if (!this.isOwnPost(post)) return false;
    return this.mutate(
      `post:${post.id}`,
      () => this.api.remove(post),
      () => {
        this.postState.update((posts) => posts.filter((entry) => entry.id !== post.id));
      },
    );
  }

  async setReaction(post: ThanksPost, code: ReactionCode, present: boolean): Promise<boolean> {
    return this.mutate(
      `post:${post.id}`,
      () => this.api.setReaction(post.id, code, present),
      (updated) => this.upsert(updated),
    );
  }

  private async mutate<T>(
    key: string,
    operation: () => Promise<T>,
    apply: (value: T) => void,
  ): Promise<boolean> {
    const context = this.context();
    if (!context) return false;
    this.prepare(context);
    if (this.pendingState().has(key)) return false;
    this.revision++;
    this.pendingState.update((pending) => new Set([...pending, key]));
    this.errorState.set('');
    this.errorKind = null;
    try {
      const result = await operation();
      if (!this.isCurrent(context)) return false;
      apply(result);
      this.refreshRequested = true;
      return true;
    } catch (error: unknown) {
      if (this.isCurrent(context)) {
        this.errorState.set(this.message(error, 'Could not save your change. Please try again.'));
        this.errorKind = 'mutation';
        if (error instanceof ApiFailure && (error.status === 409 || error.status === 404)) {
          this.refreshRequested = true;
        }
      }
      return false;
    } finally {
      if (this.isCurrent(context)) {
        this.pendingState.update((pending) => {
          const next = new Set(pending);
          next.delete(key);
          return next;
        });
        this.flushRefresh();
      }
    }
  }

  private validateMessage(message: string): boolean {
    const context = this.context();
    if (!context) return false;
    this.prepare(context);
    if (!message || message.length > LIMITS.thanksMessage) {
      this.errorState.set(`Write an update between 1 and ${LIMITS.thanksMessage} characters.`);
      this.errorKind = 'mutation';
      return false;
    }
    return true;
  }

  private isOwnPost(post: ThanksPost): boolean {
    return post.authorId === this.auth.session()?.user.id;
  }

  private context(): RequestContext | null {
    if (this.disposed) return null;
    const session = this.auth.session();
    return session ? { generation: this.auth.generation(), userId: session.user.id } : null;
  }

  private isCurrent(context: RequestContext): boolean {
    return (
      !this.disposed &&
      this.auth.generation() === context.generation &&
      this.auth.session()?.user.id === context.userId
    );
  }

  private hasCurrentState(): boolean {
    return (
      !this.disposed &&
      this.auth.session() !== null &&
      this.stateGeneration() === this.auth.generation()
    );
  }

  private prepare(context: RequestContext): void {
    if (this.stateGeneration() !== context.generation) this.clear(context.generation);
  }

  private clear(generation: number | null): void {
    this.postState.set([]);
    this.pendingState.set(new Set());
    this.loadingState.set(false);
    this.loadingEarlierState.set(false);
    this.errorState.set('');
    this.errorKind = null;
    this.cursorState.set(null);
    this.stateGeneration.set(generation);
    this.loadRequest = null;
    this.earlierRequest = null;
    this.createAttempt = null;
    this.refreshRequested = false;
    this.revision++;
  }

  private upsert(post: ThanksPost): void {
    this.postState.update((posts) => {
      const existing = posts.some((entry) => entry.id === post.id);
      return existing
        ? posts.map((entry) => (entry.id === post.id ? post : entry))
        : [...posts, post];
    });
  }

  private flushRefresh(): void {
    if (this.disposed || !this.refreshRequested || this.pendingState().size || this.loadRequest)
      return;
    this.refreshRequested = false;
    void this.load(false);
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof ApiFailure) {
      if (error.status === 409) {
        return 'This update changed on another device. Review the latest version and try again.';
      }
      if (error.status === 404)
        return 'This update is no longer available. The board will refresh.';
      if (error.status === 401) return 'Your session has expired. Please sign in again.';
    }
    return fallback;
  }
}
