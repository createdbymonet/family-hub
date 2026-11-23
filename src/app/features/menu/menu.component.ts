import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { RouterLink } from '@angular/router';

import { IconComponent } from '../../shared/components/icon.component';

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuComponent {
  protected readonly auth = inject(AuthService);
  protected readonly tools = [
    {
      path: 'shopping-list',
      title: 'Shopping List',
      description: 'Keep groceries and household items in sync.',
      icon: 'basket',
      accent: false,
    },
    {
      path: 'thanks-board',
      title: 'Thanks Board',
      description: 'Celebrate the little things you do for each other.',
      icon: 'heart',
      accent: true,
    },
    {
      path: 'wishlist',
      title: 'Wishlist',
      description: 'A place for the things you hope to make happen.',
      icon: 'sparkles',
      accent: false,
    },
    {
      path: 'notes',
      title: 'Notes',
      description: 'Leave a thought, a plan, or something to remember.',
      icon: 'edit',
      accent: true,
    },
  ] as const;
}
