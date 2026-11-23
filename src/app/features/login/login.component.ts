import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { PageHeaderComponent } from '../../shared/components/page-header.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Your family space" subtitle="A private place for the two of you." />
    <section class="login-card" aria-label="Family sign in">
      @if (hasAuthError) {
        <p role="alert">
          Sign-in was not completed. Please use a registered Google account and try again.
        </p>
      }
      @if (sessionExpired) {
        <p role="status">Your session ended or changed. Sign in again to open your family space.</p>
      }
      <p>
        Only the two registered family members can sign in. Public registration is not available.
      </p>
      <a
        class="button button--primary"
        [href]="loginUrl"
        (click)="startLogin($event)"
        [attr.aria-disabled]="auth.loggingOut() || auth.needsLogoutRetry()"
      >
        Continue with Google
      </a>
      <button
        class="button button--quiet"
        type="button"
        (click)="resume()"
        [disabled]="auth.status() === 'loading' || auth.loggingOut() || auth.needsLogoutRetry()"
      >
        {{ auth.status() === 'loading' ? 'Checking…' : 'Check existing session' }}
      </button>
      @if (auth.error()) {
        <p class="form-error" role="alert">{{ auth.error() }}</p>
      }
      @if (auth.needsLogoutRetry()) {
        <button
          class="button button--quiet"
          type="button"
          [disabled]="auth.loggingOut()"
          (click)="retryLogout()"
        >
          Retry sign out
        </button>
      }
      <p class="demo-link">Just looking around? <a routerLink="/">Explore the public demos</a>.</p>
    </section>
  `,
  styles: `
    .login-card {
      padding: 24px;
      border: 1px solid var(--color-border);
      border-radius: 20px;
      background: var(--color-surface);
      line-height: 1.6;
    }
    .login-card p {
      margin: 0 0 20px;
    }
    .demo-link {
      margin-top: 24px !important;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
  `,
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly loginUrl = '/api/auth/google/start';
  protected readonly hasAuthError = this.route.snapshot.queryParamMap.has('error');
  protected readonly sessionExpired = this.route.snapshot.queryParamMap.has('reason');

  protected async resume(): Promise<void> {
    if (await this.auth.refreshSession()) await this.router.navigateByUrl('/');
  }

  protected startLogin(event: Event): void {
    if (!this.auth.prepareLogin()) event.preventDefault();
  }

  protected async retryLogout(): Promise<void> {
    try {
      await this.auth.logout();
    } catch {
      /* Keep the retry message visible. */
    }
  }
}
