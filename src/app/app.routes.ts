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
    path: 'wishlist',
    canActivate: [authGuard],
    title: 'Wishlist | Family Hub',
    loadComponent: () =>
      import('./features/wishlist/wishlist.component').then(
        (component) => component.WishlistComponent,
      ),
  },
  {
    path: 'notes',
    canActivate: [authGuard],
    title: 'Notes | Family Hub',
    loadComponent: () =>
      import('./features/notes/notes.component').then((component) => component.NotesComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    title: 'Settings | Family Hub',
    loadComponent: () =>
      import('./features/settings/settings.component').then(
        (component) => component.SettingsComponent,
      ),
  },
  {
    path: 'demo/wishlist',
    data: { demo: true },
    title: 'Wishlist Demo | Family Hub',
    loadComponent: () =>
      import('./features/wishlist/wishlist.component').then(
        (component) => component.WishlistComponent,
      ),
  },
  {
    path: 'demo/notes',
    data: { demo: true },
    title: 'Notes Demo | Family Hub',
    loadComponent: () =>
      import('./features/notes/notes.component').then((component) => component.NotesComponent),
  },
  {
    path: 'demo/settings',
    data: { demo: true },
    title: 'Settings Demo | Family Hub',
    loadComponent: () =>
      import('./features/settings/settings.component').then(
        (component) => component.SettingsComponent,
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
