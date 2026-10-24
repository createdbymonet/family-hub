import { beforeEach, describe, expect, it } from 'vitest';

import { ThanksBoardStore } from './thanks-board.store';

describe('ThanksBoardStore', () => {
  let store: ThanksBoardStore;

  beforeEach(() => {
    store = new ThanksBoardStore();
  });

  it('rejects whitespace without adding a post', () => {
    const originalPosts = store.posts();

    expect(store.addPost(' \n\t ')).toBeNull();
    expect(store.posts()).toBe(originalPosts);
  });

  it('adds a trimmed post as the current user with its own ID and timestamp', () => {
    const previousPosts = store.posts();
    const post = store.addPost('  I watered the plants.  ');

    expect(post).toMatchObject({ author: 'me', message: 'I watered the plants.', reactions: [] });
    expect(post?.createdAt).toBeInstanceOf(Date);
    expect(previousPosts.some((previous) => previous.id === post?.id)).toBe(false);
    expect(store.posts()).toHaveLength(previousPosts.length + 1);
    expect(store.posts().at(-1)).toBe(post);
  });

  it('toggles only the current user’s reaction and preserves the partner’s reaction', () => {
    const post = store.posts().find((entry) => entry.author === 'me');
    expect(post).toBeDefined();
    if (!post) throw new Error('Expected a sample post by the current user.');

    store.toggleReaction(post.id, '最高！');
    expect(store.posts().find((entry) => entry.id === post.id)?.reactions).toEqual([
      { label: '最高！', author: 'partner' },
      { label: '最高！', author: 'me' },
    ]);

    store.toggleReaction(post.id, '最高！');
    expect(store.posts().find((entry) => entry.id === post.id)?.reactions).toEqual([
      { label: '最高！', author: 'partner' },
    ]);
  });

  it('keeps different positive reactions independent', () => {
    const post = store.addPost('I folded the laundry.');
    if (!post) throw new Error('Expected a new post.');

    store.toggleReaction(post.id, '❤️');
    store.toggleReaction(post.id, '👏');
    store.toggleReaction(post.id, '❤️');

    expect(store.posts().find((entry) => entry.id === post.id)?.reactions).toEqual([
      { label: '👏', author: 'me' },
    ]);
  });
});
