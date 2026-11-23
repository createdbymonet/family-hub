import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionDto, ThanksPostDto } from '../../../../shared/contracts';
import { ApiFailure } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { ThanksBoardApi } from './thanks-board.api';
import { ThanksBoardComponent } from './thanks-board.component';
import { ThanksBoardStore } from './thanks-board.store';

const session: SessionDto = {
  user: { id: 'you', displayName: 'You' },
  household: { id: 'home', name: 'Home' },
  csrfToken: 'csrf',
  expiresAt: '2026-12-01T00:00:00.000Z',
  absoluteExpiresAt: '2027-01-01T00:00:00.000Z',
};

function sample(id: string, authorId: string): ThanksPostDto {
  return {
    id,
    authorId,
    message: authorId === 'you' ? 'I made dinner today.' : 'I cleaned the kitchen.',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
    version: 1,
    reactions: [],
  };
}

describe('ThanksBoardComponent', () => {
  let fixture: ComponentFixture<ThanksBoardComponent>;
  let element: HTMLElement;
  let serverPosts: readonly ThanksPostDto[];
  let auth: {
    session: ReturnType<typeof signal<SessionDto | null>>;
    generation: ReturnType<typeof signal<number>>;
  };
  let api: {
    list: ReturnType<typeof vi.fn<ThanksBoardApi['list']>>;
    create: ReturnType<typeof vi.fn<ThanksBoardApi['create']>>;
    update: ReturnType<typeof vi.fn<ThanksBoardApi['update']>>;
    remove: ReturnType<typeof vi.fn<ThanksBoardApi['remove']>>;
    setReaction: ReturnType<typeof vi.fn<ThanksBoardApi['setReaction']>>;
  };

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
    find<HTMLFormElement>('form.composer').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
  }

  async function setup(demo = false): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ThanksBoardComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { demo } } } },
        { provide: AuthService, useValue: auth },
        { provide: ThanksBoardApi, useValue: api },
      ],
    })
      .overrideComponent(ThanksBoardComponent, {
        set: { providers: [ThanksBoardStore, { provide: ThanksBoardApi, useValue: api }] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ThanksBoardComponent);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }

  beforeEach(() => {
    serverPosts = [sample('partner-post', 'partner'), sample('own-post', 'you')];
    auth = { session: signal<SessionDto | null>(session), generation: signal(0) };
    api = {
      list: vi.fn(async () => ({ posts: serverPosts, nextCursor: null })),
      create: vi.fn(async (id, message) => {
        const created = { ...sample(id, 'you'), message };
        serverPosts = [...serverPosts, created];
        return created;
      }),
      update: vi.fn(async (entry, message) => {
        const updated = {
          ...entry,
          message,
          version: entry.version + 1,
          updatedAt: '2026-11-22T01:00:00.000Z',
        };
        serverPosts = serverPosts.map((value) => (value.id === entry.id ? updated : value));
        return updated;
      }),
      remove: vi.fn(async (entry) => {
        serverPosts = serverPosts.filter((value) => value.id !== entry.id);
      }),
      setReaction: vi.fn(async (id, code, present) => {
        const entry = serverPosts.find((value) => value.id === id);
        if (!entry) throw new Error('Unknown post');
        const remaining = entry.reactions.filter(
          (reaction) => !(reaction.code === code && reaction.userId === 'you'),
        );
        const updated = {
          ...entry,
          reactions: present ? [...remaining, { code, userId: 'you' }] : remaining,
        };
        serverPosts = serverPosts.map((value) => (value.id === id ? updated : value));
        return updated;
      }),
    };
    vi.restoreAllMocks();
  });

  it('posts from the composer, clears successful input, and displays real author identity and ISO dates', async () => {
    await setup();
    await submitMessage('  I watered the plants!  ');
    expect(api.create).toHaveBeenCalledWith(expect.any(String), 'I watered the plants!');
    expect(find<HTMLTextAreaElement>('#thanks-message').value).toBe('');
    const posts = element.querySelectorAll('.post');
    expect(posts[posts.length - 1]?.classList.contains('post--mine')).toBe(true);
    expect(posts[posts.length - 1]?.textContent).toContain('I watered the plants!');
    expect(find('.post:not(.post--mine) .author').textContent).toBe('Partner');
    expect(find('time').getAttribute('datetime')).toBe('2026-11-22T00:00:00.000Z');
    expect(find('time').textContent).toContain('2026');
  });

  it('rejects empty posts and explains the validation error', async () => {
    await setup();
    await submitMessage('  \n ');
    expect(api.create).not.toHaveBeenCalled();
    expect(find('#composer-error').textContent).toContain('Write an update');
    expect(find('#thanks-message').getAttribute('aria-invalid')).toBe('true');
  });

  it('sends with Enter and preserves Shift+Enter and IME composition', async () => {
    await setup();
    const input = typeMessage('I took the dog for a walk.');
    const newline = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(newline);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await fixture.whenStable();
    expect(newline.defaultPrevented).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it('opens accessible reaction choices and sends explicit add/remove requests', async () => {
    await setup();
    const toggle = find<HTMLButtonElement>('#reaction-toggle-partner-post');
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const options = [...element.querySelectorAll('.reaction-options button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(options).toEqual(['Thanks a lot!', 'Thank you!', 'Awesome!', '❤️', '👏']);
    expect(find('.reaction-options [aria-label="React: Clap"]').textContent).toContain('👏');
    find<HTMLButtonElement>('.reaction-options [aria-label="React: Heart"]').click();
    await fixture.whenStable();
    expect(api.setReaction).toHaveBeenLastCalledWith('partner-post', 'heart', true);
    const chip = find<HTMLButtonElement>('.post .reaction-chip[aria-label^="Heart"]');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    chip.click();
    await fixture.whenStable();
    expect(api.setReaction).toHaveBeenLastCalledWith('partner-post', 'heart', false);
    expect(element.querySelector('.post .reaction-chip[aria-label^="Heart"]')).toBeNull();
  });

  it('only displays author management controls on own posts and supports editing', async () => {
    await setup();
    expect(element.querySelector('.post:not(.post--mine) .post-actions')).toBeNull();
    expect(element.querySelectorAll('[aria-label="Manage your update"]')).toHaveLength(1);
    find<HTMLButtonElement>('.post--mine .post-action').click();
    await fixture.whenStable();
    const input = find<HTMLTextAreaElement>('.post-editor textarea');
    input.value = '  I cooked pasta.  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    find<HTMLFormElement>('.post-editor').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'own-post', version: 1 }),
      'I cooked pasta.',
    );
    expect(element.querySelector('.post-editor')).toBeNull();
    expect(find('.post--mine .bubble').textContent).toBe('I cooked pasta.');
  });

  it('confirms deletion, preserves cancelled posts, and removes only after success', async () => {
    await setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    find<HTMLButtonElement>('.post--mine .post-action:last-child').click();
    await fixture.whenStable();
    expect(api.remove).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    find<HTMLButtonElement>('.post--mine .post-action:last-child').click();
    await fixture.whenStable();
    expect(api.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'own-post', version: 1 }),
    );
    expect(element.querySelector('.post--mine')).toBeNull();
  });

  it('keeps drafts on create/update failure and shows version conflicts', async () => {
    await setup();
    api.create.mockRejectedValueOnce(new ApiFailure(0, 'offline', 'Offline'));
    await submitMessage('Keep my draft');
    expect(find<HTMLTextAreaElement>('#thanks-message').value).toBe('Keep my draft');
    expect(find('.board-error').textContent).toContain('Could not save');
    find<HTMLButtonElement>('.post--mine .post-action').click();
    await fixture.whenStable();
    const input = find<HTMLTextAreaElement>('.post-editor textarea');
    input.value = 'Keep my edit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    api.update.mockRejectedValueOnce(new ApiFailure(409, 'conflict', 'Conflict'));
    find<HTMLFormElement>('.post-editor').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(find<HTMLTextAreaElement>('.post-editor textarea').value).toBe('Keep my edit');
    expect(find('.board-error').textContent).toContain('changed on another device');
  });

  it('renders fictional demo data without forms, write controls, or API calls even on restore', async () => {
    auth.session.set(null);
    await setup(true);
    expect(element.querySelectorAll('.post')).toHaveLength(3);
    expect(find('.mode-note').textContent).toContain('Read only');
    expect(element.querySelector('form')).toBeNull();
    expect(
      element.querySelector('.post-action, .react-toggle, button.reaction-chip, .reaction-options'),
    ).toBeNull();
    expect(element.querySelectorAll('span.reaction-chip').length).toBeGreaterThan(0);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await fixture.whenStable();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.setReaction).not.toHaveBeenCalled();
  });

  it('loads older posts through the pagination control', async () => {
    api.list.mockResolvedValueOnce({ posts: [sample('latest', 'you')], nextCursor: 'cursor' });
    await setup();
    api.list.mockResolvedValueOnce({ posts: [sample('older', 'partner')], nextCursor: null });
    find<HTMLButtonElement>('.load-earlier').click();
    await fixture.whenStable();
    expect(api.list).toHaveBeenLastCalledWith(true, 'cursor');
    expect(element.querySelectorAll('.post')).toHaveLength(2);
    expect(element.querySelector('.load-earlier')).toBeNull();
  });

  it('clears private posts and local drafts after session invalidation', async () => {
    await setup();
    typeMessage('Private unsent text');
    auth.generation.update((value) => value + 1);
    auth.session.set(null);
    await fixture.whenStable();
    expect(element.querySelectorAll('.post')).toHaveLength(0);
    expect(element.querySelector('.composer')).toBeNull();
    expect(element.textContent).not.toContain('I made dinner today.');
  });

  it('retains an edit draft if another device removed the post before saving', async () => {
    await setup();
    find<HTMLButtonElement>('.post--mine .post-action').click();
    await fixture.whenStable();
    const input = find<HTMLTextAreaElement>('.post-editor textarea');
    input.value = 'My retained draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    serverPosts = serverPosts.filter((post) => post.id !== 'own-post');
    api.update.mockRejectedValueOnce(new ApiFailure(404, 'not_found', 'Not found'));
    find<HTMLFormElement>('.post-editor').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(find<HTMLTextAreaElement>('.post-editor textarea').value).toBe('My retained draft');
    expect(find('.post-editor').textContent).toContain('removed on another device');
    expect(find<HTMLButtonElement>('.post-editor button[type="submit"]').disabled).toBe(true);
  });

  it('prevents duplicate submissions while keeping the pending draft visible', async () => {
    await setup();
    let finish!: (post: ThanksPostDto) => void;
    api.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    typeMessage('Save this once');
    const form = find<HTMLFormElement>('.composer');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(find<HTMLTextAreaElement>('#thanks-message').readOnly).toBe(true);
    expect(find<HTMLTextAreaElement>('#thanks-message').value).toBe('Save this once');
    expect(find<HTMLButtonElement>('.composer button[type="submit"]').disabled).toBe(true);
    const created = { ...sample('new', 'you'), message: 'Save this once' };
    serverPosts = [...serverPosts, created];
    finish(created);
    await vi.waitFor(() => expect(find<HTMLTextAreaElement>('#thanks-message').value).toBe(''));
    await fixture.whenStable();
  });

  it('does not refresh private data when a write completes after leaving for the demo', async () => {
    await setup();
    let finish!: (post: ThanksPostDto) => void;
    api.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const familyStore = fixture.debugElement.injector.get(ThanksBoardStore);
    const saving = familyStore.addPost('Pending family update');
    fixture.destroy();
    TestBed.inject(ActivatedRoute).snapshot.data['demo'] = true;
    fixture = TestBed.createComponent(ThanksBoardComponent);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    expect(fixture.debugElement.injector.get(ThanksBoardStore)).not.toBe(familyStore);
    finish(sample('late-private', 'you'));
    expect(await saving).toBe(false);
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(familyStore.posts()).toEqual([]);
    expect(find('.mode-note').textContent).toContain('Read only');
    expect(element.textContent).not.toContain('Pending family update');
  });
});
