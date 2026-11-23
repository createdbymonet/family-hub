import { signal, type Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_USER_SETTINGS,
  type NoteDto,
  type WishlistItemDto,
} from '../../../../shared/contracts';
import { ApiFailure } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { DEMO_NOTES, DEMO_WISHES } from '../../core/new-feature-demo-data';
import { SettingsService } from '../../core/settings.service';
import { NotesApi, type NoteChanges, type NoteInput } from '../../features/notes/notes.api';
import { NotesComponent } from '../../features/notes/notes.component';
import { NotesStore } from '../../features/notes/notes.store';
import { fakeAuth } from '../../features/shopping-list/shopping-list.test-helpers';
import {
  WishlistApi,
  type WishChanges,
  type WishInput,
} from '../../features/wishlist/wishlist.api';
import { WishlistComponent } from '../../features/wishlist/wishlist.component';
import { WishlistStore } from '../../features/wishlist/wishlist.store';
import {
  SharedEntriesStore,
  type SharedEntriesApi,
  type SharedEntry,
} from './shared-entries.store';

function suite<T extends SharedEntry & { title: string }, Input, Changes>(config: {
  name: string;
  component: Type<unknown>;
  store: Type<SharedEntriesStore<T, Input, Changes>>;
  api: Type<SharedEntriesApi<T, Input, Changes>>;
  fixtures: readonly T[];
  prefix: string;
  textField: string;
  preference: 'showAchievedWishes' | 'showResolvedNotes';
  statusButton: string;
  undoButton: string;
}): void {
  describe(config.name, () => {
    let fixture: ComponentFixture<unknown>;
    let host: HTMLElement;
    let auth: ReturnType<typeof fakeAuth>;
    let api: ReturnType<typeof makeApi>;
    let route: { snapshot: { data: { demo: boolean } } };
    const settings = signal({ ...DEFAULT_USER_SETTINGS });

    function makeApi() {
      let items = [...config.fixtures];
      return {
        list: vi.fn(async (_activity: boolean): Promise<readonly T[]> => [...items]),
        create: vi.fn(async (id: string, value: Input): Promise<T> => {
          const item = { ...config.fixtures[0]!, ...value, id };
          items = [...items, item];
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

    function query<E extends Element = HTMLElement>(selector: string): E {
      const element = host.querySelector<E>(selector);
      if (!element) throw new Error(`Missing element: ${selector}`);
      return element;
    }

    function type(selector: string, value: string): void {
      const element = query<HTMLInputElement | HTMLTextAreaElement>(selector);
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function click(selector: string): void {
      query<HTMLButtonElement>(selector).click();
    }

    async function create(demo = false): Promise<void> {
      route.snapshot.data.demo = demo;
      if (demo) auth.session.set(null);
      fixture = TestBed.createComponent(config.component);
      host = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    }

    beforeEach(async () => {
      settings.set({ ...DEFAULT_USER_SETTINGS });
      auth = fakeAuth();
      api = makeApi();
      route = { snapshot: { data: { demo: false } } };
      await TestBed.configureTestingModule({
        imports: [config.component],
        providers: [
          provideRouter([]),
          { provide: ActivatedRoute, useValue: route },
          { provide: AuthService, useValue: auth },
          { provide: SettingsService, useValue: { settings } },
        ],
      })
        .overrideComponent(config.component, {
          set: { providers: [config.store, { provide: config.api, useValue: api }] },
        })
        .compileComponents();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('hides closed history by default and immediately reflects display preferences', async () => {
      await create();
      expect(host.querySelectorAll('.entry-card')).toHaveLength(2);
      expect(host.textContent).not.toContain(config.fixtures[2]!.title);
      expect(query<HTMLAnchorElement>('.collection-summary a').getAttribute('href')).toBe(
        '/settings',
      );
      settings.update((value) => ({ ...value, [config.preference]: true }));
      await fixture.whenStable();
      expect(host.querySelectorAll('.entry-card')).toHaveLength(3);
      expect(host.textContent).toContain(config.fixtures[2]!.title);
      expect(host.textContent).toContain(config.undoButton);
      expect(host.querySelector('.closed-date time')).not.toBeNull();
    });

    it('creates trimmed content and clears the form after success', async () => {
      await create();
      type(`#${config.prefix}-title`, '   A new idea   ');
      type(`#${config.prefix}-${config.textField}`, '   First line\nSecond line   ');
      click('.entry-form button[type="submit"]');
      await fixture.whenStable();
      expect(api.create).toHaveBeenCalledWith(expect.any(String), {
        title: 'A new idea',
        [config.textField]: 'First line\nSecond line',
      });
      expect(query<HTMLInputElement>(`#${config.prefix}-title`).value).toBe('');
      expect(host.textContent).toContain('A new idea');
      expect(query('[aria-live]').textContent).toContain('Added A new idea.');
    });

    it('rejects blank titles accessibly and keeps failed create drafts', async () => {
      await create();
      click('.entry-form button[type="submit"]');
      await fixture.whenStable();
      expect(query(`#${config.prefix}-title`).getAttribute('aria-invalid')).toBe('true');
      expect(api.create).not.toHaveBeenCalled();
      type(`#${config.prefix}-title`, 'My draft');
      type(`#${config.prefix}-${config.textField}`, 'Some text');
      api.create.mockRejectedValueOnce(new Error('Offline'));
      click('.entry-form button[type="submit"]');
      await fixture.whenStable();
      expect(query<HTMLInputElement>(`#${config.prefix}-title`).value).toBe('My draft');
      expect(host.textContent).toContain('input has been kept');
    });

    it('allows editing a partner’s entry and saves both fields', async () => {
      await create();
      const item = config.fixtures[0]!;
      click(`button[aria-label="Edit ${item.title}"]`);
      await fixture.whenStable();
      type(`#${config.prefix}-edit-title-${item.id}`, 'Our updated idea');
      type(`#${config.prefix}-edit-${config.textField}-${item.id}`, 'Updated\nTogether');
      click('.edit-form button[type="submit"]');
      await fixture.whenStable();
      expect(api.update).toHaveBeenLastCalledWith(item, {
        title: 'Our updated idea',
        [config.textField]: 'Updated\nTogether',
      });
      expect(host.querySelector('.edit-form')).toBeNull();
      expect(host.textContent).toContain('Our updated idea');
    });

    it('keeps edit drafts after conflict and retries with the refreshed version', async () => {
      await create();
      const item = config.fixtures[0]!;
      click(`button[aria-label="Edit ${item.title}"]`);
      await fixture.whenStable();
      type(`#${config.prefix}-edit-title-${item.id}`, 'My draft');
      api.update.mockRejectedValueOnce(new ApiFailure(409, 'CONFLICT', 'Conflict'));
      api.list.mockResolvedValueOnce([{ ...item, title: 'Partner’s update', version: 2 }]);
      click('.edit-form button[type="submit"]');
      await fixture.whenStable();
      expect(query<HTMLInputElement>(`#${config.prefix}-edit-title-${item.id}`).value).toBe(
        'My draft',
      );
      expect(host.textContent).toContain('another device');
      click('.edit-form button[type="submit"]');
      await fixture.whenStable();
      expect(api.update.mock.calls.at(-1)![0].version).toBe(2);
    });

    it('changes status, retains history, and allows undo when history is visible', async () => {
      await create();
      click('.status-action');
      await fixture.whenStable();
      expect(host.querySelectorAll('.entry-card')).toHaveLength(1);
      settings.update((value) => ({ ...value, [config.preference]: true }));
      await fixture.whenStable();
      const undo = [...host.querySelectorAll<HTMLButtonElement>('.status-action')].find(
        (button) => button.textContent?.trim() === config.undoButton,
      );
      expect(undo).toBeDefined();
      undo!.click();
      await fixture.whenStable();
      expect(api.update).toHaveBeenCalledTimes(2);
    });

    it('requires delete confirmation for a partner’s entry', async () => {
      await create();
      const item = config.fixtures[0]!;
      vi.mocked(window.confirm).mockReturnValueOnce(false);
      click(`button[aria-label="Delete ${item.title}"]`);
      await fixture.whenStable();
      expect(api.remove).not.toHaveBeenCalled();
      click(`button[aria-label="Delete ${item.title}"]`);
      await fixture.whenStable();
      expect(api.remove).toHaveBeenCalledWith(item);
      expect(query('.entry-list').textContent).not.toContain(item.title);
    });

    it('keeps the current draft when a partner closes or removes the entry', async () => {
      await create();
      const item = config.fixtures[0]!;
      click(`button[aria-label="Edit ${item.title}"]`);
      await fixture.whenStable();
      const selector = `#${config.prefix}-edit-title-${item.id}`;
      type(selector, 'A draft worth keeping');
      api.list.mockResolvedValueOnce([
        { ...item, status: config.prefix === 'wish' ? 'achieved' : 'resolved', version: 2 },
      ]);
      const store = fixture.debugElement.injector.get(config.store);
      await store.load(false, false);
      await fixture.whenStable();
      expect(query<HTMLInputElement>(selector).value).toBe('A draft worth keeping');
      api.list.mockResolvedValueOnce([]);
      await store.load(false, false);
      await fixture.whenStable();
      expect(query<HTMLInputElement>(selector).value).toBe('A draft worth keeping');
      expect(query<HTMLButtonElement>('.edit-form button[type="submit"]').disabled).toBe(true);
      expect(host.textContent).toContain('removed on another device');
    });

    it('refreshes on tab focus and clears private drafts on logout', async () => {
      await create();
      type(`#${config.prefix}-title`, 'Private draft');
      window.dispatchEvent(new Event('focus'));
      await fixture.whenStable();
      expect(api.list).toHaveBeenLastCalledWith(false);
      auth.session.set(null);
      auth.generation.update((value) => value + 1);
      await fixture.whenStable();
      expect(host.querySelectorAll('.entry-card')).toHaveLength(0);
      expect(query<HTMLInputElement>(`#${config.prefix}-title`).value).toBe('');
    });

    it('renders fictional, readonly demos without private requests or mutation controls', async () => {
      await create(true);
      expect(host.textContent).toContain('Demo Mode');
      expect(host.querySelector('form')).toBeNull();
      expect(host.querySelector('.entry-actions')).toBeNull();
      expect(query<HTMLAnchorElement>('.collection-summary a').getAttribute('href')).toBe(
        '/demo/settings',
      );
      window.dispatchEvent(new Event('focus'));
      await fixture.whenStable();
      expect(api.list).not.toHaveBeenCalled();
      expect(api.create).not.toHaveBeenCalled();
      expect(api.update).not.toHaveBeenCalled();
      expect(api.remove).not.toHaveBeenCalled();
    });

    if (config.textField === 'body') {
      it('opens full multiline plain text from the title and keeps open notes before resolved history', async () => {
        settings.update((value) => ({ ...value, showResolvedNotes: true }));
        await create(true);
        const title = query<HTMLButtonElement>('.note-title');
        const preview = query('.note-preview').textContent ?? '';
        title.click();
        await fixture.whenStable();
        expect(title.getAttribute('aria-expanded')).toBe('true');
        expect(query('.note-detail').textContent!.length).toBeGreaterThan(preview.length);
        expect(query('.note-detail').textContent).toContain('\n');
        expect(host.querySelectorAll('.entry-card')[2]!.classList.contains('is-closed')).toBe(true);
        title.click();
        await fixture.whenStable();
        expect(title.getAttribute('aria-expanded')).toBe('false');
        expect(host.querySelector('.note-detail')).toBeNull();
      });
    }
  });
}

suite<WishlistItemDto, WishInput, WishChanges>({
  name: 'WishlistComponent',
  component: WishlistComponent,
  store: WishlistStore,
  api: WishlistApi,
  fixtures: DEMO_WISHES,
  prefix: 'wish',
  textField: 'memo',
  preference: 'showAchievedWishes',
  statusButton: 'Achieved!',
  undoButton: 'Undo',
});
suite<NoteDto, NoteInput, NoteChanges>({
  name: 'NotesComponent',
  component: NotesComponent,
  store: NotesStore,
  api: NotesApi,
  fixtures: DEMO_NOTES,
  prefix: 'note',
  textField: 'body',
  preference: 'showResolvedNotes',
  statusButton: 'Mark as Resolved',
  undoButton: 'Reopen',
});
