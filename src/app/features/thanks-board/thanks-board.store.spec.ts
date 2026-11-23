import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionDto, ThanksPostDto, ThanksPostsPageDto } from '../../../../shared/contracts';
import { ApiFailure } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { ThanksBoardApi } from './thanks-board.api';
import { ThanksBoardStore } from './thanks-board.store';

const session: SessionDto = {
  user: { id: 'you', displayName: 'You' },
  household: { id: 'home', name: 'Home' },
  csrfToken: 'csrf',
  expiresAt: '2026-12-01T00:00:00.000Z',
  absoluteExpiresAt: '2027-01-01T00:00:00.000Z',
};

function post(id = 'post-1', authorId = 'you'): ThanksPostDto {
  return {
    id,
    authorId,
    message: 'I watered the plants.',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
    version: 1,
    reactions: [{ code: 'awesome', userId: 'partner' }],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ThanksBoardStore', () => {
  let store: ThanksBoardStore;
  let serverPosts: readonly ThanksPostDto[];
  let auth: {
    session: ReturnType<typeof signal<SessionDto | null>>;
    generation: ReturnType<typeof signal<number>>;
  };
  let api: {
    list: ReturnType<typeof vi.fn<ThanksBoardApi['list']>>;
    create: ReturnType<typeof vi.fn<ThanksBoardApi['create']>>;
    update: ReturnType<typeof vi.fn<ThanksBoardApi['update']>>;
    remove: ReturnType<typeof vi.fn<ThanksBoardApi['remove']>>;
    setReaction: ReturnType<typeof vi.fn<ThanksBoardApi['setReaction']>>;
  };

  beforeEach(() => {
    serverPosts = [post(), post('partner-post', 'partner')];
    auth = { session: signal<SessionDto | null>(session), generation: signal(0) };
    api = {
      list: vi.fn(async () => ({ posts: serverPosts, nextCursor: null })),
      create: vi.fn(async (id, message) => {
        const created = { ...post(id), message, reactions: [] };
        serverPosts = [...serverPosts, created];
        return created;
      }),
      update: vi.fn(async (entry, message) => {
        const updated = { ...entry, message, version: entry.version + 1 };
        serverPosts = serverPosts.map((value) => (value.id === entry.id ? updated : value));
        return updated;
      }),
      remove: vi.fn(async (entry) => {
        serverPosts = serverPosts.filter((value) => value.id !== entry.id);
      }),
      setReaction: vi.fn(async (id, code, present) => {
        const entry = serverPosts.find((value) => value.id === id);
        if (!entry) throw new Error('Unknown post');
        const remaining = entry.reactions.filter(
          (reaction) => !(reaction.code === code && reaction.userId === 'you'),
        );
        const updated = {
          ...entry,
          reactions: present ? [...remaining, { code, userId: 'you' }] : remaining,
        };
        serverPosts = serverPosts.map((value) => (value.id === id ? updated : value));
        return updated;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        ThanksBoardStore,
        { provide: AuthService, useValue: auth },
        { provide: ThanksBoardApi, useValue: api },
      ],
    });
    store = TestBed.inject(ThanksBoardStore);
    TestBed.tick();
  });

  it('starts empty, loads shared posts, and keeps ISO dates for DatePipe', async () => {
    expect(store.posts()).toEqual([]);
    await store.load(true);
    expect(api.list).toHaveBeenCalledWith(true);
    expect(store.posts()).toEqual(serverPosts);
    expect(store.posts()[0]?.createdAt).toBe('2026-11-22T00:00:00.000Z');
  });

  it('rejects whitespace and oversized posts without making a request', async () => {
    expect(await store.addPost(' \n\t ')).toBe(false);
    expect(await store.addPost('x'.repeat(2001))).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('creates trimmed posts and only edits or deletes posts by the signed-in author', async () => {
    await store.load();
    expect(await store.addPost('  I folded the laundry.  ')).toBe(true);
    await store.load(false);
    expect(api.create).toHaveBeenCalledWith(expect.any(String), 'I folded the laundry.');
    expect(await store.updatePost(post(), ' Updated ')).toBe(true);
    await store.load(false);
    expect(store.posts().find((entry) => entry.id === 'post-1')?.message).toBe('Updated');
    expect(await store.updatePost(post('partner-post', 'partner'), 'No')).toBe(false);
    expect(await store.deletePost(post('partner-post', 'partner'))).toBe(false);
    expect(api.update).toHaveBeenCalledTimes(1);
    const own = store.posts().find((entry) => entry.id === 'post-1');
    if (!own) throw new Error('Expected own post');
    expect(await store.deletePost(own)).toBe(true);
    await store.load(false);
    expect(store.posts().some((entry) => entry.id === own.id)).toBe(false);
  });

  it('sets explicit reaction state, keeps the partner reaction, and prevents duplicates', async () => {
    await store.load();
    await store.setReaction(post(), 'awesome', true);
    await store.load(false);
    await store.setReaction(post(), 'awesome', true);
    await store.load(false);
    expect(store.posts()[0]?.reactions).toEqual([
      { code: 'awesome', userId: 'partner' },
      { code: 'awesome', userId: 'you' },
    ]);
    await store.setReaction(post(), 'heart', true);
    await store.load(false);
    await store.setReaction(post(), 'awesome', false);
    await store.load(false);
    expect(store.posts()[0]?.reactions).toEqual([
      { code: 'awesome', userId: 'partner' },
      { code: 'heart', userId: 'you' },
    ]);
    expect(api.setReaction).toHaveBeenLastCalledWith('post-1', 'awesome', false);
  });

  it('deduplicates overlapping loads and same-post writes', async () => {
    const list = deferred<ThanksPostsPageDto>();
    api.list.mockReturnValueOnce(list.promise);
    const first = store.load();
    const second = store.load(false);
    expect(api.list).toHaveBeenCalledTimes(1);
    list.resolve({ posts: serverPosts, nextCursor: null });
    await Promise.all([first, second]);
    const save = deferred<ThanksPostDto>();
    api.update.mockReturnValueOnce(save.promise);
    const writing = store.updatePost(post(), 'Saved');
    expect(store.isPending('post:post-1')).toBe(true);
    expect(await store.updatePost(post(), 'Duplicate')).toBe(false);
    expect(api.update).toHaveBeenCalledTimes(1);
    save.resolve({ ...post(), message: 'Saved', version: 2 });
    await writing;
  });

  it('retains a failed create ID for a safe retry and exposes a save error', async () => {
    api.create.mockRejectedValueOnce(new ApiFailure(0, 'network_error', 'Offline'));
    expect(await store.addPost('Retry me')).toBe(false);
    expect(store.error()).toContain('Could not save');
    const id = api.create.mock.calls[0]?.[0];
    expect(await store.addPost('Retry me')).toBe(true);
    expect(api.create.mock.calls[1]?.[0]).toBe(id);
  });

  it('keeps the latest data and reports version conflicts', async () => {
    await store.load();
    api.update.mockRejectedValueOnce(new ApiFailure(409, 'conflict', 'Conflict'));
    expect(await store.updatePost(post(), 'Unsaved draft')).toBe(false);
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
      'Unsaved draft',
    );
    await store.load(false);
    expect(store.posts()[0]?.message).toBe('I watered the plants.');
    expect(store.error()).toContain('changed on another device');
  });

  it('prepends earlier pages and deduplicates repeated post IDs', async () => {
    api.list.mockResolvedValueOnce({ posts: [post('new')], nextCursor: 'opaque cursor' });
    await store.load();
    api.list.mockResolvedValueOnce({ posts: [post('old'), post('new')], nextCursor: null });
    await store.loadEarlier();
    expect(api.list).toHaveBeenLastCalledWith(true, 'opaque cursor');
    expect(store.posts().map((entry) => entry.id)).toEqual(['old', 'new']);
    expect(store.hasEarlier()).toBe(false);
  });

  it('hides private data immediately after logout and ignores a late response', async () => {
    await store.load();
    const list = deferred<ThanksPostsPageDto>();
    api.list.mockReturnValueOnce(list.promise);
    const loading = store.load(false);
    auth.generation.update((value) => value + 1);
    auth.session.set(null);
    expect(store.posts()).toEqual([]);
    TestBed.tick();
    list.resolve({ posts: [post('private-late')], nextCursor: null });
    await loading;
    expect(store.posts()).toEqual([]);
    expect(await store.addPost('No session')).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('does not apply a pending write to a later account session', async () => {
    const save = deferred<ThanksPostDto>();
    api.create.mockReturnValueOnce(save.promise);
    const writing = store.addPost('Old account');
    auth.generation.update((value) => value + 1);
    auth.session.set({ ...session, user: { id: 'partner', displayName: 'Partner' } });
    TestBed.tick();
    save.resolve(post('late-create'));
    expect(await writing).toBe(false);
    expect(store.posts()).toEqual([]);
  });

  it('does not let a slow pre-save refresh overwrite a successful change', async () => {
    await store.load();
    const stale = deferred<ThanksPostsPageDto>();
    const stalePosts = serverPosts;
    api.list.mockReturnValueOnce(stale.promise);
    const reading = store.load(false);
    expect(await store.updatePost(post(), 'A newer saved message')).toBe(true);
    stale.resolve({ posts: stalePosts, nextCursor: null });
    await reading;
    await store.load(false);
    expect(store.posts()[0]?.message).toBe('A newer saved message');
  });

  it('discards a late read after its owning injector is destroyed and cannot refresh again', async () => {
    const reading = deferred<ThanksPostsPageDto>();
    api.list.mockReturnValueOnce(reading.promise);
    const loading = store.load();
    TestBed.resetTestingModule();
    reading.resolve({ posts: [post('late-private')], nextCursor: 'old-cursor' });
    await loading;
    expect(store.posts()).toEqual([]);
    expect(store.hasEarlier()).toBe(false);
    await store.load();
    await store.loadEarlier();
    expect(await store.addPost('A destroyed view cannot save')).toBe(false);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.create).not.toHaveBeenCalled();
  });
});
