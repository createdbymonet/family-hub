export const LIMITS = {
  shoppingName: 200,
  thanksMessage: 2000,
  wishTitle: 200,
  wishMemo: 1000,
  noteTitle: 200,
  noteBody: 4000,
} as const;

export const REACTION_OPTIONS = [
  { code: 'super-thanks', label: 'Thanks a lot!', accessibleLabel: 'Thanks a lot!' },
  { code: 'thanks', label: 'Thank you!', accessibleLabel: 'Thank you!' },
  { code: 'awesome', label: 'Awesome!', accessibleLabel: 'Awesome!' },
  { code: 'heart', label: '❤️', accessibleLabel: 'Heart' },
  { code: 'clap', label: '👏', accessibleLabel: 'Clap' },
] as const;

export type ReactionCode = (typeof REACTION_OPTIONS)[number]['code'];

export const THEMES = [
  { id: 'KAWASAKI', primary: '#8E1728', accent: '#C5A052' },
  { id: 'CHARLOTTE', primary: '#00A3B5', accent: '#7952C7' },
  { id: 'EDOGAWA', primary: '#123F80', accent: '#F28C28' },
] as const;

export type ThemeName = (typeof THEMES)[number]['id'];

export interface UserSettingsDto {
  readonly theme: ThemeName;
  readonly showCompletedShoppingItems: boolean;
  readonly showAchievedWishes: boolean;
  readonly showResolvedNotes: boolean;
  readonly version: number;
}

export const DEFAULT_USER_SETTINGS: UserSettingsDto = {
  theme: 'KAWASAKI',
  showCompletedShoppingItems: false,
  showAchievedWishes: false,
  showResolvedNotes: false,
  version: 1,
};

export interface WishlistItemDto {
  readonly id: string;
  readonly title: string;
  readonly memo: string;
  readonly status: 'pending' | 'achieved';
  readonly authorId: string;
  readonly authorName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly achievedAt: string | null;
  readonly version: number;
}

export interface NoteDto {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: 'open' | 'resolved';
  readonly authorId: string;
  readonly authorName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt: string | null;
  readonly version: number;
}

export interface SessionDto {
  readonly user: { readonly id: string; readonly displayName: string };
  readonly household: { readonly id: string; readonly name: string };
  readonly csrfToken: string;
  readonly expiresAt: string;
  readonly absoluteExpiresAt: string;
}

export interface ShoppingItemDto {
  readonly id: string;
  readonly name: string;
  readonly completed: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ThanksReactionDto {
  readonly userId: string;
  readonly code: ReactionCode;
}

export interface ThanksPostDto {
  readonly id: string;
  readonly authorId: string;
  readonly message: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly reactions: readonly ThanksReactionDto[];
}

export interface ThanksPostsPageDto {
  readonly posts: readonly ThanksPostDto[];
  readonly nextCursor: string | null;
}

export interface ApiErrorDto {
  readonly error: { readonly code: string; readonly message: string };
}
