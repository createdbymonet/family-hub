import { DestroyRef, inject, Injectable } from '@angular/core';

import { ShoppingItemDto } from '../../../../shared/contracts';
import { ApiClient } from '../../core/api-client';

@Injectable({ providedIn: 'root' })
export class ShoppingListApi {
  private readonly client = inject(ApiClient);
  private readonly controller = new AbortController();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller.abort());
  }

  list(activity: boolean): Promise<readonly ShoppingItemDto[]> {
    return this.client.request('GET', '/shopping-items', undefined, {
      activity,
      signal: this.controller.signal,
    });
  }

  create(id: string, name: string): Promise<ShoppingItemDto> {
    return this.client.request(
      'POST',
      '/shopping-items',
      { id, name },
      {
        signal: this.controller.signal,
      },
    );
  }

  update(
    item: ShoppingItemDto,
    changes: { readonly name?: string; readonly completed?: boolean },
  ): Promise<ShoppingItemDto> {
    return this.client.request(
      'PATCH',
      `/shopping-items/${encodeURIComponent(item.id)}`,
      { version: item.version, ...changes },
      { signal: this.controller.signal },
    );
  }

  remove(item: ShoppingItemDto): Promise<void> {
    return this.client.request(
      'DELETE',
      `/shopping-items/${encodeURIComponent(item.id)}?version=${item.version}`,
      undefined,
      { signal: this.controller.signal },
    );
  }
}
