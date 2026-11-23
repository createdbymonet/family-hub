import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { LIMITS } from '../../../../shared/contracts';
import { AuthService } from '../../core/auth.service';
import { onFeatureRefresh } from '../../core/feature-refresh';
import { IconComponent } from '../../shared/components/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { ShoppingItem } from './shopping-item.model';
import { ShoppingListApi } from './shopping-list.api';
import { ShoppingListStore } from './shopping-list.store';

@Component({
  selector: 'app-shopping-list',
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent, PageHeaderComponent],
  providers: [ShoppingListApi, ShoppingListStore],
  templateUrl: './shopping-list.component.html',
  styleUrl: './shopping-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListComponent {
  protected readonly store = inject(ShoppingListStore);
  protected readonly isDemo = inject(ActivatedRoute).snapshot.data['demo'] === true;
  protected readonly nameLimit = LIMITS.shoppingName;
  protected readonly addControl = new FormControl('', { nonNullable: true });
  protected readonly editControl = new FormControl('', { nonNullable: true });
  protected readonly addForm = new FormGroup({ name: this.addControl });
  protected readonly editForm = new FormGroup({ name: this.editControl });
  protected readonly editingId = signal<string | null>(null);
  protected readonly addError = signal(false);
  protected readonly editError = signal(false);
  protected readonly announcement = signal('');
  private readonly auth = inject(AuthService);
  private readonly editingItem = signal<ShoppingItem | null>(null);
  private alive = true;
  private generation = this.auth.generation();

  private readonly addInput = viewChild<ElementRef<HTMLInputElement>>('addInput');
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.alive = false));
    onFeatureRefresh((activity) => {
      void this.store.load(this.isDemo, activity);
    });
    effect(() => {
      const generation = this.auth.generation();
      if (generation !== this.generation) {
        this.generation = generation;
        this.addControl.reset();
        this.editControl.reset();
        this.editingId.set(null);
        this.editingItem.set(null);
        this.announcement.set('');
      }
    });
    afterRenderEffect(() => {
      const input = this.editInput()?.nativeElement;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  protected async addItem(): Promise<void> {
    if (this.blocked()) {
      return;
    }
    const name = this.addControl.value.trim();
    this.addError.set(!name || name.length > this.nameLimit);
    if (this.addError()) {
      this.addInput()?.nativeElement.focus();
      return;
    }
    const generation = this.auth.generation();
    const item = await this.store.add(name);
    if (!item || !this.active(generation)) {
      return;
    }
    this.addControl.reset();
    this.announcement.set(`Added ${item.name}.`);
    this.addInput()?.nativeElement.focus();
  }

  protected addOnEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }
    event.preventDefault();
    void this.addItem();
  }

  protected async toggleItem(item: ShoppingItem, event: Event): Promise<void> {
    const checkbox = event.target;
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = item.completed;
    }
    if (this.blocked()) {
      return;
    }
    const generation = this.auth.generation();
    if ((await this.store.setCompleted(item, !item.completed)) && this.active(generation)) {
      this.announcement.set(`${item.name} marked ${item.completed ? 'incomplete' : 'complete'}.`);
    }
  }

  protected startEditing(item: ShoppingItem): void {
    if (this.blocked()) {
      return;
    }
    this.editControl.setValue(item.name);
    this.editError.set(false);
    this.editingId.set(item.id);
    this.editingItem.set(item);
  }

  protected async saveItem(id: string): Promise<void> {
    const item = this.editingItem();
    if (this.blocked() || !item || item.id !== id) {
      return;
    }
    const name = this.editControl.value.trim();
    this.editError.set(!name || name.length > this.nameLimit);
    if (this.editError()) {
      this.editInput()?.nativeElement.focus();
      return;
    }
    const generation = this.auth.generation();
    const saved = await this.store.update(item, name);
    if (!this.active(generation)) {
      return;
    }
    if (!saved) {
      this.editingItem.set(this.store.items().find((entry) => entry.id === id) ?? item);
      this.editInput()?.nativeElement.focus();
      return;
    }
    this.announcement.set(`Saved ${name}.`);
    this.cancelEditing();
  }

  protected cancelEditing(): void {
    if (this.store.saving()) {
      return;
    }
    this.editingId.set(null);
    this.editingItem.set(null);
    this.editError.set(false);
    this.addInput()?.nativeElement.focus();
  }

  protected async deleteItem(item: ShoppingItem): Promise<void> {
    if (this.blocked() || !window.confirm(`Delete ${item.name}? This cannot be undone.`)) {
      return;
    }
    const generation = this.auth.generation();
    const removed = await this.store.remove(item);
    if (!removed || !this.active(generation)) {
      return;
    }
    if (this.editingId() === item.id) {
      this.cancelEditing();
    }
    this.announcement.set(`Deleted ${item.name}.`);
    this.addInput()?.nativeElement.focus();
  }

  protected editOnEnter(event: KeyboardEvent, id: string): void {
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }
    event.preventDefault();
    void this.saveItem(id);
  }

  protected retry(): void {
    void this.store.load(this.isDemo, true);
  }

  private blocked(): boolean {
    return this.isDemo || this.store.saving() || this.store.loading();
  }

  private active(generation: number): boolean {
    return this.alive && this.auth.generation() === generation && this.auth.session() !== null;
  }
}
