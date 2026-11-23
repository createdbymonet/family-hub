import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { SessionDto } from '../../../shared/contracts';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly sessionState = signal<SessionDto | null>(null);
  private readonly generationState = signal(0);
  private readonly statusState = signal<
    'unknown' | 'loading' | 'authenticated' | 'anonymous' | 'error'
  >('unknown');
  private pending: Promise<boolean> | null = null;
  private unconfirmedLogout: SessionDto | null = null;
  private readonly invalidated = new Subject<void>();
  readonly sessionEnded$ = this.invalidated.asObservable();
  private readonly channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('family-hub-auth');

  readonly session = this.sessionState.asReadonly();
  readonly generation = this.generationState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly authenticated = computed(() => this.session() !== null);
  readonly error = signal('');
  readonly loggingOut = signal(false);
  readonly needsLogoutRetry = signal(false);

  constructor() {
    if (this.channel) {
      this.channel.onmessage = () => this.clear(false);
    }
    inject(DestroyRef).onDestroy(() => {
      this.invalidated.next();
      this.invalidated.complete();
      this.channel?.close();
    });
  }

  ensureSession(): Promise<boolean> {
    if (this.loggingOut() || this.needsLogoutRetry()) return Promise.resolve(false);
    if (this.session()) return Promise.resolve(true);
    if (this.status() === 'anonymous') return Promise.resolve(false);
    return this.refreshSession();
  }

  refreshSession(activity = true): Promise<boolean> {
    if (this.loggingOut() || this.needsLogoutRetry()) return Promise.resolve(false);
    if (this.pending) return this.pending;
    const generation = this.generation();
    this.statusState.set('loading');
    this.error.set('');
    const headers = activity ? new HttpHeaders({ 'X-Family-Hub-Activity': '1' }) : undefined;
    const pending = firstValueFrom(
      this.http
        .get<SessionDto>('/api/auth/session', { headers })
        .pipe(takeUntil(this.sessionEnded$)),
    )
      .then((session) => {
        if (this.generation() !== generation) return false;
        const previous = this.session();
        if (previous && previous.csrfToken !== session.csrfToken) {
          this.generationState.update((value) => value + 1);
          this.invalidated.next();
        }
        this.sessionState.set(session);
        this.statusState.set('authenticated');
        return true;
      })
      .catch((error: unknown) => {
        if (this.generation() !== generation) return false;
        this.sessionState.set(null);
        this.generationState.update((value) => value + 1);
        this.invalidated.next();
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.statusState.set('anonymous');
        } else {
          this.statusState.set('error');
          this.error.set('We could not check your session. Please try again.');
        }
        return false;
      })
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }

  invalidate(): void {
    this.clear(true);
  }

  prepareLogin(): boolean {
    if (this.loggingOut() || this.needsLogoutRetry()) return false;
    this.clear(true);
    return true;
  }

  async logout(): Promise<void> {
    if (this.loggingOut()) return;
    const session = this.session() ?? this.unconfirmedLogout;
    this.unconfirmedLogout = session;
    this.loggingOut.set(true);
    this.needsLogoutRetry.set(false);
    this.error.set('');
    // Clear private memory immediately, even if the request fails.
    this.clear(true);
    try {
      if (session) {
        await firstValueFrom(
          this.http.post('/api/auth/logout', null, {
            headers: { 'X-Family-Hub-CSRF': session.csrfToken },
          }),
        );
      }
      this.unconfirmedLogout = null;
    } catch (error: unknown) {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 403 &&
        session &&
        error.headers.get('X-Family-Hub-Session') &&
        error.headers.get('X-Family-Hub-Session') !== session.csrfToken
      ) {
        this.unconfirmedLogout = null;
        this.error.set(
          'The browser session changed. Check the current session before signing out.',
        );
        throw error;
      }
      if (!(error instanceof HttpErrorResponse && error.status === 401)) {
        this.error.set('Sign-out could not be confirmed. Please retry before leaving this device.');
        this.needsLogoutRetry.set(true);
        throw error;
      }
      this.unconfirmedLogout = null;
    } finally {
      this.clear(true);
      this.loggingOut.set(false);
    }
  }

  private clear(broadcast: boolean): void {
    this.generationState.update((value) => value + 1);
    // Unsubscribing aborts the transport too, including delayed Set-Cookie responses.
    this.invalidated.next();
    this.sessionState.set(null);
    this.statusState.set('unknown');
    this.pending = null;
    if (broadcast) this.channel?.postMessage('invalidate');
  }
}
