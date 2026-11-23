import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionDto } from '../../../shared/contracts';
import { AuthService } from './auth.service';

const session: SessionDto = {
  user: { id: 'user-one', displayName: 'Family member' },
  household: { id: 'household-one', name: 'Our home' },
  csrfToken: 'test-csrf',
  expiresAt: '2026-12-22T00:00:00.000Z',
  absoluteExpiresAt: '2027-05-21T00:00:00.000Z',
};

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('does not fetch a private session just by constructing the public app', () => {
    expect(auth.session()).toBeNull();
    http.expectNone('/api/auth/session');
  });

  it('deduplicates session requests and marks explicit session checks as activity', async () => {
    const first = auth.ensureSession();
    const second = auth.ensureSession();
    expect(first).toBe(second);
    const request = http.expectOne('/api/auth/session');
    expect(request.request.headers.get('X-Family-Hub-Activity')).toBe('1');
    request.flush(session);
    expect(await first).toBe(true);
    expect(auth.session()?.user.id).toBe('user-one');
    expect(await auth.ensureSession()).toBe(true);
  });

  it('discards a delayed session response after invalidation', async () => {
    const pending = auth.ensureSession();
    const request = http.expectOne('/api/auth/session');
    auth.invalidate();
    expect(request.cancelled).toBe(true);
    expect(await pending).toBe(false);
    expect(auth.session()).toBeNull();
  });

  it('keeps authentication failure distinct from a connection failure', async () => {
    const denied = auth.ensureSession();
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(await denied).toBe(false);
    expect(auth.status()).toBe('anonymous');
    const retry = auth.refreshSession(false);
    const request = http.expectOne('/api/auth/session');
    expect(request.request.headers.has('X-Family-Hub-Activity')).toBe(false);
    request.error(new ProgressEvent('error'));
    expect(await retry).toBe(false);
    expect(auth.status()).toBe('error');
    expect(auth.error()).toContain('try again');
  });

  it('clears private memory before logout and allows retry if server invalidation fails', async () => {
    const login = auth.ensureSession();
    http.expectOne('/api/auth/session').flush(session);
    await login;
    const generation = auth.generation();
    const logout = auth.logout();
    expect(auth.session()).toBeNull();
    expect(auth.generation()).toBeGreaterThan(generation);
    const request = http.expectOne('/api/auth/logout');
    expect(request.request.headers.get('X-Family-Hub-CSRF')).toBe(session.csrfToken);
    request.error(new ProgressEvent('error'));
    await expect(logout).rejects.toBeDefined();
    expect(auth.error()).toContain('Sign-out');
    expect(await auth.refreshSession()).toBe(false);
    http.expectNone('/api/auth/session');
    const retry = auth.logout();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await retry;
    expect(auth.error()).toBe('');
  });

  it('cannot restore a session while the logout request is still pending', async () => {
    const login = auth.ensureSession();
    http.expectOne('/api/auth/session').flush(session);
    await login;
    const logout = auth.logout();
    expect(await auth.ensureSession()).toBe(false);
    expect(await auth.refreshSession()).toBe(false);
    expect(auth.prepareLogin()).toBe(false);
    http.expectNone('/api/auth/session');
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    expect(auth.session()).toBeNull();
  });

  it('can recover explicitly if a failed sign-out is retried after another tab switches accounts', async () => {
    const login = auth.ensureSession();
    http.expectOne('/api/auth/session').flush(session);
    await login;
    const logout = auth.logout();
    http.expectOne('/api/auth/logout').error(new ProgressEvent('error'));
    await expect(logout).rejects.toBeDefined();
    const retry = auth.logout();
    http.expectOne('/api/auth/logout').flush(
      {},
      {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'X-Family-Hub-Session': 'new-session' },
      },
    );
    await expect(retry).rejects.toBeDefined();
    expect(auth.needsLogoutRetry()).toBe(false);
    expect(auth.session()).toBeNull();
    const check = auth.refreshSession();
    http.expectOne('/api/auth/session').flush({ ...session, csrfToken: 'new-session' });
    expect(await check).toBe(true);
  });

  it('changes generation when the browser cookie now belongs to another session', async () => {
    const initial = auth.ensureSession();
    http.expectOne('/api/auth/session').flush(session);
    await initial;
    const generation = auth.generation();
    const refresh = auth.refreshSession(false);
    http.expectOne('/api/auth/session').flush({ ...session, csrfToken: 'other-session' });
    await refresh;
    expect(auth.generation()).toBeGreaterThan(generation);
  });
});
