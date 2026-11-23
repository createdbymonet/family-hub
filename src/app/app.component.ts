import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { IconComponent } from './shared/components/icon.component';
import { AuthService } from './core/auth.service';

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
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly isDemo = computed(() => this.url().startsWith('/demo/'));
  protected readonly isFamily = computed(() =>
    /^\/(shopping-list|thanks-board)(?:[?#]|$)/.test(this.url()),
  );

  constructor() {
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
