import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShoppingItemDto } from '../../../../shared/contracts';
import { ApiFailure } from '../../core/api-client';
import { SettingsService } from '../../core/settings.service';
import { AuthService } from '../../core/auth.service';
import { ShoppingListApi } from './shopping-list.api';
import { ShoppingListComponent } from './shopping-list.component';
import { ShoppingListStore } from './shopping-list.store';
import { deferred, fakeAuth, fakeShoppingApi, TEST_ITEMS } from './shopping-list.test-helpers';

describe('ShoppingListComponent', () => {
  let fixture: ComponentFixture<ShoppingListComponent>;
  let host: HTMLElement;
  let store: ShoppingListStore;
  let api: ReturnType<typeof fakeShoppingApi>;
  let auth: ReturnType<typeof fakeAuth>;
  let route: { snapshot: { data: { demo: boolean } } };

  function query<T extends Element>(selector: string): T {
    const element = host.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing element: ${selector}`);
    }
    return element;
  }

  function type(selector: string, value: string): HTMLInputElement {
    const input = query<HTMLInputElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  }

  async function create(demo = false): Promise<void> {
    route.snapshot.data.demo = demo;
    fixture = TestBed.createComponent(ShoppingListComponent);
    host = fixture.nativeElement as HTMLElement;
    store = fixture.debugElement.injector.get(ShoppingListStore);
    await store.load(demo);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    api = fakeShoppingApi();
    auth = fakeAuth();
    route = { snapshot: { data: { demo: false } } };
    await TestBed.configureTestingModule({
      imports: [ShoppingListComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ShoppingListApi, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    })
      .overrideComponent(ShoppingListComponent, {
        set: { providers: [ShoppingListStore, { provide: ShoppingListApi, useValue: api }] },
      })
      .compileComponents();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('adds a trimmed item through the Add button and clears input only after success', async () => {
    await create();
    const input = type('#new-item', '   Bread   ');
    query<HTMLButtonElement>('.add-form button').click();
    await fixture.whenStable();
    expect(store.items().at(-1)?.name).toBe('Bread');
    expect(input.value).toBe('');
    expect(host.textContent).toContain('Family Mode');
    expect(query('[aria-live]').textContent).toContain('Added Bread.');
  });

  it('adds once on Enter and ignores Enter used by an input method editor', async () => {
    await create();
    const input = type('#new-item', 'Rice');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(store.items().filter((item) => item.name === 'Rice')).toHaveLength(1);
    type('#new-item', 'お米');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
    await fixture.whenStable();
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it('rejects blank additions with an accessible error', async () => {
    await create();
    type('#new-item', '   ');
    query<HTMLButtonElement>('.add-form button').click();
    await fixture.whenStable();
    expect(store.items()).toHaveLength(2);
    expect(query('#new-item').getAttribute('aria-invalid')).toBe('true');
    expect(query('[role="alert"]').textContent).toContain('Give your item a name');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('checks and unchecks an item using desired boolean values while leaving it visible', async () => {
    await create();
    await TestBed.inject(SettingsService).update({ showCompletedShoppingItems: true }, true);
    TestBed.inject(SettingsService).setDemoMode(true);
    await fixture.whenStable();
    query<HTMLInputElement>('#item-milk').click();
    await fixture.whenStable();
    expect(api.update).toHaveBeenLastCalledWith(TEST_ITEMS[0], { completed: true });
    expect(query('#item-milk').closest('li')?.classList.contains('is-completed')).toBe(true);
    expect(query('label[for="item-milk"]').textContent).toContain('Milk');
    query<HTMLInputElement>('#item-milk').click();
    await fixture.whenStable();
    expect(store.items()[0]?.completed).toBe(false);
  });

  it('cancels drafts, rejects blank edits, preserves IME input, and saves valid edits', async () => {
    await create();
    query<HTMLButtonElement>('button[aria-label="Edit Milk"]').click();
    await fixture.whenStable();
    type('#edit-milk', 'A cancelled draft');
    query<HTMLInputElement>('#edit-milk').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await fixture.whenStable();
    expect(store.items()[0]?.name).toBe('Milk');
    expect(host.querySelector('#edit-milk')).toBeNull();
    query<HTMLButtonElement>('button[aria-label="Edit Milk"]').click();
    await fixture.whenStable();
    type('#edit-milk', '  ');
    query<HTMLButtonElement>('.edit-actions button[type="submit"]').click();
    await fixture.whenStable();
    expect(query('#edit-milk').getAttribute('aria-invalid')).toBe('true');
    const input = type('#edit-milk', '  Oat milk  ');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }),
    );
    await fixture.whenStable();
    expect(api.update).not.toHaveBeenCalled();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(store.items()[0]?.name).toBe('Oat milk');
    expect(host.querySelector('#edit-milk')).toBeNull();
  });

  it('requires deletion confirmation and leaves data unchanged when cancelled', async () => {
    await create();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    query<HTMLButtonElement>('button[aria-label="Delete Milk"]').click();
    await fixture.whenStable();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Milk'));
    expect(api.remove).not.toHaveBeenCalled();
    expect(store.items()).toEqual(TEST_ITEMS);
    for (const item of store.items().filter((item) => !item.completed)) {
      query<HTMLButtonElement>(`button[aria-label="Delete ${item.name}"]`).click();
      await fixture.whenStable();
    }
    expect(host.textContent).toContain('A fresh little list');
  });

  it('retains failed addition and edit inputs and keeps failed deletions in the list', async () => {
    await create();
    api.create.mockRejectedValueOnce(new Error('Offline'));
    const input = type('#new-item', 'Bread');
    query<HTMLButtonElement>('.add-form button').click();
    await fixture.whenStable();
    expect(input.value).toBe('Bread');
    expect(query('[role="alert"]').textContent).toContain('input has been kept');
    query<HTMLButtonElement>('button[aria-label="Edit Milk"]').click();
    await fixture.whenStable();
    api.update.mockRejectedValueOnce(new Error('Offline'));
    const edit = type('#edit-milk', 'My draft');
    query<HTMLButtonElement>('.edit-actions button[type="submit"]').click();
    await fixture.whenStable();
    expect(edit.value).toBe('My draft');
    query<HTMLButtonElement>('.edit-actions button[type="button"]').click();
    await fixture.whenStable();
    api.remove.mockRejectedValueOnce(new Error('Offline'));
    query<HTMLButtonElement>('button[aria-label="Delete Milk"]').click();
    await fixture.whenStable();
    expect(store.items()).toEqual(TEST_ITEMS);
  });

  it('disables controls and suppresses duplicate form submissions while saving', async () => {
    await create();
    const pending = deferred<ShoppingItemDto>();
    api.create.mockReturnValueOnce(pending.promise);
    const input = type('#new-item', 'Bread');
    query<HTMLButtonElement>('.add-form button').click();
    await fixture.whenStable();
    expect(input.value).toBe('Bread');
    expect(input.readOnly).toBe(true);
    expect(query<HTMLButtonElement>('.add-form button').disabled).toBe(true);
    query('form.add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(api.create).toHaveBeenCalledTimes(1);
    api.list.mockResolvedValueOnce([
      ...TEST_ITEMS,
      { ...TEST_ITEMS[0]!, id: 'bread', name: 'Bread' },
    ]);
    pending.resolve({ ...TEST_ITEMS[0]!, id: 'bread', name: 'Bread' });
    await fixture.whenStable();
    expect(input.value).toBe('');
  });

  it('refreshes on page focus without treating background retrieval as activity', async () => {
    await create();
    api.list.mockResolvedValueOnce([{ ...TEST_ITEMS[0]!, name: 'Partner’s change', version: 2 }]);
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(api.list).toHaveBeenLastCalledWith(false);
    expect(host.textContent).toContain('Partner’s change');
  });

  it('keeps an edit draft visible after a version conflict', async () => {
    await create();
    query<HTMLButtonElement>('button[aria-label="Edit Milk"]').click();
    await fixture.whenStable();
    type('#edit-milk', 'My draft');
    api.update.mockRejectedValueOnce(new ApiFailure(409, 'conflict', 'Conflict'));
    api.list.mockResolvedValueOnce([{ ...TEST_ITEMS[0]!, name: 'Partner’s draft', version: 2 }]);
    query<HTMLButtonElement>('.edit-actions button[type="submit"]').click();
    await fixture.whenStable();
    expect(query<HTMLInputElement>('#edit-milk').value).toBe('My draft');
    expect(query('[role="alert"]').textContent).toContain('another device');
  });

  it('renders a readonly demo without accessing real data APIs', async () => {
    await create(true);
    expect(host.textContent).toContain('Demo Mode');
    expect(host.querySelector('.add-form')).toBeNull();
    expect(host.querySelector('.item-actions')).toBeNull();
    expect(host.querySelector('.edit-form')).toBeNull();
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('hides completed items by default and shows them when the personal preference is on', async () => {
    await create();
    expect(host.querySelector('#item-eggs')).toBeNull();
    const preferences = TestBed.inject(SettingsService);
    preferences.setDemoMode(true);
    await preferences.update({ showCompletedShoppingItems: true }, true);
    await fixture.whenStable();
    expect(host.querySelector('#item-eggs')).not.toBeNull();
    await preferences.update({ showCompletedShoppingItems: false }, true);
    await fixture.whenStable();
    expect(host.querySelector('#item-eggs')).toBeNull();
    expect(store.items()).toHaveLength(2);
  });

  it('clears private rows and draft inputs when the session changes', async () => {
    await create();
    type('#new-item', 'Private draft');
    auth.session.set(null);
    auth.generation.update((generation) => generation + 1);
    await fixture.whenStable();
    expect(host.querySelector('.shopping-item')).toBeNull();
    expect(query<HTMLInputElement>('#new-item').value).toBe('');
    expect(host.textContent).not.toContain('Milk');
  });
});
