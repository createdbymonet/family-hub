import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ShoppingItemDto } from '../../../../shared/contracts';
import { ApiFailure } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { ShoppingListApi } from './shopping-list.api';
import { ShoppingListStore } from './shopping-list.store';
import { deferred, fakeAuth, fakeShoppingApi, TEST_ITEMS } from './shopping-list.test-helpers';

describe('ShoppingListStore', () => {
  let store: ShoppingListStore;
  let api: ReturnType<typeof fakeShoppingApi>;
  let auth: ReturnType<typeof fakeAuth>;

  beforeEach(() => {
    api = fakeShoppingApi();
    auth = fakeAuth();
    TestBed.configureTestingModule({
      providers: [
        ShoppingListStore,
        { provide: ShoppingListApi, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    });
    store = TestBed.inject(ShoppingListStore);
    TestBed.tick();
  });

  it('loads shared items and derives completed and outstanding counts', async () => {
    expect(store.items()).toEqual([]);
    await store.load();
    expect(api.list).toHaveBeenCalledWith(true);
    expect(store.items()).toEqual(TEST_ITEMS);
    expect(store.completedCount()).toBe(1);
    expect(store.remainingCount()).toBe(1);
  });

  it('uses readonly demo fixtures without any API calls, including attempted writes', async () => {
    await store.load(true);
    const initial = store.items();
    expect(initial).toHaveLength(5);
    expect(await store.add('Bread')).toBeNull();
    expect(await store.update(initial[0]!, 'Changed')).toBe(false);
    expect(await store.setCompleted(initial[0]!, true)).toBe(false);
    expect(await store.remove(initial[0]!)).toBe(false);
    expect(store.items()).toBe(initial);
    expect(api.list).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('validates, trims, creates independent IDs, and refreshes without background activity', async () => {
    await store.load();
    expect(await store.add(' \n ')).toBeNull();
    expect(await store.add('a'.repeat(201))).toBeNull();
    expect(api.create).not.toHaveBeenCalled();
    const first = await store.add('  Bananas  ');
    const second = await store.add('Bananas');
    expect(first?.name).toBe('Bananas');
    expect(first?.completed).toBe(false);
    expect(first?.id).not.toBe(second?.id);
    expect(store.remainingCount()).toBe(3);
    expect(api.list).toHaveBeenLastCalledWith(false);
  });

  it('updates names and desired completion values using the original version', async () => {
    await store.load();
    expect(await store.update(store.items()[1]!, '   Free-range eggs ')).toBe(true);
    expect(api.update).toHaveBeenLastCalledWith(TEST_ITEMS[1], { name: 'Free-range eggs' });
    expect(store.items()[1]?.completed).toBe(true);
    expect(await store.update(store.items()[1]!, '  ')).toBe(false);
    const item = store.items()[0]!;
    expect(await store.setCompleted(item, true)).toBe(true);
    expect(api.update).toHaveBeenLastCalledWith(item, { completed: true });
    expect(store.completedCount()).toBe(2);
    expect(await store.setCompleted(store.items()[0]!, false)).toBe(true);
    expect(await store.remove(store.items()[1]!)).toBe(true);
    expect(store.items()).toHaveLength(1);
    expect(store.completedCount()).toBe(0);
  });

  it('retains items on failure and reuses a create ID on retry', async () => {
    await store.load();
    api.create.mockRejectedValueOnce(new Error('Offline'));
    expect(await store.add('Bread')).toBeNull();
    expect(store.error()).toContain('input has been kept');
    expect(store.items()).toEqual(TEST_ITEMS);
    const failedId = api.create.mock.calls[0]?.[0];
    await store.add('Bread');
    expect(api.create.mock.calls[1]?.[0]).toBe(failedId);
    api.remove.mockRejectedValueOnce(new Error('Offline'));
    expect(await store.remove(store.items()[0]!)).toBe(false);
    expect(store.items().some((item) => item.id === 'milk')).toBe(true);
  });

  it('refreshes a conflict while keeping a clear error and the failed result', async () => {
    await store.load();
    api.update.mockRejectedValueOnce(new ApiFailure(409, 'conflict', 'Conflict'));
    api.list.mockResolvedValueOnce([{ ...TEST_ITEMS[0]!, name: 'Updated by partner', version: 2 }]);
    expect(await store.update(TEST_ITEMS[0]!, 'My draft')).toBe(false);
    expect(store.items()[0]?.version).toBe(2);
    expect(store.error()).toContain('another device');
  });

  it('deduplicates simultaneous loads and ignores requests to save twice', async () => {
    const load = deferred<readonly ShoppingItemDto[]>();
    api.list.mockReturnValueOnce(load.promise);
    const first = store.load();
    const second = store.load(false, false);
    expect(first).toBe(second);
    expect(api.list).toHaveBeenCalledTimes(1);
    load.resolve(TEST_ITEMS);
    await first;
    const create = deferred<ShoppingItemDto>();
    api.create.mockReturnValueOnce(create.promise);
    const pending = store.add('Bread');
    expect(store.saving()).toBe(true);
    expect(await store.add('Rice')).toBeNull();
    expect(api.create).toHaveBeenCalledTimes(1);
    create.resolve({ ...TEST_ITEMS[0]!, id: 'bread', name: 'Bread' });
    await pending;
    expect(store.saving()).toBe(false);
  });

  it('discards late reads and clears loaded private items on logout', async () => {
    await store.load();
    const pending = deferred<readonly ShoppingItemDto[]>();
    api.list.mockReturnValueOnce(pending.promise);
    const request = store.load(false, false);
    auth.session.set(null);
    auth.generation.update((generation) => generation + 1);
    TestBed.tick();
    expect(store.items()).toEqual([]);
    pending.resolve(TEST_ITEMS);
    await request;
    expect(store.items()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('discards late mutations after logout and does not refresh private data', async () => {
    await store.load();
    const pending = deferred<ShoppingItemDto>();
    api.create.mockReturnValueOnce(pending.promise);
    const request = store.add('Bread');
    auth.session.set(null);
    auth.generation.update((generation) => generation + 1);
    TestBed.tick();
    pending.resolve({ ...TEST_ITEMS[0]!, id: 'bread', name: 'Bread' });
    expect(await request).toBeNull();
    expect(store.items()).toEqual([]);
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('does not let an older family response replace demo fixtures', async () => {
    const pending = deferred<readonly ShoppingItemDto[]>();
    api.list.mockReturnValueOnce(pending.promise);
    const request = store.load();
    await store.load(true);
    pending.resolve(TEST_ITEMS);
    await request;
    expect(store.isDemo()).toBe(true);
    expect(store.items()).toHaveLength(5);
    expect(store.error()).toBe('');
  });

  it('shows retrieval errors and supports retry without switching to demo', async () => {
    api.list.mockRejectedValueOnce(new Error('Offline'));
    await store.load();
    expect(store.items()).toEqual([]);
    expect(store.isDemo()).toBe(false);
    expect(store.error()).toContain('Could not load');
    await store.load();
    expect(store.error()).toBe('');
    expect(store.items()).toEqual(TEST_ITEMS);
  });
});
