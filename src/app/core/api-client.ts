import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, fromEvent, merge, NEVER, takeUntil } from 'rxjs';
import { AuthService } from './auth.service';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    options: { activity?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path.');
    if (options.signal?.aborted) {
      throw new ApiFailure(0, 'request_cancelled', 'The screen was closed.');
    }
    const session = this.auth.session();
    const generation = this.auth.generation();
    if (!session) throw new ApiFailure(401, 'unauthenticated', 'Please sign in to continue.');
    let headers = new HttpHeaders();
    if (method !== 'GET') headers = headers.set('X-Family-Hub-CSRF', session.csrfToken);
    if (options.activity ?? method !== 'GET') {
      headers = headers.set('X-Family-Hub-Activity', '1');
    }
    try {
      const response = await firstValueFrom(
        this.http
          .request<T>(method, `/api${path}`, { body, headers, observe: 'response' })
          .pipe(
            takeUntil(
              merge(
                this.auth.sessionEnded$,
                options.signal ? fromEvent(options.signal, 'abort') : NEVER,
              ),
            ),
          ),
      );
      if (this.auth.generation() !== generation) {
        throw new ApiFailure(409, 'session_changed', 'The session changed. Please reload.');
      }
      if (options.signal?.aborted) {
        throw new ApiFailure(0, 'request_cancelled', 'The screen was closed.');
      }
      if (response.headers.get('X-Family-Hub-Session') !== session.csrfToken) {
        this.expireSession('session-changed');
        throw new ApiFailure(401, 'session_changed', 'The session changed. Please sign in again.');
      }
      return response.body as T;
    } catch (error: unknown) {
      if (error instanceof ApiFailure) throw error;
      if (this.auth.generation() !== generation) {
        throw new ApiFailure(409, 'session_changed', 'The session changed. Please reload.');
      }
      if (options.signal?.aborted) {
        throw new ApiFailure(0, 'request_cancelled', 'The screen was closed.');
      }
      if (error instanceof HttpErrorResponse) {
        const responseScope = error.headers.get('X-Family-Hub-Session');
        if (responseScope && responseScope !== session.csrfToken) {
          this.expireSession('session-changed');
          throw new ApiFailure(
            401,
            'session_changed',
            'The session changed. Please sign in again.',
          );
        }
        if (error.status === 401) this.expireSession('session-expired');
        const payload: unknown = error.error;
        const detail =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? payload.error
            : null;
        const code =
          typeof detail === 'object' &&
          detail !== null &&
          'code' in detail &&
          typeof detail.code === 'string'
            ? detail.code
            : 'request_failed';
        const message =
          typeof detail === 'object' &&
          detail !== null &&
          'message' in detail &&
          typeof detail.message === 'string'
            ? detail.message
            : error.status === 0
              ? 'Connection failed. Your changes have not been saved. Please try again.'
              : 'The request failed. Please try again.';
        throw new ApiFailure(error.status, code, message);
      }
      throw new ApiFailure(0, 'request_failed', 'The request failed. Please try again.');
    }
  }

  private expireSession(reason: string): void {
    this.auth.invalidate();
    void this.router.navigate(['/login'], { queryParams: { reason } });
  }
}
