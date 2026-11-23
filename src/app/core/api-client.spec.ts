import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiFailure } from './api-client';
import { AuthService } from './auth.service';

describe('ApiClient', () => {
  let client: ApiClient;
  let auth: AuthService;
  let http: HttpTestingController;
  const navigate = vi.fn().mockResolvedValue(true);
  beforeEach(async () => {
    navigate.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
      ],
    });
    client = TestBed.inject(ApiClient);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    const login = auth.ensureSession();
    http.expectOne('/api/auth/session').flush({
      user: { id: 'one', displayName: 'One' },
      household: { id: 'home', name: 'Home' },
      csrfToken: 'scope-one',
      expiresAt: '',
      absoluteExpiresAt: '',
    });
    await login;
  });
  afterEach(() => http.verify());

  it('adds CSRF and activity for mutations, but does not extend passive reads', async () => {
    const read = client.request('GET', '/shopping-items');
    const get = http.expectOne('/api/shopping-items');
    expect(get.request.headers.has('X-Family-Hub-Activity')).toBe(false);
    get.flush([], { headers: { 'X-Family-Hub-Session': 'scope-one' } });
    await read;
    const save = client.request('POST', '/shopping-items', { id: 'id', name: 'Milk' });
    const post = http.expectOne('/api/shopping-items');
    expect(post.request.headers.get('X-Family-Hub-CSRF')).toBe('scope-one');
    expect(post.request.headers.get('X-Family-Hub-Activity')).toBe('1');
    post.flush({}, { headers: { 'X-Family-Hub-Session': 'scope-one' } });
    await save;
  });

  it('rejects late results and never restores private state after logout', async () => {
    const pending = client.request('GET', '/shopping-items');
    const request = http.expectOne('/api/shopping-items');
    auth.invalidate();
    expect(request.cancelled).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'session_changed' });
    expect(auth.session()).toBeNull();
  });

  it('rejects responses from a switched browser session and routes to login', async () => {
    const pending = client.request('GET', '/shopping-items');
    http.expectOne('/api/shopping-items').flush([], {
      headers: { 'X-Family-Hub-Session': 'scope-two' },
    });
    await expect(pending).rejects.toBeInstanceOf(ApiFailure);
    expect(auth.session()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], expect.any(Object));
  });

  it('aborts private transport when the owning screen is destroyed', async () => {
    const controller = new AbortController();
    const pending = client.request('GET', '/shopping-items', undefined, {
      signal: controller.signal,
    });
    const request = http.expectOne('/api/shopping-items');
    controller.abort();
    expect(request.cancelled).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'request_cancelled' });
    expect(auth.session()).not.toBeNull();
  });

  it('invalidates expired sessions while preserving conflict errors for the feature UI', async () => {
    const conflict = client.request('PATCH', '/shopping-items/item', { version: 1, name: 'Milk' });
    http
      .expectOne('/api/shopping-items/item')
      .flush(
        { error: { code: 'CONFLICT', message: 'This item changed. Refresh and try again.' } },
        { status: 409, statusText: 'Conflict', headers: { 'X-Family-Hub-Session': 'scope-one' } },
      );
    await expect(conflict).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(auth.session()).not.toBeNull();
    const expired = client.request('GET', '/shopping-items');
    http.expectOne('/api/shopping-items').flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(expired).rejects.toMatchObject({ status: 401 });
    expect(auth.session()).toBeNull();
  });
});
