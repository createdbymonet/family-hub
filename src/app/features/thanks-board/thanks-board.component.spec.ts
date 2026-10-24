import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThanksBoardComponent } from './thanks-board.component';
import { ThanksBoardStore } from './thanks-board.store';

describe('ThanksBoardComponent', () => {
  let fixture: ComponentFixture<ThanksBoardComponent>;
  let element: HTMLElement;
  let store: ThanksBoardStore;

  function find<T extends HTMLElement>(selector: string): T {
    const found = element.querySelector<T>(selector);
    if (!found) throw new Error(`Expected to find ${selector}.`);
    return found;
  }

  function typeMessage(message: string): HTMLTextAreaElement {
    const input = find<HTMLTextAreaElement>('#thanks-message');
    input.value = message;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  }

  async function submitMessage(message: string): Promise<void> {
    typeMessage(message);
    find<HTMLFormElement>('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ThanksBoardComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ThanksBoardComponent);
    element = fixture.nativeElement as HTMLElement;
    store = TestBed.inject(ThanksBoardStore);
    await fixture.whenStable();
  });

  it('posts from the composer, clears the input, and presents the new message as mine', async () => {
    await submitMessage('  I watered the plants!  ');

    expect(store.posts().at(-1)?.message).toBe('I watered the plants!');
    expect(find<HTMLTextAreaElement>('#thanks-message').value).toBe('');
    const posts = element.querySelectorAll('.post');
    expect(posts[posts.length - 1]?.classList.contains('post--mine')).toBe(true);
    expect(posts[posts.length - 1]?.textContent).toContain('I watered the plants!');
    expect(element.querySelectorAll('.post:not(.post--mine)').length).toBeGreaterThan(0);
  });

  it('rejects empty posts and explains the validation error', async () => {
    const originalCount = store.posts().length;
    await submitMessage('  \n ');

    expect(store.posts()).toHaveLength(originalCount);
    expect(find('#composer-error').textContent).toContain('Write a little update');
    expect(find('#thanks-message').getAttribute('aria-invalid')).toBe('true');
  });

  it('sends with Enter and preserves Shift+Enter for writing multiple lines', async () => {
    const initialCount = store.posts().length;
    const input = typeMessage('I took the dog for a walk.');
    const newlineEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(newlineEvent);
    await fixture.whenStable();
    expect(newlineEvent.defaultPrevented).toBe(false);
    expect(store.posts()).toHaveLength(initialCount);

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    await fixture.whenStable();
    expect(store.posts()).toHaveLength(initialCount + 1);
  });

  it('opens accessible reaction choices and toggles a reaction on the message', async () => {
    const firstPost = store.posts()[0];
    if (!firstPost) throw new Error('Expected a sample conversation.');
    const toggle = find<HTMLButtonElement>(`#reaction-toggle-${firstPost.id}`);
    toggle.click();
    await fixture.whenStable();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const button = find<HTMLButtonElement>('.reaction-options [aria-label="React: ❤️"]');
    button.click();
    await fixture.whenStable();

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(find('.post .reaction-chip[aria-label^="❤️"]').textContent).toContain('❤️');

    button.click();
    await fixture.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(element.querySelector('.post .reaction-chip[aria-label^="❤️"]')).toBeNull();
  });

  it('does not send when Enter confirms an input-method composition', async () => {
    const initialCount = store.posts().length;
    const input = typeMessage('ありがとう');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await fixture.whenStable();

    expect(store.posts()).toHaveLength(initialCount);
    expect(input.value).toBe('ありがとう');
  });
});
