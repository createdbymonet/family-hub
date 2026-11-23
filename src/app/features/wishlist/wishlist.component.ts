import { DatePipe } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { LIMITS, type WishlistItemDto } from '../../../../shared/contracts';
import { AuthService } from '../../core/auth.service';
import { onFeatureRefresh } from '../../core/feature-refresh';
import { SettingsService } from '../../core/settings.service';
import { IconComponent } from '../../shared/components/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { WishlistApi } from './wishlist.api';
import { WishlistStore } from './wishlist.store';

@Component({
  selector: 'app-wishlist',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, RouterLink, IconComponent, PageHeaderComponent],
  providers: [WishlistApi, WishlistStore],
  templateUrl: './wishlist.component.html',
  styleUrl: './wishlist.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WishlistComponent {
  protected readonly store = inject(WishlistStore);
  protected readonly isDemo = inject(ActivatedRoute).snapshot.data['demo'] === true;
  protected readonly preferences = inject(SettingsService);
  protected readonly limits = LIMITS;
  protected readonly addForm = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    memo: new FormControl('', { nonNullable: true }),
  });
  protected readonly editForm = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    memo: new FormControl('', { nonNullable: true }),
  });
  protected readonly editing = signal<WishlistItemDto | null>(null);
  protected readonly addError = signal(false);
  protected readonly editError = signal(false);
  protected readonly announcement = signal('');
  protected readonly editingMissing = computed(() => {
    const editing = this.editing();
    return !!editing && !this.store.items().some((item) => item.id === editing.id);
  });
  protected readonly visibleItems = computed(() => {
    const editing = this.editing();
    let items = this.store.items();
    if (
      editing &&
      this.editingMissing() &&
      this.auth.session() &&
      this.auth.generation() === this.generation
    ) {
      items = [...items, editing];
    }
    return items.filter(
      (item) =>
        item.id === editing?.id ||
        item.status === 'pending' ||
        this.preferences.settings().showAchievedWishes,
    );
  });
  protected readonly pendingCount = computed(
    () => this.store.items().filter((item) => item.status === 'pending').length,
  );
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.store.items().length - this.visibleItems().length),
  );
  private readonly auth = inject(AuthService);
  private readonly addInput = viewChild<ElementRef<HTMLInputElement>>('addInput');
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');
  private alive = true;
  private generation = this.auth.generation();

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.alive = false));
    onFeatureRefresh((activity) => void this.store.load(this.isDemo, activity));
    effect(() => {
      const generation = this.auth.generation();
      if (generation !== this.generation) {
        this.generation = generation;
        this.addForm.reset();
        this.editForm.reset();
        this.editing.set(null);
        this.announcement.set('');
      }
    });
    afterRenderEffect(() => this.editInput()?.nativeElement.focus());
  }

  protected async add(): Promise<void> {
    if (this.blocked()) return;
    const input = this.addForm.getRawValue();
    const title = input.title.trim();
    const memo = input.memo.trim();
    this.addError.set(!this.valid(title, memo));
    if (this.addError()) {
      this.addInput()?.nativeElement.focus();
      return;
    }
    const generation = this.auth.generation();
    const item = await this.store.create({ title, memo });
    if (!item || !this.active(generation)) return;
    this.addForm.reset();
    this.announcement.set(`Added ${item.title}.`);
    this.addInput()?.nativeElement.focus();
  }

  protected startEditing(item: WishlistItemDto): void {
    if (this.blocked()) return;
    this.editForm.setValue({ title: item.title, memo: item.memo });
    this.editError.set(false);
    this.editing.set(item);
  }

  protected async save(): Promise<void> {
    const item = this.editing();
    if (this.blocked() || !item || this.editingMissing()) return;
    const input = this.editForm.getRawValue();
    const title = input.title.trim();
    const memo = input.memo.trim();
    this.editError.set(!this.valid(title, memo));
    if (this.editError()) {
      this.editInput()?.nativeElement.focus();
      return;
    }
    const generation = this.auth.generation();
    const saved = await this.store.update(item, { title, memo });
    if (!this.active(generation)) return;
    if (!saved) {
      this.editing.set(this.store.items().find((entry) => entry.id === item.id) ?? item);
      return;
    }
    this.announcement.set(`Saved ${title}.`);
    this.cancelEditing();
  }

  protected cancelEditing(): void {
    if (this.store.saving()) return;
    this.editing.set(null);
    this.editError.set(false);
    this.addInput()?.nativeElement.focus();
  }

  protected async toggle(item: WishlistItemDto): Promise<void> {
    if (this.blocked()) return;
    const status = item.status === 'pending' ? 'achieved' : 'pending';
    const generation = this.auth.generation();
    if ((await this.store.update(item, { status })) && this.active(generation)) {
      this.announcement.set(
        `${item.title} ${status === 'achieved' ? 'achieved!' : 'moved back to your wishes.'}`,
      );
      this.addInput()?.nativeElement.focus();
    }
  }

  protected async remove(item: WishlistItemDto): Promise<void> {
    if (this.blocked() || !window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    const generation = this.auth.generation();
    if ((await this.store.remove(item)) && this.active(generation)) {
      if (this.editing()?.id === item.id) this.cancelEditing();
      this.announcement.set(`Deleted ${item.title}.`);
      this.addInput()?.nativeElement.focus();
    }
  }

  protected preventImeSubmit(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.isComposing) event.preventDefault();
  }

  protected retry(): void {
    void this.store.load(this.isDemo, true);
  }

  protected blocked(): boolean {
    return this.isDemo || this.store.loading() || this.store.saving();
  }

  private valid(title: string, memo: string): boolean {
    return title.length > 0 && title.length <= LIMITS.wishTitle && memo.length <= LIMITS.wishMemo;
  }

  private active(generation: number): boolean {
    return this.alive && this.auth.generation() === generation && this.auth.session() !== null;
  }
}
