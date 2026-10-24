export const THANKS_REACTIONS = ['超ありがとう！', 'ありがとう！', '最高！', '❤️', '👏'] as const;

export type ThanksReactionLabel = (typeof THANKS_REACTIONS)[number];
export type ThanksAuthor = 'me' | 'partner';

export interface ThanksReaction {
  readonly label: ThanksReactionLabel;
  readonly author: ThanksAuthor;
}

export interface ThanksPost {
  readonly id: string;
  readonly author: ThanksAuthor;
  readonly message: string;
  readonly createdAt: Date;
  readonly reactions: readonly ThanksReaction[];
}
