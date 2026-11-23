import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../core/api-client';
import { DEMO_NOTES } from '../../core/new-feature-demo-data';
import { NotesApi } from './notes.api';

describe('NotesApi', () => {
  const request = vi.fn().mockResolvedValue(undefined);
  let api: NotesApi;
  beforeEach(() => {
    request.mockClear();
    TestBed.configureTestingModule({
      providers: [NotesApi, { provide: ApiClient, useValue: { request } }],
    });
    api = TestBed.inject(NotesApi);
  });

  it('uses note contracts, multiline plain text, versioned writes, and cancellation', async () => {
    const item = DEMO_NOTES[0]!;
    await api.list(true);
    await api.create('new-id', { title: 'An idea', body: 'First\nSecond' });
    await api.update(item, { status: 'open' });
    await api.remove(item);
    expect(request.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['GET', '/notes', undefined],
      ['POST', '/notes', { id: 'new-id', title: 'An idea', body: 'First\nSecond' }],
      ['PATCH', `/notes/${item.id}`, { version: item.version, status: 'open' }],
      ['DELETE', `/notes/${item.id}?version=${item.version}`, undefined],
    ]);
    expect(request.mock.calls[0]![3].activity).toBe(true);
    const signal = request.mock.calls[0]![3].signal as AbortSignal;
    TestBed.resetTestingModule();
    expect(signal.aborted).toBe(true);
  });
});
