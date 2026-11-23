import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { LoginComponent } from './login.component';

@Component({ template: '<p>Menu</p>' })
class MenuStubComponent {}

describe('LoginComponent', () => {
  const refreshSession = vi.fn<() => Promise<boolean>>();
  const prepareLogin = vi.fn<() => boolean>();

  beforeEach(() => {
    refreshSession.mockReset().mockResolvedValue(true);
    prepareLogin.mockReset().mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: LoginComponent },
          { path: '', component: MenuStubComponent },
        ]),
        {
          provide: AuthService,
          useValue: {
            refreshSession,
            prepareLogin,
            status: signal('anonymous'),
            loggingOut: signal(false),
            needsLogoutRetry: signal(false),
            error: signal(''),
          },
        },
      ],
    });
  });

  it('starts Google sign-in without forwarding a returnTo parameter', async () => {
    const harness = await RouterTestingHarness.create('/login?returnTo=%2Fthanks-board');
    expect(
      harness.routeNativeElement?.querySelector('a.button--primary')?.getAttribute('href'),
    ).toBe('/api/auth/google/start');
  });

  it('returns an explicitly checked existing session to Menu regardless of returnTo', async () => {
    const harness = await RouterTestingHarness.create('/login?returnTo=%2Fthanks-board');
    harness.routeNativeElement?.querySelector<HTMLButtonElement>('button')?.click();
    await harness.fixture.whenStable();
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('retains the login error and screen when checking a session fails', async () => {
    refreshSession.mockResolvedValue(false);
    const harness = await RouterTestingHarness.create('/login?error=authentication_failed');
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain(
      'Sign-in was not completed',
    );
    harness.routeNativeElement?.querySelector<HTMLButtonElement>('button')?.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/login?error=authentication_failed');
  });
});
