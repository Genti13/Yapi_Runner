import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DbService, ScoreRow } from '../services/db.service';

@Component({
  selector: 'app-scores',
  imports: [RouterLink, DatePipe],
  template: `
    <main class="page">
      <section class="card wide">
        <header>
          <h2>🏆 Puntajes</h2>
          <a class="btn secondary back" routerLink="/">Volver</a>
        </header>

        @if (loading()) {
          <p class="empty">Cargando…</p>
        } @else if (error()) {
          <p class="empty err">No se pudieron leer los puntajes.</p>
        } @else if (rows().length === 0) {
          <p class="empty">Todavía no hay puntajes. ¡Sé el primero!</p>
        } @else {
          <ol class="list">
            @for (row of rows(); track row.id; let i = $index) {
              <li [class.top]="i < 3">
                <span class="pos">{{ medal(i) }}</span>
                <span class="who">
                  <strong>{{ row.name }}</strong>
                  <small>{{ row.email }}</small>
                </span>
                <span class="pts">
                  <strong>{{ row.score }}</strong>
                  <small>{{ row.distance }} m · {{ row.coins }} 🪙</small>
                </span>
                <span class="date">{{ row.createdAt | date: 'dd/MM/yy HH:mm' }}</span>
              </li>
            }
          </ol>
        }

        <p class="foot">Almacenamiento: {{ modeLabel() }}</p>
      </section>
    </main>
  `,
  styles: `
    .page { align-items: flex-start; }
    .wide { width: min(720px, 100%); margin: auto; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    h2 { margin: 0; font-size: 1.6rem; }
    .back { padding: 8px 18px; font-size: 0.95rem; text-decoration: none; }
    .empty { text-align: center; padding: 28px 0; color: #7a5f58; font-weight: 700; }
    .empty.err { color: #c62840; }
    .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    li {
      display: grid;
      grid-template-columns: 40px 1fr auto auto;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 14px;
      background: #fbf1e4;
    }
    li.top { background: #ffe8b8; }
    .pos { font-size: 1.3rem; font-weight: 800; text-align: center; }
    .who, .pts { display: flex; flex-direction: column; min-width: 0; }
    .who strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    small { color: #6b7185; font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pts { text-align: right; }
    .pts strong { font-size: 1.25rem; color: var(--accent-dark); }
    .date { color: #6b7185; font-size: 0.78rem; text-align: right; }
    .foot { margin: 14px 0 0; text-align: center; color: #8a90a2; font-size: 0.78rem; }
    @media (max-width: 560px) {
      li { grid-template-columns: 34px 1fr auto; }
      .date { display: none; }
    }
  `,
})
export class ScoresPage implements OnInit {
  private readonly db = inject(DbService);

  readonly rows = signal<ScoreRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly modeLabel = () => (this.db.mode() === 'sqlite' ? 'SQLite (en este teléfono)' : 'localStorage (modo web)');

  async ngOnInit(): Promise<void> {
    try {
      this.rows.set(await this.db.topScores(50));
    } catch (err) {
      console.error('Error leyendo puntajes', err);
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  medal(index: number): string {
    return ['🥇', '🥈', '🥉'][index] ?? String(index + 1);
  }
}
