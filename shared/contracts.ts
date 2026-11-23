export const LIMITS = { shoppingName: 200, thanksMessage: 2000 } as const;

export const REACTION_OPTIONS = [
  { code: 'super-thanks', label: '超ありがとう！' },
  { code: 'thanks', label: 'ありがとう！' },
  { code: 'awesome', label: '最高！' },
  { code: 'heart', label: '❤️' },
  { code: 'clap', label: '👏' },
] as const;

export type ReactionCode = (typeof REACTION_OPTIONS)[number]['code'];

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
