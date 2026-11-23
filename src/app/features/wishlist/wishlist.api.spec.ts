import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../core/api-client';
import { DEMO_WISHES } from '../../core/new-feature-demo-data';
import { WishlistApi } from './wishlist.api';

describe('WishlistApi', () => {
  const request = vi.fn().mockResolvedValue(undefined);
  let api: WishlistApi;
  beforeEach(() => {
    request.mockClear();
    TestBed.configureTestingModule({
      providers: [WishlistApi, { provide: ApiClient, useValue: { request } }],
    });
    api = TestBed.inject(WishlistApi);
  });

  it('sends household requests with versioned writes and a shared cancellation signal', async () => {
    const item = DEMO_WISHES[0]!;
    await api.list(false);
    await api.create('new-id', { title: 'A trip', memo: '' });
    await api.update(item, { status: 'achieved' });
    await api.remove(item);
    expect(request.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['GET', '/wishes', undefined],
      ['POST', '/wishes', { id: 'new-id', title: 'A trip', memo: '' }],
      ['PATCH', `/wishes/${item.id}`, { version: item.version, status: 'achieved' }],
      ['DELETE', `/wishes/${item.id}?version=${item.version}`, undefined],
    ]);
    const signal = request.mock.calls[0]![3].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    TestBed.resetTestingModule();
    expect(signal.aborted).toBe(true);
  });
});
