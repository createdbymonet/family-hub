import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../core/api-client';
import { ShoppingListApi } from './shopping-list.api';
import { TEST_ITEMS } from './shopping-list.test-helpers';

describe('ShoppingListApi', () => {
  const request = vi.fn().mockResolvedValue(undefined);
  let api: ShoppingListApi;

  beforeEach(() => {
    request.mockClear();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { request } }] });
    api = TestBed.inject(ShoppingListApi);
  });

  it('distinguishes user initiated loading from background refresh', async () => {
    await api.list(false);
    expect(request).toHaveBeenCalledWith('GET', '/shopping-items', undefined, {
      activity: false,
      signal: expect.any(AbortSignal),
    });
  });

  it('sends a stable create ID and explicit changes with a version', async () => {
    await api.create('new-id', 'Bread');
    expect(request).toHaveBeenLastCalledWith(
      'POST',
      '/shopping-items',
      { id: 'new-id', name: 'Bread' },
      { signal: expect.any(AbortSignal) },
    );
    await api.update(TEST_ITEMS[0]!, { completed: true });
    expect(request).toHaveBeenLastCalledWith(
      'PATCH',
      '/shopping-items/milk',
      { version: 1, completed: true },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('includes version in deletion requests', async () => {
    await api.remove(TEST_ITEMS[0]!);
    expect(request).toHaveBeenCalledWith('DELETE', '/shopping-items/milk?version=1', undefined, {
      signal: expect.any(AbortSignal),
    });
  });

  it('aborts its requests when its injection scope is destroyed', async () => {
    await api.list(true);
    const options = request.mock.calls[0]?.[3] as { signal: AbortSignal };
    expect(options.signal.aborted).toBe(false);
    TestBed.resetTestingModule();
    expect(options.signal.aborted).toBe(true);
  });
});
