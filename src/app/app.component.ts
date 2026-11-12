import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DbService } from './services/db.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent {
  constructor() {
    // Abre (y crea si hace falta) la base SQLite apenas arranca la app.
    inject(DbService)
      .init()
      .catch((err) => console.error('No se pudo abrir la base de datos', err));
  }
}
