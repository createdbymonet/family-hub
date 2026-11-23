import { ShoppingItemDto, ThanksPostDto } from '../../../shared/contracts';

export const DEMO_USER_ID = 'demo-you';
const sampleDate = '2026-01-12T10:00:00.000Z';

export const DEMO_SHOPPING_ITEMS: readonly ShoppingItemDto[] = [
  { id: 'milk', name: 'Milk', completed: false },
  { id: 'eggs', name: 'Eggs', completed: true },
  { id: 'cat-food', name: 'Cat food', completed: false },
  { id: 'dish-soap', name: 'Dish soap', completed: true },
  { id: 'coffee-beans', name: 'Coffee beans', completed: false },
].map((item) => ({ ...item, version: 1, createdAt: sampleDate, updatedAt: sampleDate }));

export const DEMO_THANKS_POSTS: readonly ThanksPostDto[] = [
  {
    id: 'thanks-kitchen',
    authorId: 'demo-partner',
    message: 'I cleaned the kitchen and took out the recycling!',
    createdAt: '2026-01-12T08:00:00.000Z',
    updatedAt: '2026-01-12T08:00:00.000Z',
    version: 1,
    reactions: [{ code: 'super-thanks', userId: DEMO_USER_ID }],
  },
  {
    id: 'thanks-dinner',
    authorId: DEMO_USER_ID,
    message: 'I made dinner today 🍳',
    createdAt: '2026-01-12T09:00:00.000Z',
    updatedAt: '2026-01-12T09:00:00.000Z',
    version: 1,
    reactions: [{ code: 'awesome', userId: 'demo-partner' }],
  },
  {
    id: 'thanks-cat',
    authorId: 'demo-partner',
    message: 'I changed the cat litter and vacuumed the living room.',
    createdAt: '2026-01-12T09:30:00.000Z',
    updatedAt: '2026-01-12T09:30:00.000Z',
    version: 1,
    reactions: [{ code: 'thanks', userId: DEMO_USER_ID }],
  },
];
