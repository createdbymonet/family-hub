import { DestroyRef, inject, Injectable } from '@angular/core';

import { ReactionCode, ThanksPostDto, ThanksPostsPageDto } from '../../../../shared/contracts';
import { ApiClient } from '../../core/api-client';

@Injectable()
export class ThanksBoardApi {
  private readonly client = inject(ApiClient);
  private readonly controller = new AbortController();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller.abort());
  }

  list(activity: boolean, before?: string): Promise<ThanksPostsPageDto> {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    return this.client.request('GET', `/thanks-posts${query}`, undefined, {
      activity,
      signal: this.controller.signal,
    });
  }

  create(id: string, message: string): Promise<ThanksPostDto> {
    return this.client.request(
      'POST',
      '/thanks-posts',
      { id, message },
      { signal: this.controller.signal },
    );
  }

  update(post: ThanksPostDto, message: string): Promise<ThanksPostDto> {
    return this.client.request(
      'PATCH',
      `/thanks-posts/${encodeURIComponent(post.id)}`,
      { version: post.version, message },
      { signal: this.controller.signal },
    );
  }

  remove(post: ThanksPostDto): Promise<void> {
    return this.client.request(
      'DELETE',
      `/thanks-posts/${encodeURIComponent(post.id)}?version=${post.version}`,
      undefined,
      { signal: this.controller.signal },
    );
  }

  setReaction(postId: string, code: ReactionCode, present: boolean): Promise<ThanksPostDto> {
    return this.client.request(
      present ? 'PUT' : 'DELETE',
      `/thanks-posts/${encodeURIComponent(postId)}/reactions/${encodeURIComponent(code)}`,
      undefined,
      { signal: this.controller.signal },
    );
  }
}
