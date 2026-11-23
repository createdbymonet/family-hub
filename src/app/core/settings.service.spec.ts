import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_SETTINGS, UserSettingsDto } from '../../../shared/contracts';
import { ApiClient, ApiFailure } from './api-client';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';
import { deferred, TEST_SESSION } from '../features/shopping-list/shopping-list.test-helpers';

describe('SettingsService', () => {
  const session = signal<typeof TEST_SESSION | null>(TEST_SESSION);
  const generation = signal(0);
  let stored: UserSettingsDto;
  const request = vi.fn(async (method: string, _path: string, changes?: unknown) => {
    if (method === 'PATCH')
      stored = { ...stored, ...(changes as object), version: stored.version + 1 };
    return { ...stored };
  });
  let preferences: SettingsService;

  beforeEach(() => {
    session.set(TEST_SESSION);
    generation.set(0);
    stored = { ...DEFAULT_USER_SETTINGS };
    request.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { session, generation } },
        { provide: ApiClient, useValue: { request } },
      ],
    });
    preferences = TestBed.inject(SettingsService);
  });

  it('starts with private defaults without making requests', () => {
    TestBed.tick();
    expect(preferences.settings()).toEqual(DEFAULT_USER_SETTINGS);
    expect(document.documentElement.dataset['theme']).toBe('KAWASAKI');
    expect(request).not.toHaveBeenCalled();
  });

  it('loads durable settings and immediately applies each of the three themes', async () => {
    await preferences.load();
    for (const theme of ['CHARLOTTE', 'EDOGAWA', 'KAWASAKI'] as const) {
      const saving = preferences.update({ theme });
      expect(preferences.settings().theme).toBe(theme);
      TestBed.tick();
      expect(document.documentElement.dataset['theme']).toBe(theme);
      expect(await saving).toBe(true);
    }
    expect(request).toHaveBeenLastCalledWith(
      'PATCH',
      '/user-settings',
      expect.objectContaining({ version: 3, theme: 'KAWASAKI' }),
      expect.anything(),
    );
  });

  it('saves independent flags and restores them after logout, login, and service recreation', async () => {
    await preferences.load();
    await preferences.update({ showCompletedShoppingItems: true });
    await preferences.update({ showAchievedWishes: true });
    expect(stored.showResolvedNotes).toBe(false);
    session.set(null);
    generation.update((n) => n + 1);
    TestBed.tick();
    expect(preferences.settings()).toEqual(DEFAULT_USER_SETTINGS);
    session.set(TEST_SESSION);
    await preferences.load();
    expect(preferences.settings().showCompletedShoppingItems).toBe(true);
    const recreated = TestBed.runInInjectionContext(() => new SettingsService());
    await recreated.load();
    expect(recreated.settings()).toEqual(stored);
  });

  it('keeps a spouse scope separate and rejects a late response from an old session', async () => {
    const late = deferred<UserSettingsDto>();
    request.mockReturnValueOnce(late.promise);
    const loading = preferences.load();
    session.set({
      ...TEST_SESSION,
      user: { id: 'partner', displayName: 'Partner' },
      csrfToken: 'partner-csrf',
    });
    generation.update((n) => n + 1);
    TestBed.tick();
    late.resolve({ ...DEFAULT_USER_SETTINGS, theme: 'EDOGAWA' });
    expect(await loading).toBe(false);
    expect(preferences.settings().theme).toBe('KAWASAKI');
    await preferences.load();
    expect(preferences.settings()).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('rolls back failed saves and refreshes conflicts without silently overwriting', async () => {
    await preferences.load();
    request.mockRejectedValueOnce(new Error('offline'));
    expect(await preferences.update({ theme: 'CHARLOTTE' })).toBe(false);
    expect(preferences.settings().theme).toBe('KAWASAKI');
    expect(preferences.error()).toContain('could not be saved');
    stored = { ...stored, theme: 'EDOGAWA', version: 4 };
    request.mockRejectedValueOnce(new ApiFailure(409, 'CONFLICT', 'Conflict'));
    expect(await preferences.update({ theme: 'CHARLOTTE' })).toBe(false);
    await vi.waitFor(() => {
      expect(preferences.settings().theme).toBe('EDOGAWA');
      expect(preferences.error()).toContain('another device');
    });
  });

  it('keeps demo preferences local even with an existing authenticated session', async () => {
    preferences.setDemoMode(true);
    await preferences.update({ theme: 'CHARLOTTE', showResolvedNotes: true }, true);
    await preferences.load();
    TestBed.tick();
    expect(document.documentElement.dataset['theme']).toBe('CHARLOTTE');
    expect(preferences.settings().showResolvedNotes).toBe(true);
    expect(request).not.toHaveBeenCalled();
    preferences.setDemoMode(false);
    expect(preferences.settings()).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('cancels a pending preference change when entering a demo and can recover on return', async () => {
    await preferences.load();
    const late = deferred<UserSettingsDto>();
    request.mockReturnValueOnce(late.promise);
    const saving = preferences.update({ theme: 'CHARLOTTE' });
    preferences.setDemoMode(true);
    late.resolve({ ...DEFAULT_USER_SETTINGS, theme: 'CHARLOTTE', version: 2 });
    expect(await saving).toBe(false);
    expect(preferences.saving()).toBe(false);
    preferences.setDemoMode(false);
    await preferences.load();
    expect(preferences.settings().theme).toBe('KAWASAKI');
  });
});
