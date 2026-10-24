import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { IconComponent } from '../../shared/components/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { ThanksBoardStore } from './thanks-board.store';
import { THANKS_REACTIONS, ThanksPost, ThanksReactionLabel } from './thanks-post.model';

@Component({
  selector: 'app-thanks-board',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, IconComponent, PageHeaderComponent],
  templateUrl: './thanks-board.component.html',
  styleUrl: './thanks-board.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThanksBoardComponent {
  protected readonly store = inject(ThanksBoardStore);
  protected readonly reactionLabels = THANKS_REACTIONS;
  protected readonly openReactionPostId = signal<string | null>(null);
  protected readonly announcement = signal('');
  protected readonly error = signal('');
  protected readonly composer = new FormGroup({
    message: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  private readonly injector = inject(Injector);
  private readonly messageInput = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');
  private readonly postList = viewChild<ElementRef<HTMLOListElement>>('postList');

  protected send(): void {
    const post = this.store.addPost(this.composer.controls.message.value);

    if (!post) {
      this.error.set('Write a little update before sending.');
      this.composer.controls.message.markAsTouched();
      this.messageInput()?.nativeElement.focus();
      return;
    }

    this.composer.reset();
    this.error.set('');
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
      this.send();
    }
  }

  protected toggleReactionOptions(postId: string): void {
    this.openReactionPostId.update((current) => (current === postId ? null : postId));
  }

  protected react(post: ThanksPost, label: ThanksReactionLabel): void {
    const removingReaction = this.hasReacted(post, label);
    this.store.toggleReaction(post.id, label);
    this.announcement.set(`${label} reaction ${removingReaction ? 'removed' : 'added'}.`);
  }

  protected hasReacted(post: ThanksPost, label: ThanksReactionLabel): boolean {
    return post.reactions.some((reaction) => reaction.label === label && reaction.author === 'me');
  }

  protected reactionCount(post: ThanksPost, label: ThanksReactionLabel): number {
    return post.reactions.filter((reaction) => reaction.label === label).length;
  }
}
