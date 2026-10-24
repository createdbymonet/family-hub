import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ShoppingListComponent } from './shopping-list.component';
import { ShoppingListStore } from './shopping-list.store';

describe('ShoppingListComponent', () => {
  let fixture: ComponentFixture<ShoppingListComponent>;
  let host: HTMLElement;
  let store: ShoppingListStore;

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShoppingListComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ShoppingListComponent);
    host = fixture.nativeElement as HTMLElement;
    store = TestBed.inject(ShoppingListStore);
    await fixture.whenStable();
  });

  it('adds a trimmed item through the Add button and clears the input', async () => {
    const input = type('#new-item', '   Bread   ');
    query<HTMLButtonElement>('.add-form button').click();
    await fixture.whenStable();

    expect(store.items().at(-1)?.name).toBe('Bread');
    expect(input.value).toBe('');
    expect(host.textContent).toContain('Bread');
    expect(query('[role="status"]').textContent).toContain('Added Bread.');
  });

  it('adds once on Enter and ignores Enter used by an input method editor', async () => {
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
    expect(store.items()).toHaveLength(6);
  });

  it('rejects blank additions with an accessible error', async () => {
    type('#new-item', '   ');
    query<HTMLButtonElement>('.add-form button').click();
    await fixture.whenStable();

    expect(store.items()).toHaveLength(5);
    expect(query('#new-item').getAttribute('aria-invalid')).toBe('true');
    expect(query('[role="alert"]').textContent).toContain('Give your item a name');
  });

  it('checks and unchecks an item while leaving it visible', async () => {
    const checkbox = query<HTMLInputElement>('#item-milk');
    checkbox.click();
    await fixture.whenStable();
    expect(store.items().find((item) => item.id === 'milk')?.completed).toBe(true);
    expect(query('label[for="item-milk"]').textContent).toContain('Milk');
    expect(query('#item-milk').closest('li')?.classList.contains('is-completed')).toBe(true);

    checkbox.click();
    await fixture.whenStable();
    expect(store.items().find((item) => item.id === 'milk')?.completed).toBe(false);
  });

  it('cancels draft edits, rejects blank edits, and saves valid edits', async () => {
    query<HTMLButtonElement>('button[aria-label="Edit Milk"]').click();
    await fixture.whenStable();
    type('#edit-milk', 'A cancelled draft');
    query<HTMLButtonElement>('.edit-actions button[type="button"]').click();
    await fixture.whenStable();
    expect(store.items().find((item) => item.id === 'milk')?.name).toBe('Milk');
    expect(host.querySelector('#edit-milk')).toBeNull();

    query<HTMLButtonElement>('button[aria-label="Edit Milk"]').click();
    await fixture.whenStable();
    type('#edit-milk', '  ');
    query<HTMLButtonElement>('.edit-actions button[type="submit"]').click();
    await fixture.whenStable();
    expect(query('#edit-milk').getAttribute('aria-invalid')).toBe('true');
    expect(store.items().find((item) => item.id === 'milk')?.name).toBe('Milk');

    type('#edit-milk', '  Oat milk  ');
    query<HTMLButtonElement>('.edit-actions button[type="submit"]').click();
    await fixture.whenStable();
    expect(store.items().find((item) => item.id === 'milk')?.name).toBe('Oat milk');
    expect(host.querySelector('#edit-milk')).toBeNull();
    expect(host.textContent).toContain('Oat milk');
  });

  it('deletes immediately and shows an empty state after the last item', async () => {
    query<HTMLButtonElement>('button[aria-label="Delete Milk"]').click();
    await fixture.whenStable();
    expect(store.items().some((item) => item.id === 'milk')).toBe(false);
    expect(host.querySelector('#item-milk')).toBeNull();

    for (const item of store.items()) {
      query<HTMLButtonElement>(`button[aria-label="Delete ${item.name}"]`).click();
      await fixture.whenStable();
    }
    expect(host.textContent).toContain('A fresh little list');
  });
});
