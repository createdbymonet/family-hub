import { Injectable, signal } from '@angular/core';

import { ThanksPost, ThanksReactionLabel } from './thanks-post.model';

function initialPosts(): ThanksPost[] {
  const now = Date.now();

  return [
    {
      id: 'thanks-kitchen',
      author: 'partner',
      message: 'I cleaned the kitchen and took out the recycling!',
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
      reactions: [{ label: '超ありがとう！', author: 'me' }],
    },
    {
      id: 'thanks-dinner',
      author: 'me',
      message: 'I made dinner today 🍳',
      createdAt: new Date(now - 60 * 60 * 1000),
      reactions: [{ label: '最高！', author: 'partner' }],
    },
    {
      id: 'thanks-cat',
      author: 'partner',
      message: 'I changed the cat litter and vacuumed the living room.',
      createdAt: new Date(now - 30 * 60 * 1000),
      reactions: [{ label: 'ありがとう！', author: 'me' }],
    },
  ];
}

@Injectable({ providedIn: 'root' })
export class ThanksBoardStore {
  private readonly postState = signal<readonly ThanksPost[]>(initialPosts());
  readonly posts = this.postState.asReadonly();

  addPost(message: string): ThanksPost | null {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return null;
    }

    const post: ThanksPost = {
      id: crypto.randomUUID(),
      author: 'me',
      message: trimmedMessage,
      createdAt: new Date(),
      reactions: [],
    };

    this.postState.update((posts) => [...posts, post]);
    return post;
  }

  toggleReaction(postId: string, label: ThanksReactionLabel): void {
    this.postState.update((posts) =>
      posts.map((post) => {
        if (post.id !== postId) {
          return post;
        }

        const alreadyReacted = post.reactions.some(
          (reaction) => reaction.label === label && reaction.author === 'me',
        );

        return {
          ...post,
          reactions: alreadyReacted
            ? post.reactions.filter(
                (reaction) => !(reaction.label === label && reaction.author === 'me'),
              )
            : [...post.reactions, { label, author: 'me' as const }],
        };
      }),
    );
  }
}
