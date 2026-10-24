import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { IconComponent } from '../../shared/components/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { ShoppingItem } from './shopping-item.model';
import { ShoppingListStore } from './shopping-list.store';

@Component({
  selector: 'app-shopping-list',
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent, PageHeaderComponent],
  templateUrl: './shopping-list.component.html',
  styleUrl: './shopping-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListComponent {
  protected readonly store = inject(ShoppingListStore);
  protected readonly addControl = new FormControl('', { nonNullable: true });
  protected readonly editControl = new FormControl('', { nonNullable: true });
  protected readonly addForm = new FormGroup({ name: this.addControl });
  protected readonly editForm = new FormGroup({ name: this.editControl });
  protected readonly editingId = signal<string | null>(null);
  protected readonly addError = signal(false);
  protected readonly editError = signal(false);
  protected readonly announcement = signal('');

  private readonly addInput = viewChild.required<ElementRef<HTMLInputElement>>('addInput');
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');

  constructor() {
    afterRenderEffect(() => {
      const input = this.editInput()?.nativeElement;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  protected addItem(): void {
    const item = this.store.add(this.addControl.value);
    this.addError.set(item === null);
    if (!item) {
      this.addInput().nativeElement.focus();
      return;
    }

    this.addControl.reset();
    this.announcement.set(`Added ${item.name}.`);
    this.addInput().nativeElement.focus();
  }

  protected addOnEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }
    event.preventDefault();
    this.addItem();
  }

  protected toggleItem(item: ShoppingItem): void {
    this.store.toggle(item.id);
    this.announcement.set(`${item.name} marked ${item.completed ? 'incomplete' : 'complete'}.`);
  }

  protected startEditing(item: ShoppingItem): void {
    this.editControl.setValue(item.name);
    this.editError.set(false);
    this.editingId.set(item.id);
  }

  protected saveItem(id: string): void {
    const saved = this.store.update(id, this.editControl.value);
    this.editError.set(!saved);
    if (!saved) {
      this.editInput()?.nativeElement.focus();
      return;
    }

    this.announcement.set(`Saved ${this.editControl.value.trim()}.`);
    this.cancelEditing();
  }

  protected cancelEditing(): void {
    this.editingId.set(null);
    this.editError.set(false);
    this.addInput().nativeElement.focus();
  }

  protected deleteItem(item: ShoppingItem): void {
    this.store.remove(item.id);
    if (this.editingId() === item.id) {
      this.cancelEditing();
    }
    this.announcement.set(`Deleted ${item.name}.`);
    this.addInput().nativeElement.focus();
  }
}
