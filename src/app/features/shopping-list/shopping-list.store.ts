import { computed, Injectable, signal } from '@angular/core';

import { ShoppingItem } from './shopping-item.model';

@Injectable({ providedIn: 'root' })
export class ShoppingListStore {
  private readonly itemState = signal<readonly ShoppingItem[]>([
    { id: 'milk', name: 'Milk', completed: false },
    { id: 'eggs', name: 'Eggs', completed: true },
    { id: 'cat-food', name: 'Cat food', completed: false },
    { id: 'dish-soap', name: 'Dish soap', completed: true },
    { id: 'coffee-beans', name: 'Coffee beans', completed: false },
  ]);

  readonly items = this.itemState.asReadonly();
  readonly completedCount = computed(() => this.items().filter((item) => item.completed).length);
  readonly remainingCount = computed(() => this.items().length - this.completedCount());

  add(name: string): ShoppingItem | null {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return null;
    }

    const item: ShoppingItem = {
      id: crypto.randomUUID(),
      name: trimmedName,
      completed: false,
    };
    this.itemState.update((items) => [...items, item]);
    return item;
  }

  toggle(id: string): void {
    this.itemState.update((items) =>
      items.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item)),
    );
  }

  update(id: string, name: string): boolean {
    const trimmedName = name.trim();
    if (!trimmedName || !this.items().some((item) => item.id === id)) {
      return false;
    }

    this.itemState.update((items) =>
      items.map((item) => (item.id === id ? { ...item, name: trimmedName } : item)),
    );
    return true;
  }

  remove(id: string): void {
    this.itemState.update((items) => items.filter((item) => item.id !== id));
  }
}
