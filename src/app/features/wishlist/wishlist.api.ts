import { DestroyRef, inject, Injectable } from '@angular/core';

import type { WishlistItemDto } from '../../../../shared/contracts';
import { ApiClient } from '../../core/api-client';

export interface WishInput {
  readonly title: string;
  readonly memo: string;
}
export type WishChanges = Partial<WishInput> & { readonly status?: WishlistItemDto['status'] };

@Injectable({ providedIn: 'root' })
export class WishlistApi {
  private readonly client = inject(ApiClient);
  private readonly controller = new AbortController();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller.abort());
  }

  list(activity: boolean): Promise<readonly WishlistItemDto[]> {
    return this.client.request('GET', '/wishes', undefined, {
      activity,
      signal: this.controller.signal,
    });
  }

  create(id: string, input: WishInput): Promise<WishlistItemDto> {
    return this.client.request(
      'POST',
      '/wishes',
      { id, ...input },
      { signal: this.controller.signal },
    );
  }

  update(item: WishlistItemDto, changes: WishChanges): Promise<WishlistItemDto> {
    return this.client.request(
      'PATCH',
      `/wishes/${encodeURIComponent(item.id)}`,
      { version: item.version, ...changes },
      { signal: this.controller.signal },
    );
  }

  remove(item: WishlistItemDto): Promise<void> {
    return this.client.request(
      'DELETE',
      `/wishes/${encodeURIComponent(item.id)}?version=${item.version}`,
      undefined,
      { signal: this.controller.signal },
    );
  }
}
