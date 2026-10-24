import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Family Hub | Coming Soon',
    loadComponent: () =>
      import('./features/coming-soon/coming-soon.component').then(
        (component) => component.ComingSoonComponent,
      ),
  },
  { path: 'dashboard', pathMatch: 'full', redirectTo: '' },
  { path: 'schedule', pathMatch: 'full', redirectTo: '' },
  { path: 'shopping-list', pathMatch: 'full', redirectTo: '' },
  { path: '**', redirectTo: '' },
];
