import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { SessionService } from './services/session.service';

/** El juego solo se abre si ya se cargaron nombre y correo. */
const playerGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.player() ? true : inject(Router).createUrlTree(['/registro']);
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./pages/menu.page').then((m) => m.MenuPage) },
  { path: 'registro', loadComponent: () => import('./pages/register.page').then((m) => m.RegisterPage) },
  {
    path: 'juego',
    canActivate: [playerGuard],
    loadComponent: () => import('./pages/game.page').then((m) => m.GamePage),
  },
  { path: 'puntajes', loadComponent: () => import('./pages/scores.page').then((m) => m.ScoresPage) },
  { path: '**', redirectTo: '' },
];
