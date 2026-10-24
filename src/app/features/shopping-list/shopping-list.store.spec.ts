import { describe, expect, it } from 'vitest';

import { ShoppingListStore } from './shopping-list.store';

describe('ShoppingListStore', () => {
  it('starts with both completed and outstanding household items', () => {
    const store = new ShoppingListStore();

    expect(store.items().map((item) => item.name)).toEqual([
      'Milk',
      'Eggs',
      'Cat food',
      'Dish soap',
      'Coffee beans',
    ]);
    expect(store.completedCount()).toBe(2);
    expect(store.remainingCount()).toBe(3);
  });

  it('rejects whitespace and creates independently identified trimmed items', () => {
    const store = new ShoppingListStore();

    expect(store.add(' \n ')).toBeNull();
    expect(store.items()).toHaveLength(5);
    const first = store.add('  Bananas  ');
    const second = store.add('Bananas');

    expect(first?.name).toBe('Bananas');
    expect(first?.completed).toBe(false);
    expect(first?.id).not.toBe(second?.id);
    expect(store.remainingCount()).toBe(5);
  });

  it('updates an item without losing completion and safely rejects empty edits', () => {
    const store = new ShoppingListStore();

    expect(store.update('eggs', '   Free-range eggs ')).toBe(true);
    expect(store.items().find((item) => item.id === 'eggs')).toEqual({
      id: 'eggs',
      name: 'Free-range eggs',
      completed: true,
    });
    expect(store.update('eggs', '  ')).toBe(false);
    expect(store.update('missing', 'Bread')).toBe(false);
    expect(store.items().find((item) => item.id === 'eggs')?.name).toBe('Free-range eggs');
  });

  it('can complete, uncomplete, and delete items while maintaining counts', () => {
    const store = new ShoppingListStore();

    store.toggle('milk');
    expect(store.completedCount()).toBe(3);
    store.toggle('milk');
    expect(store.completedCount()).toBe(2);
    store.remove('eggs');
    expect(store.completedCount()).toBe(1);
    expect(store.remainingCount()).toBe(3);
    expect(store.items().some((item) => item.id === 'eggs')).toBe(false);
  });
});
