import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Family Hub | Menu',
    loadComponent: () =>
      import('./features/menu/menu.component').then((component) => component.MenuComponent),
  },
  {
    path: 'shopping-list',
    title: 'Shopping List | Family Hub',
    loadComponent: () =>
      import('./features/shopping-list/shopping-list.component').then(
        (component) => component.ShoppingListComponent,
      ),
  },
  {
    path: 'thanks-board',
    title: 'Thanks Board | Family Hub',
    loadComponent: () =>
      import('./features/thanks-board/thanks-board.component').then(
        (component) => component.ThanksBoardComponent,
      ),
  },
  { path: 'dashboard', pathMatch: 'full', redirectTo: '' },
  { path: 'schedule', pathMatch: 'full', redirectTo: '' },
  { path: '**', redirectTo: '' },
];
