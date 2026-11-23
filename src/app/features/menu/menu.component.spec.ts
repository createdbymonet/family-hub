import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { MenuComponent } from './menu.component';

describe('MenuComponent', () => {
  it('shows four compact feature cards with family and demo links and removes the old sections', async () => {
    TestBed.configureTestingModule({
      imports: [MenuComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: { session: signal(null) } }],
    });
    const fixture = TestBed.createComponent(MenuComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Shopping List',
      'Thanks Board',
      'Wishlist',
      'Notes',
    ]);
    for (const path of ['shopping-list', 'thanks-board', 'wishlist', 'notes']) {
      expect(host.querySelector(`a.card-main[href="/${path}"]`)).not.toBeNull();
      expect(host.querySelector(`a[href="/demo/${path}"]`)).not.toBeNull();
    }
    for (const removed of [
      'Your everyday, together',
      'Small things.',
      'Your family space',
      'You make a good team.',
    ]) {
      expect(host.textContent).not.toContain(removed);
    }
    expect(host.querySelector('.menu-intro, .family-links, .together-note')).toBeNull();
  });
});
