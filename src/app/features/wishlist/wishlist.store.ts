import { inject, Injectable } from '@angular/core';

import { LIMITS, type WishlistItemDto } from '../../../../shared/contracts';
import { DEMO_WISHES } from '../../core/new-feature-demo-data';
import { SharedEntriesStore } from '../../shared/stores/shared-entries.store';
import { WishlistApi, type WishChanges, type WishInput } from './wishlist.api';

@Injectable({ providedIn: 'root' })
export class WishlistStore extends SharedEntriesStore<WishlistItemDto, WishInput, WishChanges> {
  constructor() {
    super(
      inject(WishlistApi),
      DEMO_WISHES,
      ({ title, memo }) =>
        title.trim().length > 0 &&
        title.length <= LIMITS.wishTitle &&
        memo.length <= LIMITS.wishMemo,
    );
  }
}
