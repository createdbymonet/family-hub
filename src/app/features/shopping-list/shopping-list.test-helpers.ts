import { signal } from '@angular/core';
import { vi } from 'vitest';

import { SessionDto, ShoppingItemDto } from '../../../../shared/contracts';

export const TEST_SESSION: SessionDto = {
  user: { id: 'user-one', displayName: 'Alex' },
  household: { id: 'household-one', name: 'Our family' },
  csrfToken: 'test-csrf',
  expiresAt: '2027-01-01T00:00:00.000Z',
  absoluteExpiresAt: '2027-06-01T00:00:00.000Z',
};

export const TEST_ITEMS: readonly ShoppingItemDto[] = [
  {
    id: 'milk',
    name: 'Milk',
    completed: false,
    version: 1,
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
  {
    id: 'eggs',
    name: 'Eggs',
    completed: true,
    version: 1,
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
];

export function fakeAuth() {
  return { session: signal<SessionDto | null>(TEST_SESSION), generation: signal(0) };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

export function fakeShoppingApi() {
  let items = [...TEST_ITEMS];
  return {
    list: vi.fn(async (_activity: boolean): Promise<readonly ShoppingItemDto[]> => [...items]),
    create: vi.fn(async (id: string, name: string): Promise<ShoppingItemDto> => {
      const item = { ...TEST_ITEMS[0]!, id, name, completed: false };
      items = [...items.filter((entry) => entry.id !== id), item];
      return item;
    }),
    update: vi.fn(
      async (
        item: ShoppingItemDto,
        changes: { readonly name?: string; readonly completed?: boolean },
      ): Promise<ShoppingItemDto> => {
        const updated = { ...item, ...changes, version: item.version + 1 };
        items = items.map((entry) => (entry.id === item.id ? updated : entry));
        return updated;
      },
    ),
    remove: vi.fn(async (item: ShoppingItemDto): Promise<void> => {
      items = items.filter((entry) => entry.id !== item.id);
    }),
  };
}
