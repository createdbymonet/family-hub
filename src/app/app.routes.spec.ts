import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionDto, ShoppingItemDto } from '../../shared/contracts';
import { ApiClient } from './core/api-client';
import { AuthService } from './core/auth.service';
import { DEMO_SHOPPING_ITEMS, DEMO_THANKS_POSTS, DEMO_USER_ID } from './core/demo-data';
import { routes } from './app.routes';
import { ShoppingListStore } from './features/shopping-list/shopping-list.store';

describe('Family Hub navigation', () => {
  const session = signal<SessionDto | null>(null);
  const generation = signal(0);
  const ensureSession = vi.fn<() => Promise<boolean>>();
  let items: readonly ShoppingItemDto[];
  const request = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (path === '/shopping-items' && method === 'GET') return items;
    if (path === '/shopping-items' && method === 'POST') {
      const data = body as { id: string; name: string };
      const item = { ...data, completed: false, version: 1, createdAt: '', updatedAt: '' };
      items = [...items, item];
      return item;
    }
    if (path === '/thanks-posts') return { posts: DEMO_THANKS_POSTS, nextCursor: null };
    throw new Error(`Unexpected API call: ${method} ${path}`);
  });

  beforeEach(() => {
    request.mockClear();
    items = [...DEMO_SHOPPING_ITEMS];
    session.set(null);
    generation.set(0);
    ensureSession.mockReset().mockResolvedValue(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: ApiClient, useValue: { request } },
        {
          provide: AuthService,
          useValue: {
            session,
            generation,
            ensureSession,
            status: signal('anonymous'),
            error: signal(''),
            loggingOut: signal(false),
            prepareLogin: vi.fn(),
            refreshSession: ensureSession,
            needsLogoutRetry: signal(false),
          },
        },
      ],
    });
  });

  function signedIn(): void {
    session.set({
      user: { id: DEMO_USER_ID, displayName: 'You' },
      household: { id: 'test-home', name: 'Home' },
      csrfToken: 'test-only',
      expiresAt: '',
      absoluteExpiresAt: '',
    });
    ensureSession.mockResolvedValue(true);
  }

  it('opens both public demos from the menu without checking or fetching private data', async () => {
    const harness = await RouterTestingHarness.create('/');
    const link = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      'a[href="/demo/shopping-list"]',
    );
    link?.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/demo/shopping-list');
    expect(harness.routeNativeElement?.textContent).toContain('Milk');
    expect(harness.routeNativeElement?.querySelector('form')).toBeNull();
    await harness.navigateByUrl('/demo/thanks-board');
    expect(harness.routeNativeElement?.textContent).toContain('I made dinner today');
    expect(harness.routeNativeElement?.querySelector('form')).toBeNull();
    expect(ensureSession).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('guards private direct links and preserves the intended destination', async () => {
    await RouterTestingHarness.create('/thanks-board');
    expect(TestBed.inject(Router).url).toBe('/login?returnTo=%2Fthanks-board');
    expect(request).not.toHaveBeenCalled();
  });

  it('supports direct routes, page titles, and unknown-route fallback', async () => {
    signedIn();
    const harness = await RouterTestingHarness.create('/shopping-list');
    expect(document.title).toBe('Shopping List | Family Hub');
    await harness.navigateByUrl('/thanks-board');
    expect(document.title).toBe('Thanks Board | Family Hub');
    await harness.navigateByUrl('/unknown-page');
    expect(TestBed.inject(Router).url).toBe('/');
    expect(document.title).toBe('Family Hub | Menu');
  });

  it('reloads saved changes when returning to a private screen', async () => {
    signedIn();
    const harness = await RouterTestingHarness.create('/shopping-list');
    await harness.fixture.whenStable();
    const store = harness.routeDebugElement?.injector.get(ShoppingListStore);
    await store?.add('Fresh bread');
    await harness.navigateByUrl('/thanks-board');
    await harness.navigateByUrl('/');
    await harness.navigateByUrl('/shopping-list');
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('Fresh bread');
  });
});
