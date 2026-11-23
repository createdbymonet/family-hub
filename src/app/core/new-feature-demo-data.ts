import type { NoteDto, WishlistItemDto } from '../../../shared/contracts';

const createdAt = '2026-11-15T09:00:00.000Z';
const updatedAt = '2026-11-20T09:00:00.000Z';
const author = { authorId: 'demo-alex', authorName: 'Alex', createdAt, updatedAt, version: 1 };

export const DEMO_WISHES: readonly WishlistItemDto[] = [
  {
    ...author,
    id: 'demo-wish-one',
    title: 'A weekend by the sea',
    memo: 'Find a little seaside inn and wake up to the waves.',
    status: 'pending',
    achievedAt: null,
  },
  {
    ...author,
    authorId: 'demo-sam',
    authorName: 'Sam',
    id: 'demo-wish-two',
    title: 'Learn to make our favorite pasta',
    memo: 'A slow Sunday, flour everywhere, and a very good dinner.',
    status: 'pending',
    achievedAt: null,
  },
  {
    ...author,
    id: 'demo-wish-three',
    title: 'Have a picnic under the autumn leaves',
    memo: 'We brought sandwiches and stayed until sunset.',
    status: 'achieved',
    achievedAt: updatedAt,
  },
];

export const DEMO_NOTES: readonly NoteDto[] = [
  {
    ...author,
    id: 'demo-note-one',
    title: 'Ideas for our next free weekend',
    body: 'A few things we could try:\n\nVisit the little bookshop near the station.\nTake a long walk by the river.\nCook something we have never made before.\n\nNo rush — let’s choose together on Friday.',
    status: 'open',
    resolvedAt: null,
  },
  {
    ...author,
    authorId: 'demo-sam',
    authorName: 'Sam',
    id: 'demo-note-two',
    title: 'The plant on the kitchen shelf',
    body: 'Water it when the top of the soil feels dry. A little morning light seems to make it happy.',
    status: 'open',
    resolvedAt: null,
  },
  {
    ...author,
    id: 'demo-note-three',
    title: 'Spare keys',
    body: 'We found a little tray for the spare keys. It is on the hallway shelf.',
    status: 'resolved',
    resolvedAt: updatedAt,
  },
];
