import { DOCUMENT } from '@angular/common';
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import { DEFAULT_USER_SETTINGS, UserSettingsDto } from '../../../shared/contracts';
import { ApiClient, ApiFailure } from './api-client';
import { AuthService } from './auth.service';

export type SettingsChanges = Partial<Omit<UserSettingsDto, 'version'>>;

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly privateSettings = signal<UserSettingsDto>({ ...DEFAULT_USER_SETTINGS });
  private readonly demoState = signal<UserSettingsDto>({ ...DEFAULT_USER_SETTINGS });
  private readonly demoMode = signal(false);
  private scope = '';
  private revision = 0;
  private controller: AbortController | null = null;
  private pendingLoad: Promise<boolean> | null = null;
  private beforeSave: UserSettingsDto | null = null;
  readonly settings = computed(() => (this.demoMode() ? this.demoState() : this.privateSettings()));
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loaded = signal(false);
  readonly error = signal('');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.revision++;
      this.controller?.abort();
    });
    effect(() => {
      this.auth.generation();
      this.auth.session();
      untracked(() => this.syncScope());
    });
    effect(() => {
      this.document.documentElement.setAttribute('data-theme', this.settings().theme);
    });
  }

  setDemoMode(demo: boolean): void {
    this.demoMode.set(demo);
    if (demo) {
      this.controller?.abort();
      this.revision++;
      this.pendingLoad = null;
      this.loading.set(false);
      if (this.beforeSave) this.privateSettings.set(this.beforeSave);
      this.beforeSave = null;
      this.saving.set(false);
    }
  }

  async load(activity = false): Promise<boolean> {
    this.syncScope();
    if (this.demoMode() || !this.auth.session() || this.saving()) return false;
    if (this.pendingLoad) return this.pendingLoad;
    const scope = this.scope;
    const revision = ++this.revision;
    this.controller?.abort();
    this.controller = new AbortController();
    this.loading.set(true);
    this.error.set('');
    const pending = this.injector
      .get(ApiClient)
      .request<UserSettingsDto>('GET', '/user-settings', undefined, {
        activity,
        signal: this.controller.signal,
      })
      .then((settings) => {
        if (!this.current(scope, revision)) return false;
        this.privateSettings.set(settings);
        this.loaded.set(true);
        return true;
      })
      .catch(() => {
        if (this.current(scope, revision)) {
          this.error.set('Your preferences could not be loaded. Please try again.');
        }
        return false;
      })
      .finally(() => {
        if (this.current(scope, revision)) this.loading.set(false);
        if (this.pendingLoad === pending) this.pendingLoad = null;
      });
    this.pendingLoad = pending;
    return pending;
  }

  async update(changes: SettingsChanges, demo = false): Promise<boolean> {
    if (demo) {
      this.demoState.update((settings) => ({ ...settings, ...changes }));
      return true;
    }
    this.syncScope();
    if (this.demoMode() || !this.auth.session() || !this.loaded() || this.saving()) return false;
    this.controller?.abort();
    this.pendingLoad = null;
    this.loading.set(false);
    const scope = this.scope;
    const revision = ++this.revision;
    const previous = this.privateSettings();
    this.beforeSave = previous;
    this.privateSettings.set({ ...previous, ...changes });
    this.saving.set(true);
    this.error.set('');
    this.controller = new AbortController();
    let conflict = false;
    try {
      const saved = await this.injector
        .get(ApiClient)
        .request<UserSettingsDto>(
          'PATCH',
          '/user-settings',
          { version: previous.version, ...changes },
          { signal: this.controller.signal },
        );
      if (!this.current(scope, revision)) return false;
      this.privateSettings.set(saved);
      return true;
    } catch (error: unknown) {
      if (!this.current(scope, revision)) return false;
      this.privateSettings.set(previous);
      conflict = error instanceof ApiFailure && error.status === 409;
      this.error.set(
        conflict
          ? 'Your preferences changed on another device. Review them and try again.'
          : 'Your change could not be saved. Please try again.',
      );
      return false;
    } finally {
      if (this.current(scope, revision)) {
        this.beforeSave = null;
        this.saving.set(false);
        if (conflict) {
          const message = this.error();
          const refresh = this.load();
          const refreshRevision = this.revision;
          void refresh.then(() => {
            if (this.current(scope, refreshRevision)) this.error.set(message);
          });
        }
      }
    }
  }

  private syncScope(): void {
    const session = this.auth.session();
    const scope = session
      ? `${this.auth.generation()}:${session.user.id}:${session.csrfToken}`
      : '';
    if (scope === this.scope) return;
    this.scope = scope;
    this.revision++;
    this.controller?.abort();
    this.pendingLoad = null;
    this.beforeSave = null;
    this.privateSettings.set({ ...DEFAULT_USER_SETTINGS });
    this.loaded.set(false);
    this.loading.set(false);
    this.saving.set(false);
    this.error.set('');
  }

  private current(scope: string, revision: number): boolean {
    this.syncScope();
    return this.scope === scope && this.revision === revision;
  }
}
