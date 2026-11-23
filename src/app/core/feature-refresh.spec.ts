import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onFeatureRefresh } from './feature-refresh';

describe('feature refresh lifecycle', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('marks initial entry as activity, deduplicates passive events, and removes listeners', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    TestBed.configureTestingModule({});
    const refresh = vi.fn();
    TestBed.runInInjectionContext(() => onFeatureRefresh(refresh));
    expect(refresh.mock.calls).toEqual([[true]]);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    expect(refresh.mock.calls).toEqual([[true], [false]]);
    vi.advanceTimersByTime(300);
    window.dispatchEvent(new Event('focus'));
    expect(refresh.mock.calls.at(-1)).toEqual([false]);
    TestBed.resetTestingModule();
    vi.advanceTimersByTime(300);
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
