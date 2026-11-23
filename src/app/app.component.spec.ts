import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { AuthService } from './core/auth.service';

describe('Public demo bootstrap', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it.each(['shopping-list', 'thanks-board', 'wishlist', 'notes', 'settings'])(
    'opens /demo/%s directly without session or private API requests',
    async (feature) => {
      window.history.replaceState(null, '', `/demo/${feature}`);
      TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
      });
      const auth = TestBed.inject(AuthService);
      const ensure = vi.spyOn(auth, 'ensureSession');
      const fixture = TestBed.createComponent(AppComponent);
      fixture.detectChanges();
      expect(ensure).not.toHaveBeenCalled();
      await TestBed.inject(Router).navigateByUrl(`/demo/${feature}`);
      await fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe(`/demo/${feature}`);
      expect(fixture.nativeElement.textContent).toContain('Demo Mode');
      window.dispatchEvent(new Event('focus'));
      await fixture.whenStable();
      expect(ensure).not.toHaveBeenCalled();
      TestBed.inject(HttpTestingController).expectNone(() => true);
      TestBed.inject(HttpTestingController).verify();
    },
  );
});
