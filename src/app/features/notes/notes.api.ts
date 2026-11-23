import { DestroyRef, inject, Injectable } from '@angular/core';

import type { NoteDto } from '../../../../shared/contracts';
import { ApiClient } from '../../core/api-client';

export interface NoteInput {
  readonly title: string;
  readonly body: string;
}
export type NoteChanges = Partial<NoteInput> & { readonly status?: NoteDto['status'] };

@Injectable({ providedIn: 'root' })
export class NotesApi {
  private readonly client = inject(ApiClient);
  private readonly controller = new AbortController();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller.abort());
  }

  list(activity: boolean): Promise<readonly NoteDto[]> {
    return this.client.request('GET', '/notes', undefined, {
      activity,
      signal: this.controller.signal,
    });
  }

  create(id: string, input: NoteInput): Promise<NoteDto> {
    return this.client.request(
      'POST',
      '/notes',
      { id, ...input },
      { signal: this.controller.signal },
    );
  }

  update(item: NoteDto, changes: NoteChanges): Promise<NoteDto> {
    return this.client.request(
      'PATCH',
      `/notes/${encodeURIComponent(item.id)}`,
      { version: item.version, ...changes },
      { signal: this.controller.signal },
    );
  }

  remove(item: NoteDto): Promise<void> {
    return this.client.request(
      'DELETE',
      `/notes/${encodeURIComponent(item.id)}?version=${item.version}`,
      undefined,
      { signal: this.controller.signal },
    );
  }
}
