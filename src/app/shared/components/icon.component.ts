import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'home'
  | 'arrow-left'
  | 'arrow-right'
  | 'basket'
  | 'heart'
  | 'sparkles'
  | 'plus'
  | 'edit'
  | 'trash'
  | 'check'
  | 'close'
  | 'send'
  | 'smile';

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host {
      display: inline-flex;
      width: 1.25em;
      height: 1.25em;
      flex-shrink: 0;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
    >
      @switch (name()) {
        @case ('home') {
          <path d="m3 11 9-8 9 8M5 10v11h14V10" />
          <path d="M12 17s-4-2.5-4-4.5a2.2 2.2 0 0 1 4-1 2.2 2.2 0 0 1 4 1c0 2-4 4.5-4 4.5Z" />
        }
        @case ('arrow-left') {
          <path d="m12 5-7 7 7 7M5 12h15" />
        }
        @case ('arrow-right') {
          <path d="m12 5 7 7-7 7M19 12H4" />
        }
        @case ('basket') {
          <path d="m3 9 2 11h14l2-11H3Zm4 0 3-6m7 6-3-6M9 13v3m6-3v3" />
        }
        @case ('heart') {
          <path d="M12 21S3 15.5 3 9.5a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 11.5-9 11.5Z" />
        }
        @case ('sparkles') {
          <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('edit') {
          <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7Z" />
        }
        @case ('trash') {
          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
        }
        @case ('check') {
          <path d="m5 12 4 4L19 6" />
        }
        @case ('close') {
          <path d="m6 6 12 12M6 18 18 6" />
        }
        @case ('send') {
          <path d="m21 3-7 18-4-8-8-4L21 3Zm-11 10L21 3" />
        }
        @case ('smile') {
          <circle cx="12" cy="12" r="9" />
          <path d="M8 14s1 3 4 3 4-3 4-3M8 9h.01M16 9h.01" />
        }
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
