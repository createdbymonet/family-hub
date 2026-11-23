import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { DEMO_THANKS_POSTS, DEMO_USER_ID } from '../../core/demo-data';
import { onFeatureRefresh } from '../../core/feature-refresh';
import { IconComponent } from '../../shared/components/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { ThanksBoardApi } from './thanks-board.api';
import { ThanksBoardStore } from './thanks-board.store';
import { LIMITS, REACTION_OPTIONS, ReactionCode, ThanksPost } from './thanks-post.model';

@Component({
  selector: 'app-thanks-board',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, IconComponent, PageHeaderComponent],
  providers: [ThanksBoardApi, ThanksBoardStore],
  templateUrl: './thanks-board.component.html',
  styleUrl: './thanks-board.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThanksBoardComponent {
  protected readonly store = inject(ThanksBoardStore);
  private readonly auth = inject(AuthService);
  protected readonly demo = inject(ActivatedRoute).snapshot.data['demo'] === true;
  protected readonly posts = computed(() => {
    if (this.demo) return DEMO_THANKS_POSTS;
    const posts = this.store.posts();
    const editing = this.editingPost();
    // A concurrently removed post must not take its unsaved draft off screen.
    return editing &&
      this.canWrite() &&
      this.editingGeneration() === this.auth.generation() &&
      !posts.some((post) => post.id === editing.id)
      ? [...posts, editing]
      : posts;
  });
  protected readonly canWrite = computed(() => !this.demo && this.auth.session() !== null);
  protected readonly reactionOptions = REACTION_OPTIONS;
  protected readonly messageLimit = LIMITS.thanksMessage;
  protected readonly openReactionPostId = signal<string | null>(null);
  protected readonly editingPost = signal<ThanksPost | null>(null);
  protected readonly announcement = signal('');
  protected readonly error = signal('');
  protected readonly editError = signal('');
  protected readonly composer = new FormGroup({
    message: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(LIMITS.thanksMessage)],
    }),
  });
  protected readonly editor = new FormGroup({
    message: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(LIMITS.thanksMessage)],
    }),
  });

  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly messageInput = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');
  private readonly editInput = viewChild<ElementRef<HTMLTextAreaElement>>('editInput');
  private readonly postList = viewChild<ElementRef<HTMLOListElement>>('postList');
  private observedGeneration = this.auth.generation();
  private readonly editingGeneration = signal<number | null>(null);

  constructor() {
    onFeatureRefresh((activity) => {
      if (!this.demo) void this.store.load(activity);
    });
    effect(() => {
      const generation = this.auth.generation();
      if (generation !== this.observedGeneration || (!this.demo && !this.auth.session())) {
        this.observedGeneration = generation;
        this.composer.reset();
        this.editor.reset();
        this.editingPost.set(null);
        this.editingGeneration.set(null);
        this.openReactionPostId.set(null);
        this.error.set('');
        this.editError.set('');
        this.announcement.set('');
      }
    });
  }

  protected async send(): Promise<void> {
    if (!this.canWrite() || this.store.creating()) return;
    const message = this.composer.controls.message.value;
    if (!this.validMessage(message)) {
      this.error.set(`Write an update between 1 and ${this.messageLimit} characters.`);
      this.composer.controls.message.markAsTouched();
      this.messageInput()?.nativeElement.focus();
      return;
    }
    this.error.set('');
    const saved = await this.store.addPost(message);
    if (!saved || this.destroyRef.destroyed) return;
    this.composer.reset();
    this.openReactionPostId.set(null);
    this.announcement.set('Your update has been posted.');
    this.messageInput()?.nativeElement.focus();
    afterNextRender(
      () => {
        const newestPost = this.postList()?.nativeElement.lastElementChild;
        newestPost?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      },
      { injector: this.injector },
    );
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  protected isMine(post: ThanksPost): boolean {
    return post.authorId === (this.demo ? DEMO_USER_ID : this.auth.session()?.user.id);
  }

  protected startEditing(post: ThanksPost): void {
    if (!this.canWrite() || !this.isMine(post) || this.isPending(post)) return;
    this.editingPost.set(post);
    this.editingGeneration.set(this.auth.generation());
    this.editor.controls.message.setValue(post.message);
    this.editError.set('');
    afterNextRender(() => this.editInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancelEditing(): void {
    const post = this.editingPost();
    if (post && this.isPending(post)) return;
    this.editingPost.set(null);
    this.editingGeneration.set(null);
    this.editor.reset();
    this.editError.set('');
  }

  protected async saveEdit(): Promise<void> {
    const post = this.editingPost();
    if (
      !post ||
      !this.canWrite() ||
      !this.isMine(post) ||
      this.isPending(post) ||
      this.isMissing(post)
    )
      return;
    if (this.store.posts().find((entry) => entry.id === post.id)?.version !== post.version) return;
    const message = this.editor.controls.message.value;
    if (!this.validMessage(message)) {
      this.editError.set(`Write an update between 1 and ${this.messageLimit} characters.`);
      this.editInput()?.nativeElement.focus();
      return;
    }
    this.editError.set('');
    if ((await this.store.updatePost(post, message)) && !this.destroyRef.destroyed) {
      this.editingPost.set(null);
      this.editingGeneration.set(null);
      this.editor.reset();
      this.announcement.set('Your update has been saved.');
    }
  }

  protected async remove(post: ThanksPost): Promise<void> {
    if (!this.canWrite() || !this.isMine(post) || this.isPending(post)) return;
    if (!window.confirm('Delete this update? This cannot be undone.')) return;
    if ((await this.store.deletePost(post)) && !this.destroyRef.destroyed) {
      if (this.editingPost()?.id === post.id) this.editingPost.set(null);
      this.announcement.set('Your update has been deleted.');
    }
  }

  protected toggleReactionOptions(postId: string): void {
    if (!this.canWrite()) return;
    this.openReactionPostId.update((current) => (current === postId ? null : postId));
  }

  protected async react(post: ThanksPost, code: ReactionCode): Promise<void> {
    if (!this.canWrite() || this.isPending(post) || this.isMissing(post)) return;
    const removing = this.hasReacted(post, code);
    if ((await this.store.setReaction(post, code, !removing)) && !this.destroyRef.destroyed) {
      const label =
        this.reactionOptions.find((option) => option.code === code)?.accessibleLabel ?? code;
      this.announcement.set(`${label} reaction ${removing ? 'removed' : 'added'}.`);
    }
  }

  protected hasReacted(post: ThanksPost, code: ReactionCode): boolean {
    const userId = this.demo ? DEMO_USER_ID : this.auth.session()?.user.id;
    return post.reactions.some((reaction) => reaction.code === code && reaction.userId === userId);
  }

  protected reactionCount(post: ThanksPost, code: ReactionCode): number {
    return post.reactions.filter((reaction) => reaction.code === code).length;
  }

  protected isPending(post: ThanksPost): boolean {
    return this.store.isPending(`post:${post.id}`);
  }

  protected isMissing(post: ThanksPost): boolean {
    return !this.demo && !this.store.posts().some((entry) => entry.id === post.id);
  }

  private validMessage(message: string): boolean {
    return message.trim().length > 0 && message.trim().length <= this.messageLimit;
  }
}
