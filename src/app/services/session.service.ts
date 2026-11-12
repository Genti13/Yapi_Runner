import { Injectable, signal } from '@angular/core';

export interface Player {
  name: string;
  email: string;
}

const KEY = 'chanchito.player.v1';

/** Jugador actual. Se recuerda el último usado para precargar el formulario. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly player = signal<Player | null>(this.load());

  set(player: Player): void {
    this.player.set(player);
    try {
      localStorage.setItem(KEY, JSON.stringify(player));
    } catch {
      /* sin almacenamiento: se usa solo en memoria */
    }
  }

  private load(): Player | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as Partial<Player>;
      return p.name && p.email ? { name: p.name, email: p.email } : null;
    } catch {
      return null;
    }
  }
}
