import { TestBed } from '@angular/core/testing';
import { type Type } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteDto, WishlistItemDto } from '../../../../shared/contracts';
import { ApiFailure } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { DEMO_NOTES, DEMO_WISHES } from '../../core/new-feature-demo-data';
import { NotesApi, type NoteChanges, type NoteInput } from '../../features/notes/notes.api';
import { NotesStore } from '../../features/notes/notes.store';
import { deferred, fakeAuth } from '../../features/shopping-list/shopping-list.test-helpers';
import {
  WishlistApi,
  type WishChanges,
  type WishInput,
} from '../../features/wishlist/wishlist.api';
import { WishlistStore } from '../../features/wishlist/wishlist.store';
import {
  SharedEntriesStore,
  type SharedEntriesApi,
  type SharedEntry,
} from './shared-entries.store';

function suite<T extends SharedEntry, Input, Changes>(
  name: string,
  token: Type<SharedEntriesStore<T, Input, Changes>>,
  apiToken: Type<SharedEntriesApi<T, Input, Changes>>,
  fixtures: readonly T[],
  input: Input,
  changes: Changes,
): void {
  describe(name, () => {
    let store: SharedEntriesStore<T, Input, Changes>;
    let auth: ReturnType<typeof fakeAuth>;
    let api: ReturnType<typeof makeApi>;

    function makeApi() {
      let items = [...fixtures];
      return {
        list: vi.fn(async (_activity: boolean): Promise<readonly T[]> => [...items]),
        create: vi.fn(async (id: string, value: Input): Promise<T> => {
          const item = { ...fixtures[0]!, ...value, id };
          items = [...items.filter((entry) => entry.id !== id), item];
          return item;
        }),
        update: vi.fn(async (item: T, value: Changes): Promise<T> => {
          const updated = { ...item, ...value, version: item.version + 1 };
          items = items.map((entry) => (entry.id === item.id ? updated : entry));
          return updated;
        }),
        remove: vi.fn(async (item: T): Promise<void> => {
          items = items.filter((entry) => entry.id !== item.id);
        }),
      };
    }

    beforeEach(() => {
      auth = fakeAuth();
      api = makeApi();
      TestBed.configureTestingModule({
        providers: [
          token,
          { provide: apiToken, useValue: api },
          { provide: AuthService, useValue: auth },
        ],
      });
      store = TestBed.inject(token);
    });

    it('keeps demos readonly with fictional data and no private API requests', async () => {
      auth.session.set(null);
      await store.load(true);
      expect(store.items()).toEqual(fixtures);
      expect(await store.create(input)).toBeNull();
      expect(await store.update(fixtures[0]!, changes)).toBe(false);
      expect(await store.remove(fixtures[0]!)).toBe(false);
      expect(api.list).not.toHaveBeenCalled();
      expect(api.create).not.toHaveBeenCalled();
      expect(api.update).not.toHaveBeenCalled();
      expect(api.remove).not.toHaveBeenCalled();
    });

    it('creates, updates, and removes through the server and refreshes after writes', async () => {
      await store.load();
      const item = await store.create(input);
      expect(item).not.toBeNull();
      expect(store.items()).toHaveLength(fixtures.length + 1);
      expect(await store.update(item!, changes)).toBe(true);
      expect(api.update).toHaveBeenLastCalledWith(item, changes);
      expect(await store.remove(item!)).toBe(true);
      expect(store.items()).toHaveLength(fixtures.length);
      expect(api.list).toHaveBeenLastCalledWith(false);
    });

    it('reuses a create UUID on retry and leaves failed writes unchanged', async () => {
      await store.load();
      api.create.mockRejectedValueOnce(new Error('Offline'));
      expect(await store.create(input)).toBeNull();
      const id = api.create.mock.calls[0]![0];
      expect(store.items()).toEqual(fixtures);
      expect(store.error()).toContain('input has been kept');
      await store.create(input);
      expect(api.create.mock.calls[1]![0]).toBe(id);
      expect(store.error()).toBe('');
    });

    it('refreshes a conflicting entry and preserves the actionable error', async () => {
      await store.load();
      const changed = { ...fixtures[0]!, version: 2 };
      api.update.mockRejectedValueOnce(new ApiFailure(409, 'CONFLICT', 'Conflict'));
      api.list.mockResolvedValueOnce([changed]);
      expect(await store.update(fixtures[0]!, changes)).toBe(false);
      expect(store.items()).toEqual([changed]);
      expect(store.error()).toContain('another device');
    });

    it('deduplicates writes while saving', async () => {
      await store.load();
      const pending = deferred<T>();
      api.create.mockReturnValueOnce(pending.promise);
      const first = store.create(input);
      expect(await store.create(input)).toBeNull();
      expect(api.create).toHaveBeenCalledTimes(1);
      pending.resolve(fixtures[0]!);
      await first;
      expect(store.saving()).toBe(false);
    });

    it('discards a late family read after entering demo', async () => {
      const pending = deferred<readonly T[]>();
      api.list.mockReturnValueOnce(pending.promise);
      const loading = store.load();
      await store.load(true);
      pending.resolve([]);
      await loading;
      expect(store.items()).toEqual(fixtures);
      expect(store.isDemo()).toBe(true);
    });

    it('clears private data immediately and discards a late mutation after logout', async () => {
      await store.load();
      const pending = deferred<T>();
      api.create.mockReturnValueOnce(pending.promise);
      const saving = store.create(input);
      auth.session.set(null);
      auth.generation.update((value) => value + 1);
      expect(store.items()).toEqual([]);
      TestBed.tick();
      pending.resolve(fixtures[0]!);
      expect(await saving).toBeNull();
      expect(store.items()).toEqual([]);
      expect(api.list).toHaveBeenCalledTimes(1);
    });

    it('reports load errors without switching modes and supports retry', async () => {
      api.list.mockRejectedValueOnce(new Error('Offline'));
      await store.load();
      expect(store.error()).toContain('Could not load');
      expect(store.isDemo()).toBe(false);
      await store.load();
      expect(store.items()).toEqual(fixtures);
      expect(store.error()).toBe('');
    });

    it('rejects a stale entry mutation immediately when the session generation changes', async () => {
      await store.load();
      auth.generation.update((value) => value + 1);
      expect(await store.update(fixtures[0]!, changes)).toBe(false);
      expect(api.update).not.toHaveBeenCalled();
    });
  });
}

suite<WishlistItemDto, WishInput, WishChanges>(
  'WishlistStore',
  WishlistStore,
  WishlistApi,
  DEMO_WISHES,
  { title: 'See the northern lights', memo: 'A winter trip together.' },
  { title: 'See the stars', status: 'achieved' },
);
suite<NoteDto, NoteInput, NoteChanges>(
  'NotesStore',
  NotesStore,
  NotesApi,
  DEMO_NOTES,
  { title: 'A shared idea', body: 'First line\nSecond line' },
  { title: 'Our plan', status: 'resolved' },
);
