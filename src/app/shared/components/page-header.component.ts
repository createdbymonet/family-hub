import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <a routerLink="/" class="back-link"><app-icon name="arrow-left" /> Menu</a>
      <h1>{{ title() }}</h1>
      @if (subtitle()) {
        <p>{{ subtitle() }}</p>
      }
    </header>
  `,
  styles: `
    .page-header {
      margin-bottom: 1.75rem;
    }
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 44px;
      color: var(--color-primary);
      font-size: 0.875rem;
      font-weight: 650;
      text-decoration: none;
      margin-bottom: 0.75rem;
      border-radius: 0.5rem;
    }
    .back-link:hover {
      text-decoration: underline;
      text-underline-offset: 4px;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.75rem, 5vw, 2.2rem);
      line-height: 1.2;
      letter-spacing: -0.045em;
    }
    p {
      margin: 0.6rem 0 0;
      color: var(--color-text-muted);
      font-size: 0.9375rem;
    }
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
}
