import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_SETTINGS, UserSettingsDto } from '../../../../shared/contracts';
import { SettingsService } from '../../core/settings.service';
import { SettingsComponent } from './settings.component';

describe('SettingsComponent', () => {
  const settings = signal<UserSettingsDto>(DEFAULT_USER_SETTINGS);
  const update = vi.fn(async (changes: object) => {
    settings.update((s) => ({ ...s, ...changes }));
    return true;
  });
  const load = vi.fn(async () => true);
  const setDemoMode = vi.fn();
  const route = { snapshot: { data: { demo: false } } };
  let fixture: ComponentFixture<SettingsComponent>;
  beforeEach(() => {
    settings.set(DEFAULT_USER_SETTINGS);
    update.mockClear();
    load.mockClear();
    setDemoMode.mockClear();
    route.snapshot.data.demo = false;
    TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        {
          provide: SettingsService,
          useValue: {
            settings,
            update,
            load,
            setDemoMode,
            loaded: signal(true),
            loading: signal(false),
            saving: signal(false),
            error: signal(''),
          },
        },
      ],
    });
  });
  it('shows exact palette previews, accessible radio selection, and all independent switches', async () => {
    fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Appearance');
    expect(host.textContent).toContain('Display Preferences');
    const radios = host.querySelectorAll<HTMLInputElement>('input[type=radio]');
    expect(radios).toHaveLength(3);
    expect(radios[0]?.checked).toBe(true);
    expect(host.querySelector('.theme-colors span')?.getAttribute('style')).toContain(
      'rgb(142, 23, 40)',
    );
    radios[1]!.click();
    await fixture.whenStable();
    expect(update).toHaveBeenCalledWith({ theme: 'CHARLOTTE' }, false);
    host.querySelector<HTMLInputElement>('#showAchievedWishes')!.click();
    await fixture.whenStable();
    expect(settings().showAchievedWishes).toBe(true);
    expect(settings().showResolvedNotes).toBe(false);
  });
  it('uses local preferences and makes no private load in Demo Mode', async () => {
    route.snapshot.data.demo = true;
    fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLInputElement>('input[value=EDOGAWA]')!.click();
    await fixture.whenStable();
    expect(update).toHaveBeenCalledWith({ theme: 'EDOGAWA' }, true);
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(load).not.toHaveBeenCalled();
    expect(host.textContent).toContain('this visit only');
  });
});
