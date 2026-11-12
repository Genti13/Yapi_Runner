import { Rng } from './rng';
import {
  Layer,
  COIN_SIZE,
  GROUND_Y,
  PIG_H,
  PIG_W,
  Sprite,
  SpriteSet,
  WORLD_H,
} from './sprites';

/** Y donde apoyan los pies del chanchito y los objetos del piso (sobre la vereda). */
export const FLOOR_Y = GROUND_Y + 10;
/** Altura del borde inferior del pájaro bajo, sobre el piso (hay que saltarlo). */
const BIRD_LOW_BOTTOM = 18;
/** Altura del centro del pájaro alto, sobre el piso (hay que pasar por debajo). */
const BIRD_HIGH_CENTER = 118;
/** Ancho mínimo de mundo visible; en pantallas más angostas se reduce la escala. */
const MIN_VIEW_W = 560;
/**
 * Tope de densidad de píxeles. Los celulares reportan hasta 3, pero dibujar a 3x
 * triplica el relleno por frame sin diferencia visible en un juego 2D.
 */
const MAX_RENDER_SCALE = 2;
/** Tope de píxeles del lienzo: evita que una pantalla grande dispare el costo por frame. */
const MAX_CANVAS_PX = 2_100_000;

export const CFG = {
  gravity: 2300,
  jumpVelocity: 820,
  startSpeed: 300,
  maxSpeed: 680,
  /** Aceleración (px/s por segundo de juego). */
  accel: 6,
  pxPerMeter: 40,
  coinPoints: 25,
  maxHits: 3,
  invulnSeconds: 1.4,
  pigX: 110,
  obstacleGap: [1.0, 2.2] as [number, number],
  coinGap: [1.2, 3.0] as [number, number],
} as const;

export type EngineState = 'ready' | 'running' | 'paused' | 'dying' | 'over';
export type ObstacleKind = 'banana' | 'bird' | 'ball';

export interface GameResult {
  score: number;
  /** Distancia en metros. */
  distance: number;
  coins: number;
}

export interface EngineEvents {
  onGameOver(result: GameResult): void;
  onPauseChange?(paused: boolean): void;
}

interface Obstacle {
  kind: ObstacleKind;
  /** Esquina superior izquierda. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Velocidad extra hacia la izquierda respecto del suelo. */
  extra: number;
  vy: number;
  phase: number;
  rot: number;
}

interface Coin {
  x: number;
  /** Centro. */
  y: number;
  phase: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

export interface EngineSnapshot {
  state: EngineState;
  hits: number;
  coins: number;
  distance: number;
  score: number;
  speed: number;
  pigY: number;
  obstacles: ObstacleKind[];
  coinsOnScreen: number;
}

export class GameEngine {
  state: EngineState = 'ready';

  private readonly ctx: CanvasRenderingContext2D;
  private rng: Rng;
  private readonly seed: number | undefined;

  // vista
  private cssW = 800;
  private cssH = 400;
  /** Densidad de render efectiva (devicePixelRatio acotado). */
  private dpr = 1;
  private s = 1; // escala css-px por unidad lógica
  private viewW = 800;
  private offsetY = 0;
  /** Píxeles del lienzo por unidad lógica. */
  private px = 1;
  /** Desplazamiento vertical del mundo dentro del lienzo, en píxeles. */
  private originY = 0;

  // capas del fondo, regeneradas a la resolución de pantalla
  private layers: Layer[];
  private layerScale = 0;

  /** Cielo + sol ya dibujados: es estático, así que se copia en vez de recalcularlo. */
  private skyTile?: HTMLCanvasElement;

  // mundo
  private distancePx = 0;
  private scroll = 0;
  private time = 0;
  private speed: number = CFG.startSpeed;
  private pigY = 0; // altura sobre el piso
  private pigVy = 0; // positivo = sube
  private jumpBuffer = 0;
  private runClock = 0;
  private hits = 0;
  private coins = 0;
  private invuln = 0;
  private shake = 0;
  private obstacleTimer = 1.6;
  private coinTimer = 0.9;
  private dyingT = 0;
  private idleClock = 0;
  private obstacles: Obstacle[] = [];
  private coinList: Coin[] = [];
  private popups: Popup[] = [];
  private gameOverSent = false;

  // loop
  private raf = 0;
  private lastTs = 0;
  private running = false;
  private resizeObs?: ResizeObserver;

  private readonly onPointer = (e: PointerEvent) => this.handlePointer(e);
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);
  private readonly onWinResize = () => this.resize();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sprites: SpriteSet,
    private readonly events: EngineEvents,
    seed?: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    this.ctx = ctx;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.layers = sprites.layers;

    canvas.addEventListener('pointerdown', this.onPointer, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onWinResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(canvas);
    }
    this.resize();
  }

  /* ---------------------------- ciclo de vida ---------------------------- */

  /** Arranca el bucle de dibujo (la partida empieza con el primer toque). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Detiene el bucle y suelta los listeners. */
  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onWinResize);
    this.resizeObs?.disconnect();
    // Liberar los bitmaps del fondo (son varios MB) al salir de la pantalla de juego.
    this.layers = [];
    this.layerScale = 0;
    this.skyTile = undefined;
  }

  /** Nueva partida (vuelve al estado "listo"). */
  reset(): void {
    this.rng = new Rng(this.seed);
    this.state = 'ready';
    this.distancePx = 0;
    this.scroll = 0;
    this.time = 0;
    this.speed = CFG.startSpeed;
    this.pigY = 0;
    this.pigVy = 0;
    this.jumpBuffer = 0;
    this.runClock = 0;
    this.hits = 0;
    this.coins = 0;
    this.invuln = 0;
    this.shake = 0;
    this.obstacleTimer = 1.6;
    this.coinTimer = 0.9;
    this.dyingT = 0;
    this.obstacles = [];
    this.coinList = [];
    this.popups = [];
    this.gameOverSent = false;
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.events.onPauseChange?.(true);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.lastTs = 0;
    this.events.onPauseChange?.(false);
  }

  togglePause(): void {
    if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  jump(): void {
    if (this.state === 'ready') {
      this.state = 'running';
      this.pigVy = CFG.jumpVelocity;
      this.pigY = 0.01;
      return;
    }
    if (this.state !== 'running') return;
    if (this.pigY <= 0) {
      this.pigVy = CFG.jumpVelocity;
      this.pigY = 0.01;
    } else {
      this.jumpBuffer = 0.12;
    }
  }

  /** Recalcula tamaño del canvas y escala. Llamar si cambia el contenedor. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width || this.canvas.clientWidth || 800);
    this.cssH = Math.max(1, rect.height || this.canvas.clientHeight || 400);

    // densidad acotada por el tope y por el presupuesto de píxeles del lienzo
    let r = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE);
    const budget = Math.sqrt(MAX_CANVAS_PX / (this.cssW * this.cssH));
    if (budget < r) r = Math.max(1, budget);
    this.dpr = r;

    this.canvas.width = Math.round(this.cssW * r);
    this.canvas.height = Math.round(this.cssH * r);
    this.s = Math.min(this.cssH / WORLD_H, this.cssW / MIN_VIEW_W);
    this.viewW = this.cssW / this.s;
    this.offsetY = (this.cssH - WORLD_H * this.s) / 2;
    this.px = r * this.s;
    this.originY = r * this.offsetY;

    this.skyTile = this.buildSkyTile();

    // Los tiles se regeneran a la resolución real de dibujo para que el blit sea 1:1.
    if (this.layerScale === 0 || Math.abs(this.px - this.layerScale) / this.layerScale > 0.02) {
      this.layers = this.sprites.makeLayers(this.px);
      this.layerScale = this.layers[0]?.scale ?? this.px;
    }
  }

  /** Deja el contexto en coordenadas del mundo (unidades lógicas). */
  private setWorldTransform(): void {
    this.ctx.setTransform(this.px, 0, 0, this.px, 0, this.originY);
  }

  /**
   * Dibuja el cielo una sola vez en un lienzo aparte. Rellenar un gradiente a pantalla
   * completa cada frame costaba tanto como todo el parallax junto.
   */
  private buildSkyTile(): HTMLCanvasElement | undefined {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w < 1 || h < 1) return undefined;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return undefined;
    g.setTransform(this.px, 0, 0, this.px, 0, this.originY);
    const padY = this.offsetY / this.s + 2;

    const sky = g.createLinearGradient(0, 0, 0, WORLD_H);
    sky.addColorStop(0, '#a9defc');
    sky.addColorStop(0.72, '#fff3df');
    g.fillStyle = sky;
    g.fillRect(0, -padY, this.viewW, WORLD_H + padY * 2);

    const sun = g.createRadialGradient(this.viewW * 0.8, 78, 4, this.viewW * 0.8, 78, 46);
    sun.addColorStop(0, '#fffdf0');
    sun.addColorStop(0.45, 'rgba(255,224,150,0.95)');
    sun.addColorStop(1, 'rgba(255,224,150,0)');
    g.fillStyle = sun;
    g.fillRect(this.viewW * 0.8 - 50, 28, 100, 100);

    // barra inferior si sobra pantalla
    g.fillStyle = '#463f54';
    g.fillRect(0, WORLD_H - 1, this.viewW, padY + 1);
    return c;
  }

  /* ------------------------------- entrada ------------------------------- */

  private handlePointer(e: PointerEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const lx = (e.clientX - r.left) / this.s;
    const ly = (e.clientY - r.top - this.offsetY) / this.s;
    // botón de pausa (arriba a la derecha)
    if (lx >= this.viewW - 64 && ly <= 64 && (this.state === 'running' || this.state === 'paused')) {
      this.togglePause();
      return;
    }
    if (this.state === 'paused') return; // se reanuda desde los botones de la pantalla
    this.jump();
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      this.jump();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      this.togglePause();
    }
  }

  /* ------------------------------- bucle -------------------------------- */

  private readonly frame = (ts: number): void => {
    if (!this.running) return;
    const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 1 / 20) : 0;
    this.lastTs = ts;
    this.advance(dt);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Avanza la simulación `dt` segundos (público para poder probarlo sin dibujar). */
  advance(dt: number): void {
    this.idleClock += dt;
    this.updatePopups(dt);

    if (this.state === 'paused' || this.state === 'over') return;

    if (this.state === 'ready') {
      this.scroll += 45 * dt;
      this.runClock += dt * 7;
      return;
    }

    if (this.state === 'dying') {
      this.updateDying(dt);
      return;
    }

    this.updateRunning(dt);
  }

  private updateRunning(dt: number): void {
    this.time += dt;
    this.speed = Math.min(CFG.maxSpeed, CFG.startSpeed + CFG.accel * this.time);
    const dx = this.speed * dt;
    this.distancePx += dx;
    this.scroll += dx;
    this.runClock += dt * (7 + this.speed / 70);
    this.invuln = Math.max(0, this.invuln - dt);
    this.shake = Math.max(0, this.shake - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    this.updatePig(dt);

    // spawns aleatorios
    this.obstacleTimer -= dt;
    if (this.obstacleTimer <= 0) {
      this.spawnObstacle();
      this.obstacleTimer = this.rng.range(CFG.obstacleGap[0], CFG.obstacleGap[1]);
    }
    this.coinTimer -= dt;
    if (this.coinTimer <= 0) {
      this.spawnCoins();
      this.coinTimer = this.rng.range(CFG.coinGap[0], CFG.coinGap[1]);
    }

    this.updateObstacles(dt, dx);
    this.updateCoins(dx);
    this.checkCollisions();
  }

  private updatePig(dt: number): void {
    if (this.pigY > 0 || this.pigVy > 0) {
      this.pigVy -= CFG.gravity * dt;
      this.pigY += this.pigVy * dt;
      if (this.pigY <= 0) {
        this.pigY = 0;
        this.pigVy = 0;
        if (this.jumpBuffer > 0) {
          this.jumpBuffer = 0;
          this.pigVy = CFG.jumpVelocity;
          this.pigY = 0.01;
        }
      }
    }
  }

  private updateDying(dt: number): void {
    this.dyingT += dt;
    this.speed = Math.max(0, this.speed - this.speed * 4 * dt);
    const dx = this.speed * dt;
    this.scroll += dx;
    this.pigVy -= CFG.gravity * dt;
    this.pigY = Math.max(0, this.pigY + this.pigVy * dt);
    if (this.pigY === 0 && this.pigVy < 0) this.pigVy = 0;
    this.updateObstacles(dt, dx);
    this.updateCoins(dx);
    if (this.dyingT >= 1.1 && !this.gameOverSent) {
      this.state = 'over';
      this.gameOverSent = true;
      this.events.onGameOver(this.result());
    }
  }

  /* ------------------------------- spawns -------------------------------- */

  private spawnObstacle(): void {
    const kind = this.rng.weighted<ObstacleKind>({ banana: 34, bird: 33, ball: 33 });
    const x = this.viewW + 60;
    const base = { x, extra: 0, vy: 0, phase: this.rng.range(0, 6.28), rot: 0 };
    switch (kind) {
      case 'banana': {
        // El tamaño sale del sprite: si se carga un PNG propio, el golpe coincide con el dibujo.
        const sp = this.sprites.banana;
        this.obstacles.push({ ...base, kind, y: FLOOR_Y - sp.h, w: sp.w, h: sp.h });
        break;
      }
      case 'bird': {
        // bajo: hay que saltarlo; alto: hay que pasar por debajo sin saltar.
        // Se ancla el borde de abajo (bajo) y el centro (alto) en vez del borde de arriba,
        // así un sprite de otra altura no cambia si se puede pasar por debajo o no.
        const sp = this.sprites.bird[0];
        const low = this.rng.next() < 0.5;
        const y = low ? FLOOR_Y - BIRD_LOW_BOTTOM - sp.h : FLOOR_Y - BIRD_HIGH_CENTER - sp.h / 2;
        this.obstacles.push({ ...base, kind, y, w: sp.w, h: sp.h, extra: 90 });
        break;
      }
      case 'ball': {
        const sp = this.sprites.ball;
        this.obstacles.push({
          ...base,
          kind,
          y: FLOOR_Y - sp.h,
          w: sp.w,
          h: sp.h,
          extra: 55,
          vy: -this.rng.range(420, 640),
        });
        break;
      }
    }
  }

  private spawnCoins(): void {
    const pattern = this.rng.weighted<'ground' | 'air' | 'arc'>({ ground: 40, air: 30, arc: 30 });
    const n = this.rng.int(3, 6);
    const gap = 42;
    const x0 = this.viewW + 40;
    for (let i = 0; i < n; i++) {
      let y: number;
      if (pattern === 'ground') y = FLOOR_Y - 34;
      else if (pattern === 'air') y = FLOOR_Y - 120;
      else y = FLOOR_Y - 34 - Math.sin((Math.PI * i) / (n - 1)) * 95;
      this.coinList.push({ x: x0 + i * gap, y, phase: i * 0.7 });
    }
  }

  /* ---------------------------- actualización ---------------------------- */

  private updateObstacles(dt: number, dx: number): void {
    for (const o of this.obstacles) {
      o.x -= dx + o.extra * dt * (this.state === 'dying' ? 0 : 1);
      if (o.kind === 'bird') {
        o.phase += dt * 6;
      } else if (o.kind === 'ball') {
        o.vy += 1700 * dt;
        o.y += o.vy * dt;
        if (o.y + o.h >= FLOOR_Y) {
          o.y = FLOOR_Y - o.h;
          o.vy = -this.rng.range(420, 640);
        }
        o.rot -= ((dx + o.extra * dt) / (o.w / 2));
      }
    }
    if (this.obstacles.length && this.obstacles[0].x + this.obstacles[0].w <= -80) {
      this.obstacles = this.obstacles.filter((o) => o.x + o.w > -80);
    }
  }

  private updateCoins(dx: number): void {
    for (const c of this.coinList) c.x -= dx;
    if (this.coinList.length && this.coinList[0].x <= -50) {
      this.coinList = this.coinList.filter((c) => c.x > -50);
    }
  }

  private updatePopups(dt: number): void {
    for (const p of this.popups) {
      p.life -= dt;
      p.y -= 40 * dt;
    }
    if (this.popups.length && this.popups[0].life <= 0) {
      this.popups = this.popups.filter((p) => p.life > 0);
    }
  }

  /* ----------------------------- colisiones ------------------------------ */

  private pigRect(): { x: number; y: number; w: number; h: number } {
    return {
      x: CFG.pigX + 16,
      y: FLOOR_Y - this.pigY - 60,
      w: PIG_W - 34,
      h: 58,
    };
  }

  private checkCollisions(): void {
    const pig = this.pigRect();

    // monedas
    const reach = 4;
    for (let i = this.coinList.length - 1; i >= 0; i--) {
      const c = this.coinList[i];
      if (
        circleRect(c.x, c.y, COIN_SIZE / 2 - 2, pig.x - reach, pig.y - reach, pig.w + reach * 2, pig.h + reach * 2)
      ) {
        this.coinList.splice(i, 1);
        this.coins++;
        this.popups.push({ x: c.x, y: c.y - 14, text: `+${CFG.coinPoints}`, color: '#e0620f', life: 0.7 });
      }
    }

    if (this.invuln > 0) return;

    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      let hit = false;
      if (o.kind === 'ball') {
        hit = circleRect(o.x + o.w / 2, o.y + o.h / 2, Math.min(o.w, o.h) / 2 - 3, pig.x, pig.y, pig.w, pig.h);
      } else {
        const shrink = o.kind === 'bird' ? 6 : 4;
        const bobY = o.kind === 'bird' ? Math.sin(o.phase) * 5 : 0;
        hit = rectsOverlap(
          pig.x,
          pig.y,
          pig.w,
          pig.h,
          o.x + shrink,
          o.y + bobY + shrink,
          o.w - shrink * 2,
          o.h - shrink * 2,
        );
      }
      if (hit) {
        this.obstacles.splice(i, 1);
        this.registerHit();
        return;
      }
    }
  }

  private registerHit(): void {
    this.hits++;
    this.invuln = CFG.invulnSeconds;
    this.shake = 0.3;
    this.popups.push({ x: CFG.pigX + 20, y: FLOOR_Y - this.pigY - 70, text: '¡Ouch!', color: '#d7263d', life: 0.9 });
    if (this.hits >= CFG.maxHits) {
      this.state = 'dying';
      this.dyingT = 0;
      this.pigVy = 520;
      this.pigY = Math.max(this.pigY, 0.01);
    }
  }

  /* -------------------------------- datos -------------------------------- */

  private result(): GameResult {
    const distance = Math.floor(this.distancePx / CFG.pxPerMeter);
    return { score: distance + this.coins * CFG.coinPoints, distance, coins: this.coins };
  }

  snapshot(): EngineSnapshot {
    const r = this.result();
    return {
      state: this.state,
      hits: this.hits,
      coins: this.coins,
      distance: r.distance,
      score: r.score,
      speed: this.speed,
      pigY: this.pigY,
      obstacles: this.obstacles.map((o) => o.kind),
      coinsOnScreen: this.coinList.length,
    };
  }

  /* ------------------------------- dibujo -------------------------------- */

  render(): void {
    const ctx = this.ctx;
    this.setWorldTransform();
    ctx.imageSmoothingEnabled = true;
    // 'high' obliga a un filtrado caro en cada drawImage; en móvil no compensa.
    ctx.imageSmoothingQuality = 'low';

    const padY = this.offsetY / this.s + 2;

    // cielo: copia directa del lienzo pre-renderizado
    if (this.skyTile) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.skyTile, 0, 0);
      ctx.imageSmoothingEnabled = true;
      this.setWorldTransform();
    }

    let shakeX = 0;
    let shakeY = 0;
    if (this.shake > 0) {
      const m = this.shake * 18;
      shakeX = (this.rng.next() - 0.5) * m;
      shakeY = (this.rng.next() - 0.5) * m;
    }

    this.drawLayers(shakeX, shakeY);

    this.setWorldTransform();
    ctx.save();
    if (shakeX || shakeY) ctx.translate(shakeX, shakeY);
    this.drawCoins();
    this.drawObstacles();
    this.drawPig();
    this.drawPopups();
    ctx.restore();

    this.drawHud();
    if (this.state === 'ready') this.drawReady();
    if (this.state === 'paused') {
      ctx.fillStyle = 'rgba(20,25,45,0.55)';
      ctx.fillRect(0, -padY, this.viewW, WORLD_H + padY * 2);
    }
  }

  /**
   * Dibuja el parallax copiando los tiles píxel a píxel (sin escalar ni filtrar) y
   * recortando al área visible. Es lo más pesado del frame, así que va en píxeles
   * del lienzo en vez de en coordenadas del mundo.
   */
  private drawLayers(shakeX: number, shakeY: number): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const sx = Math.round(shakeX * this.px);
    const sy = Math.round(shakeY * this.px);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    for (const l of this.layers) {
      const tileW = l.tile.width;
      const bandH = l.tile.height;
      const dy = Math.round(this.originY + l.top * this.px) + sy;
      let off = Math.round(this.scroll * l.k * l.scale) % tileW;
      if (off < 0) off += tileW;

      for (let dx = -off + sx; dx < cw; dx += tileW) {
        // recorte: solo la porción del tile que cae dentro del lienzo
        const from = Math.max(0, dx);
        const to = Math.min(cw, dx + tileW);
        const w = to - from;
        if (w > 0) ctx.drawImage(l.tile, from - dx, 0, w, bandH, from, dy, w, bandH);
      }
    }

    ctx.imageSmoothingEnabled = true;
  }

  private drawSprite(sp: Sprite, x: number, y: number): void {
    this.ctx.drawImage(sp.img, x, y, sp.w, sp.h);
  }

  private drawCoins(): void {
    const frames = this.sprites.coin;
    for (const c of this.coinList) {
      const f = Math.floor((this.idleClock * 9 + c.phase * 3) % frames.length);
      this.drawSprite(frames[f], c.x - COIN_SIZE / 2, c.y - COIN_SIZE / 2);
    }
  }

  private drawObstacles(): void {
    const ctx = this.ctx;
    for (const o of this.obstacles) {
      if (o.kind === 'banana') {
        this.drawSprite(this.sprites.banana, o.x, o.y);
      } else if (o.kind === 'bird') {
        const frames = this.sprites.bird;
        const f = Math.floor(o.phase / 1.2) % frames.length;
        this.drawSprite(frames[f < 0 ? 0 : f], o.x, o.y + Math.sin(o.phase) * 5);
      } else {
        ctx.save();
        ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
        ctx.rotate(o.rot);
        this.drawSprite(this.sprites.ball, -o.w / 2, -o.h / 2);
        ctx.restore();
        // sombra
        const airborne = Math.max(0, 1 - (FLOOR_Y - o.y - o.h) / 120);
        ctx.fillStyle = `rgba(0,0,0,${0.18 * airborne})`;
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, FLOOR_Y + 1, 14 * (0.6 + airborne * 0.4), 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawPig(): void {
    const ctx = this.ctx;
    const frames = this.sprites.pig;
    const airborne = this.pigY > 0.5;
    let idx = Math.floor(this.runClock) % frames.length;
    if (airborne) idx = 1 % frames.length;
    const sp = airborne && this.sprites.pigJump ? this.sprites.pigJump : frames[idx];

    // sombra
    const shadowK = Math.max(0.35, 1 - this.pigY / 220);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(CFG.pigX + 40, FLOOR_Y + 1, 30 * shadowK, 4 * shadowK, 0, 0, Math.PI * 2);
    ctx.fill();

    // parpadeo mientras es invulnerable
    if (this.state === 'running' && this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0) return;

    const x = CFG.pigX + (PIG_W - sp.w) / 2;
    const y = FLOOR_Y - this.pigY - sp.h;
    if (this.state === 'dying' || this.state === 'over') {
      ctx.save();
      ctx.translate(x + sp.w / 2, y + sp.h / 2);
      ctx.rotate(-Math.min(this.dyingT, 0.9) * 3.4);
      this.drawSprite(sp, -sp.w / 2, -sp.h / 2);
      ctx.restore();
    } else {
      this.drawSprite(sp, x, y);
    }
  }

  private drawPopups(): void {
    const ctx = this.ctx;
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  private text(str: string, x: number, y: number, size: number, align: CanvasTextAlign, color = '#2b2d42'): void {
    const ctx = this.ctx;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const r = this.result();

    this.text(`${r.distance} m`, 18, 34, 26, 'left');
    this.drawSprite(this.sprites.coin[0], 12, 41);
    this.text(`x ${this.coins}`, 50, 65, 20, 'left', '#c4491f');

    this.text(String(r.score), this.viewW / 2, 38, 34, 'center', '#c4491f');
    this.text('PUNTOS', this.viewW / 2, 58, 13, 'center', '#5a6073');

    // golpes restantes (corazones)
    const left = CFG.maxHits - this.hits;
    for (let i = 0; i < CFG.maxHits; i++) {
      const hx = this.viewW - 76 - (CFG.maxHits - i) * 30;
      this.drawSprite(i < left ? this.sprites.heart : this.sprites.heartEmpty, hx, 12);
    }

    // botón de pausa (solo mientras se juega)
    if (this.state === 'running' || this.state === 'paused') {
      const bx = this.viewW - 56;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      roundRect(ctx, bx, 12, 44, 44, 12);
      ctx.fill();
      ctx.fillStyle = '#ff7a1f';
      roundRect(ctx, bx + 13, 22, 7, 24, 3);
      ctx.fill();
      roundRect(ctx, bx + 24, 22, 7, 24, 3);
      ctx.fill();
    }
  }

  private drawReady(): void {
    const ctx = this.ctx;
    const pulse = 0.65 + 0.35 * Math.sin(this.idleClock * 4);
    ctx.globalAlpha = pulse;
    this.text('Toca para empezar', this.viewW / 2, 150, 30, 'center');
    ctx.globalAlpha = 1;
    this.text('Toca para saltar · esquivá las trampas · juntá monedas', this.viewW / 2, 180, 15, 'center', '#5a6073');
  }
}

/* ------------------------------ geometría ------------------------------ */

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function circleRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number): boolean {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
