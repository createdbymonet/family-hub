import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { IconComponent } from './shared/components/icon.component';
import { AuthService } from './core/auth.service';
import { SettingsService } from './core/settings.service';
import { onFeatureRefresh } from './core/feature-refresh';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterOutlet, IconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly preferences = inject(SettingsService);
  private readonly location = inject(DOCUMENT).location;
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.location.pathname + this.location.search + this.location.hash },
  );
  protected readonly isDemo = computed(() => this.url().startsWith('/demo/'));
  protected readonly isFamily = computed(() =>
    /^\/(shopping-list|thanks-board|wishlist|notes|settings)(?:[?#]|$)/.test(this.url()),
  );

  constructor() {
    effect(() => {
      const demo = this.isDemo();
      const url = this.url();
      const session = this.auth.session();
      untracked(() => {
        this.preferences.setDemoMode(demo);
        if (!demo && session && !url.startsWith('/login')) void this.preferences.load();
        else if (!demo && url === '/' && this.auth.status() === 'unknown')
          void this.auth.ensureSession();
      });
    });
    onFeatureRefresh(() => {
      if (!this.isDemo() && this.auth.session()) void this.preferences.load();
    });
    effect(() => {
      if (this.auth.generation() > 0 && this.isFamily() && !this.auth.session()) {
        void this.router.navigate(['/login'], { queryParams: { reason: 'session-ended' } });
      }
    });
  }

  protected async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } catch {
      // AuthService retains a safe, retryable error; private data is already cleared.
    }
    await this.router.navigate(['/login']);
  }
}
