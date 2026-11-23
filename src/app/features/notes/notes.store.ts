import { inject, Injectable } from '@angular/core';

import { LIMITS, type NoteDto } from '../../../../shared/contracts';
import { DEMO_NOTES } from '../../core/new-feature-demo-data';
import { SharedEntriesStore } from '../../shared/stores/shared-entries.store';
import { NotesApi, type NoteChanges, type NoteInput } from './notes.api';

@Injectable({ providedIn: 'root' })
export class NotesStore extends SharedEntriesStore<NoteDto, NoteInput, NoteChanges> {
  constructor() {
    super(
      inject(NotesApi),
      DEMO_NOTES,
      ({ title, body }) =>
        title.trim().length > 0 &&
        title.length <= LIMITS.noteTitle &&
        body.trim().length > 0 &&
        body.length <= LIMITS.noteBody,
    );
  }
}
