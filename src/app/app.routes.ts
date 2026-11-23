import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

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
    canActivate: [authGuard],
    title: 'Shopping List | Family Hub',
    loadComponent: () =>
      import('./features/shopping-list/shopping-list.component').then(
        (component) => component.ShoppingListComponent,
      ),
  },
  {
    path: 'thanks-board',
    canActivate: [authGuard],
    title: 'Thanks Board | Family Hub',
    loadComponent: () =>
      import('./features/thanks-board/thanks-board.component').then(
        (component) => component.ThanksBoardComponent,
      ),
  },
  {
    path: 'demo/shopping-list',
    title: 'Shopping List Demo | Family Hub',
    data: { demo: true },
    loadComponent: () =>
      import('./features/shopping-list/shopping-list.component').then(
        (component) => component.ShoppingListComponent,
      ),
  },
  {
    path: 'demo/thanks-board',
    title: 'Thanks Board Demo | Family Hub',
    data: { demo: true },
    loadComponent: () =>
      import('./features/thanks-board/thanks-board.component').then(
        (component) => component.ThanksBoardComponent,
      ),
  },
  {
    path: 'login',
    title: 'Sign in | Family Hub',
    loadComponent: () =>
      import('./features/login/login.component').then((component) => component.LoginComponent),
  },
  { path: 'dashboard', pathMatch: 'full', redirectTo: '' },
  { path: 'schedule', pathMatch: 'full', redirectTo: '' },
  { path: '**', redirectTo: '' },
];
