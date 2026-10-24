import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { ShoppingListStore } from './features/shopping-list/shopping-list.store';

describe('Family Hub navigation', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes)] }));

  it('opens both screens through the menu cards', async () => {
    const harness = await RouterTestingHarness.create('/');
    const router = TestBed.inject(Router);

    const shoppingLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      'a[href="/shopping-list"]',
    );
    expect(shoppingLink?.textContent).toContain('Shopping List');
    shoppingLink?.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/shopping-list');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Shopping List');

    const backLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>('a[href="/"]');
    backLink?.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/');

    const thanksLink =
      harness.routeNativeElement?.querySelector<HTMLAnchorElement>('a[href="/thanks-board"]');
    expect(thanksLink?.textContent).toContain('Thanks Board');
    thanksLink?.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/thanks-board');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Thanks Board');
  });

  it('supports direct routes, page titles, and unknown-route fallback', async () => {
    const harness = await RouterTestingHarness.create('/shopping-list');
    expect(document.title).toBe('Shopping List | Family Hub');
    await harness.navigateByUrl('/thanks-board');
    expect(document.title).toBe('Thanks Board | Family Hub');
    await harness.navigateByUrl('/unknown-page');
    expect(TestBed.inject(Router).url).toBe('/');
    expect(document.title).toBe('Family Hub | Menu');
  });

  it('retains household changes while moving between screens', async () => {
    const harness = await RouterTestingHarness.create('/shopping-list');
    TestBed.inject(ShoppingListStore).add('Fresh bread');
    await harness.navigateByUrl('/thanks-board');
    await harness.navigateByUrl('/');
    await harness.navigateByUrl('/shopping-list');
    expect(harness.routeNativeElement?.textContent).toContain('Fresh bread');
  });
});
