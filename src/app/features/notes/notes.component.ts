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

import { LIMITS, type NoteDto } from '../../../../shared/contracts';
import { AuthService } from '../../core/auth.service';
import { onFeatureRefresh } from '../../core/feature-refresh';
import { SettingsService } from '../../core/settings.service';
import { IconComponent } from '../../shared/components/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { NotesApi } from './notes.api';
import { NotesStore } from './notes.store';

@Component({
  selector: 'app-notes',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, RouterLink, IconComponent, PageHeaderComponent],
  providers: [NotesApi, NotesStore],
  templateUrl: './notes.component.html',
  styleUrl: './notes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesComponent {
  protected readonly store = inject(NotesStore);
  protected readonly isDemo = inject(ActivatedRoute).snapshot.data['demo'] === true;
  protected readonly preferences = inject(SettingsService);
  protected readonly limits = LIMITS;
  protected readonly addForm = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    body: new FormControl('', { nonNullable: true }),
  });
  protected readonly editForm = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    body: new FormControl('', { nonNullable: true }),
  });
  protected readonly editing = signal<NoteDto | null>(null);
  protected readonly expandedId = signal<string | null>(null);
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
    return items
      .filter(
        (item) =>
          item.id === editing?.id ||
          item.status === 'open' ||
          this.preferences.settings().showResolvedNotes,
      )
      .sort(
        (a, b) =>
          Number(a.status === 'resolved') - Number(b.status === 'resolved') ||
          b.updatedAt.localeCompare(a.updatedAt) ||
          a.id.localeCompare(b.id),
      );
  });
  protected readonly openCount = computed(
    () => this.store.items().filter((item) => item.status === 'open').length,
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
        this.expandedId.set(null);
        this.announcement.set('');
      }
    });
    afterRenderEffect(() => this.editInput()?.nativeElement.focus());
  }

  protected async add(): Promise<void> {
    if (this.blocked()) return;
    const input = this.addForm.getRawValue();
    const title = input.title.trim();
    const body = input.body.trim();
    this.addError.set(!this.valid(title, body));
    if (this.addError()) {
      this.addInput()?.nativeElement.focus();
      return;
    }
    const generation = this.auth.generation();
    const item = await this.store.create({ title, body });
    if (!item || !this.active(generation)) return;
    this.addForm.reset();
    this.announcement.set(`Added ${item.title}.`);
    this.addInput()?.nativeElement.focus();
  }

  protected startEditing(item: NoteDto): void {
    if (this.blocked()) return;
    this.editForm.setValue({ title: item.title, body: item.body });
    this.editError.set(false);
    this.editing.set(item);
  }

  protected async save(): Promise<void> {
    const item = this.editing();
    if (this.blocked() || !item || this.editingMissing()) return;
    const input = this.editForm.getRawValue();
    const title = input.title.trim();
    const body = input.body.trim();
    this.editError.set(!this.valid(title, body));
    if (this.editError()) {
      this.editInput()?.nativeElement.focus();
      return;
    }
    const generation = this.auth.generation();
    const saved = await this.store.update(item, { title, body });
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

  protected async toggle(item: NoteDto): Promise<void> {
    if (this.blocked()) return;
    const status = item.status === 'open' ? 'resolved' : 'open';
    const generation = this.auth.generation();
    if ((await this.store.update(item, { status })) && this.active(generation)) {
      this.announcement.set(`${item.title} ${status === 'resolved' ? 'resolved.' : 'reopened.'}`);
      this.addInput()?.nativeElement.focus();
    }
  }

  protected async remove(item: NoteDto): Promise<void> {
    if (this.blocked() || !window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    const generation = this.auth.generation();
    if ((await this.store.remove(item)) && this.active(generation)) {
      if (this.editing()?.id === item.id) this.cancelEditing();
      this.announcement.set(`Deleted ${item.title}.`);
      this.addInput()?.nativeElement.focus();
    }
  }

  protected toggleDetail(item: NoteDto): void {
    this.expandedId.update((id) => (id === item.id ? null : item.id));
  }

  protected preview(body: string): string {
    return body.length > 160 ? `${body.slice(0, 160)}…` : body;
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

  private valid(title: string, body: string): boolean {
    return (
      title.length > 0 &&
      title.length <= LIMITS.noteTitle &&
      body.length > 0 &&
      body.length <= LIMITS.noteBody
    );
  }

  private active(generation: number): boolean {
    return this.alive && this.auth.generation() === generation && this.auth.session() !== null;
  }
}
