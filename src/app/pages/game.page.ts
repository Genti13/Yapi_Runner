import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { GameEngine, GameResult } from '../game/engine';
import { buildSprites } from '../game/sprites';
import { DbService } from '../services/db.service';
import { SessionService } from '../services/session.service';

@Component({
  selector: 'app-game',
  imports: [RouterLink],
  template: `
    <div class="stage">
      <canvas #canvas></canvas>

      @if (loading()) {
        <div class="overlay"><p class="loading">Cargando…</p></div>
      }

      @if (paused()) {
        <div class="overlay">
          <div class="card small">
            <h2>Pausa</h2>
            <div class="actions col">
              <button type="button" class="btn" (click)="resume()">Continuar</button>
              <button type="button" class="btn secondary" (click)="exit()">Salir al menú</button>
            </div>
          </div>
        </div>
      }

      @if (result(); as r) {
        <div class="overlay">
          <div class="card small">
            <h2>¡Fin del juego!</h2>
            <p class="who">{{ player()?.name }}</p>
            <p class="score">{{ r.score }}<span> puntos</span></p>
            <p class="stats">🏃 {{ r.distance }} m &nbsp;·&nbsp; 🪙 {{ r.coins }} monedas</p>
            <p class="saved" [class.err]="saveError()">
              @if (saveError()) {
                No se pudo guardar el puntaje.
              } @else if (saved()) {
                ✔ Puntaje guardado
              } @else {
                Guardando…
              }
            </p>
            <div class="actions">
              <button type="button" class="btn" (click)="again()">Jugar de nuevo</button>
              <a class="btn secondary" routerLink="/puntajes">Puntajes</a>
              <a class="btn secondary" routerLink="/">Menú</a>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .stage {
      position: fixed;
      inset: 0;
      background: #a9defc;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background: rgba(20, 25, 45, 0.45);
      padding: 12px;
      overflow: auto;
    }
    .loading { color: #fff; font-size: 1.3rem; font-weight: 800; }
    .card.small { width: min(420px, 100%); text-align: center; padding: 18px 20px; }
    h2 { margin: 0 0 6px; font-size: 1.6rem; }
    .who { margin: 0; color: #7a5f58; font-weight: 700; }
    .score { margin: 2px 0; font-size: 3rem; font-weight: 900; line-height: 1.1; color: var(--accent-dark); }
    .score span { font-size: 1.1rem; font-weight: 700; color: var(--ink); }
    .stats { margin: 0 0 6px; font-weight: 700; }
    .saved { margin: 0 0 12px; min-height: 1.3em; color: #1f8a4c; font-weight: 700; font-size: 0.95rem; }
    .saved.err { color: #c62840; }
    .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .actions.col { flex-direction: column; }
    .actions .btn { text-decoration: none; padding: 12px 20px; font-size: 1rem; text-align: center; }
  `,
})
export class GamePage implements AfterViewInit, OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router);
  private readonly db = inject(DbService);
  private readonly session = inject(SessionService);

  readonly player = this.session.player;
  readonly loading = signal(true);
  readonly paused = signal(false);
  readonly result = signal<GameResult | null>(null);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  private engine?: GameEngine;
  private destroyed = false;

  private readonly onVisibility = () => {
    if (document.hidden) this.engine?.pause();
  };

  async ngAfterViewInit(): Promise<void> {
    void this.lockLandscape();
    document.addEventListener('visibilitychange', this.onVisibility);

    const sprites = await buildSprites();
    if (this.destroyed) return;

    // El bucle de dibujo corre fuera de Angular para no disparar detección de cambios en cada frame.
    this.zone.runOutsideAngular(() => {
      this.engine = new GameEngine(this.canvas().nativeElement, sprites, {
        onGameOver: (r) => this.zone.run(() => void this.onGameOver(r)),
        onPauseChange: (p) => this.zone.run(() => this.paused.set(p)),
      });
      this.engine.start();
    });
    this.loading.set(false);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.engine?.destroy();
    void this.unlockOrientation();
  }

  resume(): void {
    this.engine?.resume();
  }

  exit(): void {
    void this.router.navigateByUrl('/');
  }

  again(): void {
    this.result.set(null);
    this.saved.set(false);
    this.saveError.set(false);
    this.engine?.reset();
  }

  private async onGameOver(r: GameResult): Promise<void> {
    this.result.set(r);
    this.saved.set(false);
    this.saveError.set(false);
    const p = this.session.player();
    if (!p) {
      this.saveError.set(true);
      return;
    }
    try {
      await this.db.addScore({ name: p.name, email: p.email, score: r.score, distance: r.distance, coins: r.coins });
      this.saved.set(true);
    } catch (err) {
      console.error('Error guardando el puntaje', err);
      this.saveError.set(true);
    }
  }

  private async lockLandscape(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await ScreenOrientation.lock({ orientation: 'landscape' });
    } catch (err) {
      console.warn('No se pudo bloquear la orientación', err);
    }
  }

  private async unlockOrientation(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await ScreenOrientation.unlock();
    } catch {
      /* nada que hacer */
    }
  }
}
