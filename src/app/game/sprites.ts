import { Rng } from './rng';

/**
 * Todos los gráficos se dibujan por código (sin imágenes) imitando el estilo de la mascota:
 * render 3D tipo plastilina, sombreado suave con luz arriba-izquierda, brillos y paleta
 * naranja / durazno / crema con estrellitas doradas.
 *
 * Para usar tus propios fotogramas del chanchito corredor, copiá 4 PNG en `public/pig/`
 * con los nombres run-1.png ... run-4.png y se usarán solos (opcional: jump.png para el salto).
 */

export interface Sprite {
  img: CanvasImageSource;
  /** Tamaño lógico (unidades del mundo del juego), no el de píxeles del canvas. */
  w: number;
  h: number;
}

export interface Layer {
  tile: HTMLCanvasElement;
  /** Ancho lógico de un tile. */
  tw: number;
  /** Factor de parallax: 0 = fijo, 1 = misma velocidad que el suelo. */
  k: number;
  /** Banda vertical (lógica) que ocupa la capa: el tile solo cubre esta franja. */
  top: number;
  height: number;
  /** Píxeles del tile por unidad lógica. Si coincide con la escala de dibujo, el blit es 1:1. */
  scale: number;
}

export interface SpriteSet {
  pig: Sprite[];
  /** Pose de salto (opcional: si falta se usa el fotograma 2 del ciclo). */
  pigJump?: Sprite;
  banana: Sprite;
  bird: Sprite[];
  ball: Sprite;
  coin: Sprite[];
  heart: Sprite;
  heartEmpty: Sprite;
  /** Capas de fondo de atrás hacia adelante. */
  layers: Layer[];
  /**
   * Regenera las capas a otra resolución. El motor la llama al cambiar el tamaño
   * de pantalla para que el tile tenga exactamente los píxeles que se van a dibujar.
   */
  makeLayers(scale: number): Layer[];
}

export const WORLD_H = 400;
export const GROUND_Y = 332;
export const TILE_W = 1000;

/** Resolución interna de los sprites respecto de su tamaño lógico. */
const SPRITE_SCALE = 3;

type Ctx = CanvasRenderingContext2D;
/** Luz, tono medio, sombra. */
type Tri = readonly [string, string, string];

/* ------------------------------------------------------------------ */
/* Utilidades de dibujo "plastilina"                                   */
/* ------------------------------------------------------------------ */

function makeCanvas(w: number, h: number, scale: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

/** `k` escala el dibujo: permite diseñar en unidades "grandes" y obtener un sprite más chico. */
function makeSprite(w: number, h: number, draw: (ctx: Ctx) => void, k = 1): Sprite {
  const { canvas, ctx } = makeCanvas(w, h, SPRITE_SCALE);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.scale(k, k);
  draw(ctx);
  return { img: canvas, w, h };
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): void {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, c: Tri): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, c[0]);
  g.addColorStop(0.5, c[1]);
  g.addColorStop(1, c[2]);
  return g;
}

/** Elipse con volumen: luz arriba-izquierda, sombra abajo-derecha. */
function ell3d(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: Tri, rot = 0): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(-0.35, -0.42, 0.04, 0, 0, 1.1);
  g.addColorStop(0, c[0]);
  g.addColorStop(0.55, c[1]);
  g.addColorStop(1, c[2]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Brillo especular suave. */
function shine(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, rot = -0.5, alpha = 0.55): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function softShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, alpha = 0.22): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `rgba(60,30,20,${alpha})`);
  g.addColorStop(1, 'rgba(60,30,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Estrella redondeada de 5 puntas (como las de la mascota). */
function starPath(ctx: Ctx, cx: number, cy: number, R: number, r: number, rot = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = rot + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const GOLD: Tri = ['#ffe9a3', '#f6bf45', '#c98a1c'];

function drawStar(ctx: Ctx, cx: number, cy: number, R: number): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = R * 0.45;
  ctx.strokeStyle = '#e3a22c';
  starPath(ctx, cx, cy, R * 0.82, R * 0.42);
  ctx.fillStyle = linear(ctx, cx - R, cy - R, cx + R, cy + R, GOLD);
  ctx.stroke();
  ctx.fill();
  starPath(ctx, cx, cy, R * 0.55, R * 0.3, -Math.PI / 2 - 0.12);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Paleta de la mascota                                                */
/* ------------------------------------------------------------------ */

const PINK: Tri = ['#ffc7b8', '#f7a291', '#dc7a72'];
const PINK_FAR: Tri = ['#f4ab9c', '#e48a7d', '#c76a65'];
const PINK_EAR: Tri = ['#f9b0a1', '#ec8f84', '#cf6e6a'];
const SNOUT: Tri = ['#ffc3b5', '#f39d8f', '#d6756f'];
const HOOF: Tri = ['#e08b82', '#c96a64', '#a94d4b'];
const ORANGE: Tri = ['#ffa04d', '#ff7b1f', '#d6560e'];
const APRON: Tri = ['#d9592c', '#bd441f', '#913213'];
const CREAM: Tri = ['#fffaf0', '#f6e9d2', '#dcc8a6'];
const SHORTS: Tri = ['#ffb7a3', '#f5927c', '#d5705d'];

/* ------------------------------------------------------------------ */
/* Chanchito corredor                                                  */
/* ------------------------------------------------------------------ */

/** Tamaño lógico final del sprite del chanchito. */
export const PIG_W = 83;
export const PIG_H = 86;
/** El dibujo se diseña en 92 x 96 y se reduce a PIG_W x PIG_H. */
const PIG_DESIGN_W = 92;
const PIG_K = PIG_W / PIG_DESIGN_W;

/** Un miembro de dos segmentos: ángulo del tramo superior y flexión del inferior. */
interface Limb {
  /** Ángulo respecto de la vertical (positivo = hacia adelante). */
  a: number;
  /** Flexión de la rodilla / codo. */
  bend: number;
}

interface PigPose {
  /** Desplazamiento vertical del cuerpo (negativo = arriba). */
  bob: number;
  legNear: Limb;
  legFar: Limb;
  armNear: Limb;
  armFar: Limb;
  /** Inclinación de la cabeza. */
  tilt: number;
  /** Inclinación del torso hacia adelante. */
  lean: number;
  /** Cuánto se dobla la punta del gorro. */
  tip: number;
  earFlop: number;
  tail: number;
  /** Boca más abierta en el salto. */
  mouth: number;
}

/**
 * Ciclo de carrera bípedo de 4 fotogramas, definido a mano para que el pie de apoyo
 * siempre quede sobre el piso: apoyo, vuelo, apoyo opuesto, vuelo opuesto.
 * Los brazos van en oposición a las piernas.
 */
const RUN_POSES: PigPose[] = [0, 1, 2, 3].map((f) => {
  const flight = f % 2 === 1;
  const mirror = f >= 2;
  // pierna de apoyo (casi vertical) y pierna que recupera (rodilla alta)
  const stance: Limb = flight ? { a: -0.7, bend: 0.3 } : { a: -0.15, bend: 0 };
  const swing: Limb = flight ? { a: 0.8, bend: 0.15 } : { a: 0.6, bend: 1.3 };
  const armFwd: Limb = flight ? { a: 0.35, bend: 0.65 } : { a: 0.95, bend: 0.5 };
  const armBack: Limb = flight ? { a: -0.1, bend: 0.75 } : { a: -0.5, bend: 0.8 };
  const sway = mirror ? -1 : 1;
  return {
    bob: flight ? -3 : 0,
    legNear: mirror ? swing : stance,
    legFar: mirror ? stance : swing,
    armNear: mirror ? armBack : armFwd,
    armFar: mirror ? armFwd : armBack,
    tilt: 0.05 * sway,
    lean: 0.06,
    tip: -3 + (flight ? 2 : -1) * sway,
    earFlop: 0.1 - 0.2 * sway,
    tail: 0.2 * sway,
    mouth: 1,
  };
});

function runPose(frame: number): PigPose {
  return RUN_POSES[frame % RUN_POSES.length];
}

const JUMP_POSE: PigPose = {
  bob: -2,
  legNear: { a: 0.6, bend: 0.9 },
  legFar: { a: -0.55, bend: 1.3 },
  armNear: { a: 1.7, bend: 0.2 },
  armFar: { a: 1.4, bend: 0.3 },
  tilt: -0.08,
  lean: -0.05,
  tip: -5,
  earFlop: -0.3,
  tail: 0.3,
  mouth: 1.5,
};

const THIGH = 9;
const SHIN = 8;
const UPPER_ARM = 8.5;
const FOREARM = 6;

/** Pierna de dos segmentos con pezuña. */
function drawLeg(ctx: Ctx, hx: number, hy: number, leg: Limb, far: boolean): void {
  const c = far ? PINK_FAR : PINK;
  const kx = hx + Math.sin(leg.a) * THIGH;
  const ky = hy + Math.cos(leg.a) * THIGH;
  const sa = leg.a - leg.bend;
  const fx = kx + Math.sin(sa) * SHIN;
  const fy = ky + Math.cos(sa) * SHIN;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = c[1];
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(kx, ky);
  ctx.stroke();
  ctx.lineWidth = 9.5;
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  // luz lateral
  ctx.strokeStyle = far ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.26)';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(hx - 2.8, hy);
  ctx.lineTo(kx - 2.8, ky);
  ctx.lineTo(fx - 2.6, fy - 1);
  ctx.stroke();
  // pezuña
  ell3d(ctx, fx + 1.2, fy + 2.2, 6.2, 4, far ? ([HOOF[1], HOOF[2], '#8e3f3f'] as const) : HOOF);
  ctx.strokeStyle = 'rgba(80,25,25,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(fx + 2.6, fy + 0.6);
  ctx.lineTo(fx + 2.6, fy + 4.4);
  ctx.stroke();
}

/** Brazo de dos segmentos: manga remangada, antebrazo y manito. */
function drawArm(ctx: Ctx, sx: number, sy: number, arm: Limb, far: boolean): void {
  const skin = far ? PINK_FAR : PINK;
  const ex = sx + Math.sin(arm.a) * UPPER_ARM;
  const ey = sy + Math.cos(arm.a) * UPPER_ARM;
  const fa = arm.a + arm.bend;
  const hx = ex + Math.sin(fa) * FOREARM;
  const hy = ey + Math.cos(fa) * FOREARM;

  ctx.lineCap = 'round';
  // antebrazo
  ctx.strokeStyle = skin[1];
  ctx.lineWidth = 6.6;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  // manga de la remera
  ctx.strokeStyle = far ? CREAM[2] : CREAM[1];
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(sx - 2.2, sy - 0.5);
  ctx.lineTo(ex - 2.2, ey - 0.5);
  ctx.stroke();
  // manito
  ell3d(ctx, hx, hy + 0.5, 4.6, 4.4, skin);
}

function drawEye(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ell3d(ctx, cx, cy, rx, ry, ['#ffffff', '#fffafa', '#ead9d6']);
  const ix = cx + rx * 0.2;
  const iy = cy + ry * 0.12;
  const ir = rx * 0.78;
  ell3d(ctx, ix, iy, ir, ir * 1.02, ['#a8604a', '#5a2a22', '#1e0e0e']);
  ctx.fillStyle = '#0e0606';
  ctx.beginPath();
  ctx.arc(ix + ir * 0.08, iy + ir * 0.05, ir * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ix + ir * 0.34, iy - ir * 0.42, ir * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(ix - ir * 0.38, iy + ir * 0.42, ir * 0.17, 0, Math.PI * 2);
  ctx.fill();
}

/** Gorro de lana naranja (coordenadas locales de la cabeza: origen en el centro). */
function drawBeanie(ctx: Ctx, tip: number): void {
  // sombra del gorro sobre la frente
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 23.5, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(120,45,35,0.28)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(27, 0.5);
  ctx.quadraticCurveTo(0, -22.5, -25, 2.5);
  ctx.stroke();
  ctx.restore();

  const T = { x: 2 + tip, y: -39 };
  const quadTop = (u: number) => {
    const a = 1 - u;
    return { x: a * a * -24 + 2 * a * u * 0 + u * u * 26, y: a * a * -9 + 2 * a * u * -38 + u * u * -11 };
  };

  // cúpula
  const dome = () => {
    ctx.beginPath();
    ctx.moveTo(-24, -9);
    ctx.bezierCurveTo(-31, -26, -20 + tip, -39, T.x, T.y);
    ctx.bezierCurveTo(22 + tip * 0.5, -39, 32, -27, 26, -11);
    ctx.quadraticCurveTo(0, -38, -24, -9);
    ctx.closePath();
  };
  dome();
  ctx.fillStyle = linear(ctx, -24, -40, 26, -8, ['#ffa955', '#ff7e22', '#d85a10']);
  ctx.fill();

  ctx.save();
  dome();
  ctx.clip();
  // tejido: costillas hacia la punta
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    const P = quadTop(u);
    const E = { x: T.x + (P.x - T.x) * 0.3, y: T.y + 1 };
    const mid = { x: (P.x + E.x) / 2 + (P.x - T.x) * 0.1, y: (P.y + E.y) / 2 };
    ctx.strokeStyle = 'rgba(150,50,0,0.34)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(P.x, P.y);
    ctx.quadraticCurveTo(mid.x, mid.y, E.x, E.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,205,140,0.38)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(P.x + 1.3, P.y);
    ctx.quadraticCurveTo(mid.x + 1.3, mid.y, E.x + 0.6, E.y);
    ctx.stroke();
  }
  // volumen: sombra a la derecha y brillo a la izquierda
  const sh = ctx.createLinearGradient(-26, 0, 28, 0);
  sh.addColorStop(0, 'rgba(255,230,190,0.28)');
  sh.addColorStop(0.45, 'rgba(255,230,190,0)');
  sh.addColorStop(1, 'rgba(120,35,0,0.34)');
  ctx.fillStyle = sh;
  ctx.fillRect(-34, -52, 68, 52);
  ctx.restore();

  // puño (cuff) con costillas
  const cuff = () => {
    ctx.beginPath();
    ctx.moveTo(-24, -9);
    ctx.quadraticCurveTo(0, -38, 26, -11);
    ctx.lineTo(27, -1);
    ctx.quadraticCurveTo(0, -24, -25, 1);
    ctx.closePath();
  };
  cuff();
  ctx.fillStyle = linear(ctx, 0, -24, 0, 2, ['#ff9a42', '#ff7a1c', '#d2540c']);
  ctx.fill();
  ctx.save();
  cuff();
  ctx.clip();
  const bottomAt = (u: number) => {
    const a = 1 - u;
    return { x: a * a * -25 + u * u * 27, y: a * a * 1 + 2 * a * u * -24 + u * u * -1 };
  };
  for (let i = 0; i <= 22; i++) {
    const u = i / 22;
    const A = quadTop(u);
    const B = bottomAt(u);
    ctx.strokeStyle = 'rgba(150,48,0,0.4)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,210,150,0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(A.x + 1.4, A.y);
    ctx.lineTo(B.x + 1.4, B.y);
    ctx.stroke();
  }
  const cg = ctx.createLinearGradient(0, -26, 0, 3);
  cg.addColorStop(0, 'rgba(255,225,180,0.35)');
  cg.addColorStop(0.5, 'rgba(255,225,180,0)');
  cg.addColorStop(1, 'rgba(110,30,0,0.38)');
  ctx.fillStyle = cg;
  ctx.fillRect(-30, -30, 62, 36);
  ctx.restore();

  // brillos
  shine(ctx, -9, -30, 9, 3.6, -0.55, 0.5);
  shine(ctx, -12, -16, 8, 2.2, -0.2, 0.4);
}

/**
 * Cabeza del chanchito en coordenadas locales (origen = centro de la cabeza,
 * radio 26 x 23.5). Mira hacia la derecha, en tres cuartos.
 */
function drawHead(ctx: Ctx, pose: PigPose): void {
  // oreja lejana
  ctx.save();
  ctx.translate(20, -7);
  ctx.rotate(-pose.earFlop * 0.6);
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.bezierCurveTo(12, -8, 21, 1, 17, 11);
  ctx.bezierCurveTo(14, 16, 6, 11, 2, 5);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, -8, 19, 15, PINK_FAR);
  ctx.fill();
  ctx.restore();

  // cabeza
  ell3d(ctx, 0, 0, 26, 23.5, PINK);
  // sombra bajo el mentón
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 23.5, 0, 0, Math.PI * 2);
  ctx.clip();
  const jaw = ctx.createLinearGradient(0, 8, 0, 24);
  jaw.addColorStop(0, 'rgba(180,70,70,0)');
  jaw.addColorStop(1, 'rgba(180,70,70,0.18)');
  ctx.fillStyle = jaw;
  ctx.fillRect(-30, 6, 60, 22);
  ctx.restore();

  // cachete rosado
  const ch = ctx.createRadialGradient(-11, 11, 0, -11, 11, 10);
  ch.addColorStop(0, 'rgba(255,85,100,0.55)');
  ch.addColorStop(1, 'rgba(255,85,100,0)');
  ctx.fillStyle = ch;
  ctx.beginPath();
  ctx.arc(-11, 11, 10, 0, Math.PI * 2);
  ctx.fill();

  // ojos y cejas
  drawEye(ctx, -7, -1.5, 6.3, 7.1);
  drawEye(ctx, 12.5, -4, 5.3, 6.5);
  ctx.strokeStyle = '#8a4a40';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-12.5, -10.5);
  ctx.quadraticCurveTo(-7, -13, -2, -10.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(8.5, -12.2);
  ctx.quadraticCurveTo(13, -14.5, 17.5, -12);
  ctx.stroke();

  // hocico
  ell3d(ctx, 13.5, 7.5, 10.8, 7.8, SNOUT);
  shine(ctx, 9.5, 3.6, 5.5, 2.4, -0.3, 0.55);
  ctx.fillStyle = '#9b4745';
  ctx.beginPath();
  ctx.ellipse(10.4, 8.4, 1.8, 2.6, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(17, 8.4, 1.8, 2.6, -0.12, 0, Math.PI * 2);
  ctx.fill();

  // boca sonriente
  const m = pose.mouth;
  ctx.beginPath();
  ctx.moveTo(6.5, 16.2);
  ctx.quadraticCurveTo(14.5, 16.2 + 7.5 * m, 22.5, 15.2);
  ctx.quadraticCurveTo(14.5, 17.6, 6.5, 16.2);
  ctx.closePath();
  ctx.fillStyle = '#7a2a30';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#ff8f98';
  ctx.beginPath();
  ctx.ellipse(15, 21.5, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(8, 16.2);
  ctx.quadraticCurveTo(14.5, 18, 21, 15.8);
  ctx.stroke();

  // gorro (algo achatado para que entre completo en el sprite)
  ctx.save();
  ctx.scale(1, 0.84);
  drawBeanie(ctx, pose.tip);
  ctx.restore();

  // oreja cercana, cae por debajo del gorro
  ctx.save();
  ctx.translate(-23, -6);
  ctx.rotate(pose.earFlop);
  ctx.beginPath();
  ctx.moveTo(1, -3);
  ctx.bezierCurveTo(-11, -5, -17, 6, -11, 15);
  ctx.bezierCurveTo(-7, 20, 1, 14, 3, 6);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, -14, -3, 4, 16, PINK_EAR);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-1, 0);
  ctx.bezierCurveTo(-8, -1, -11, 6, -8, 11);
  ctx.bezierCurveTo(-5, 14, -1, 10, 0, 5);
  ctx.closePath();
  ctx.fillStyle = 'rgba(220,100,100,0.35)';
  ctx.fill();
  ctx.restore();
}

/** Cuerpo: remera crema, shorts y delantal. */
function drawTorso(ctx: Ctx, pose: PigPose): void {
  const ty = pose.bob;
  ctx.save();
  ctx.translate(46, 58 + ty);
  ctx.rotate(pose.lean);
  ctx.translate(-46, -(58 + ty));

  // shorts
  rr(ctx, 30, 61 + ty, 33, 15, [4, 4, 8, 8]);
  ctx.fillStyle = linear(ctx, 30, 0, 63, 0, SHORTS);
  ctx.fill();

  // remera crema (hombros redondeados)
  rr(ctx, 27, 43 + ty, 38, 29, [13, 13, 8, 8]);
  ctx.fillStyle = linear(ctx, 27, 0, 65, 0, CREAM);
  ctx.fill();

  // delantal con peto
  const apron = () => rr(ctx, 31, 47 + ty, 31, 28, [5, 9, 7, 7]);
  apron();
  ctx.fillStyle = linear(ctx, 31, 47 + ty, 62, 75 + ty, APRON);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,15,0,0.35)';
  ctx.lineWidth = 1;
  apron();
  ctx.stroke();

  // bolsillo delantero
  rr(ctx, 36, 60 + ty, 21, 10, 3);
  ctx.fillStyle = 'rgba(255,170,120,0.1)';
  ctx.fill();
  ctx.setLineDash([1.6, 1.4]);
  ctx.strokeStyle = 'rgba(255,200,160,0.5)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(60,10,0,0.4)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(36.5, 60 + ty);
  ctx.lineTo(56.5, 60 + ty);
  ctx.stroke();

  // volumen del delantal
  const ag = ctx.createLinearGradient(31, 0, 62, 0);
  ag.addColorStop(0, 'rgba(255,190,140,0.26)');
  ag.addColorStop(0.42, 'rgba(255,190,140,0)');
  ag.addColorStop(1, 'rgba(60,10,0,0.3)');
  apron();
  ctx.fillStyle = ag;
  ctx.fill();
  ctx.restore();
}

/** Chanchito bípedo: dos piernas, dos brazos y cabeza grande. */
function drawPig(ctx: Ctx, pose: PigPose): void {
  const bob = pose.bob;
  const hipY = 71 + bob * 0.35;
  const shoulderY = 53 + bob;

  // ---- colita enrulada (detrás del cuerpo)
  ctx.save();
  ctx.translate(30, 68 + bob);
  ctx.rotate(pose.tail);
  ctx.scale(0.8, 0.8);
  ctx.lineCap = 'round';
  for (const [w, color] of [
    [3.8, PINK[2]],
    [2.4, PINK[1]],
  ] as [number, string][]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-9, -1, -12, -11, -6, -13);
    ctx.bezierCurveTo(-1, -14, -1, -7, -5, -7.5);
    ctx.stroke();
  }
  ctx.restore();

  // ---- lado lejano
  drawLeg(ctx, 43, hipY, pose.legFar, true);
  drawArm(ctx, 31, shoulderY, pose.armFar, true);

  // ---- cuerpo
  drawTorso(ctx, pose);

  // ---- pierna cercana, por delante del short
  drawLeg(ctx, 51, hipY, pose.legNear, false);

  // ---- cabeza
  ctx.save();
  ctx.translate(49, 30 + bob);
  ctx.rotate(pose.tilt);
  ctx.scale(0.85, 0.85);
  drawHead(ctx, pose);
  ctx.restore();

  // ---- brazo cercano, por delante del delantal
  drawArm(ctx, 61, shoulderY - 1, pose.armNear, false);
}

function buildPigFrames(): Sprite[] {
  return [0, 1, 2, 3].map((f) => makeSprite(PIG_W, PIG_H, (ctx) => drawPig(ctx, runPose(f)), PIG_K));
}

function buildPigJump(): Sprite {
  return makeSprite(PIG_W, PIG_H, (ctx) => drawPig(ctx, JUMP_POSE), PIG_K);
}

/** Intenta cargar los 4 fotogramas propios; devuelve null si falta alguno. */
/** Carga una imagen; resuelve en null si no existe o falla (los PNG propios son opcionales). */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Caja que encierra los píxeles no transparentes, o null si no se puede leer el bitmap. */
function alphaBounds(img: HTMLImageElement): { x0: number; y0: number; x1: number; y1: number } | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  try {
    const probe = document.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const g = probe.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, w, h).data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  } catch {
    // getImageData falla si el lienzo queda "tainted" (por ejemplo sobre file://)
    return null;
  }
}

function cropTo(img: HTMLImageElement, x0: number, y0: number, w: number, h: number): CanvasImageSource {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d');
  if (!g) return img;
  g.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  return out;
}

/**
 * Convierte un juego de fotogramas en sprites listos para dibujar:
 *
 * - Les recorta el margen transparente con una **caja común** a todos, así los fotogramas de una
 *   animación no se desalinean entre sí (si se recortara cada uno por su cuenta, el dibujo
 *   saltaría de un frame al otro).
 * - Los escala a todos con el **mismo factor** para que entren en `boxW` x `boxH` sin deformar.
 *   Nunca los agranda más allá de esa caja, así cambiar la imagen no altera la dificultad.
 *
 * Si los fotogramas no miden lo mismo, o no se pueden leer los píxeles, se usan sin recortar.
 */
function containFrames(imgs: HTMLImageElement[], boxW: number, boxH: number): Sprite[] {
  const w0 = imgs[0].naturalWidth;
  const h0 = imgs[0].naturalHeight;
  const sameSize = imgs.every((i) => i.naturalWidth === w0 && i.naturalHeight === h0);

  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  if (sameSize) {
    for (const img of imgs) {
      const b = alphaBounds(img);
      if (!b) {
        box = null;
        break;
      }
      box = box
        ? {
            x0: Math.min(box.x0, b.x0),
            y0: Math.min(box.y0, b.y0),
            x1: Math.max(box.x1, b.x1),
            y1: Math.max(box.y1, b.y1),
          }
        : b;
    }
  }

  const cw = box ? box.x1 - box.x0 + 1 : w0;
  const ch = box ? box.y1 - box.y0 + 1 : h0;
  const trimmed = box && (cw !== w0 || ch !== h0);
  const k = Math.min(boxW / cw, boxH / ch);
  const w = Math.round(cw * k);
  const h = Math.round(ch * k);

  return imgs.map((img) => ({
    img: trimmed && box ? cropTo(img, box.x0, box.y0, cw, ch) : img,
    w: sameSize ? w : Math.round(Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight) * img.naturalWidth),
    h: sameSize ? h : Math.round(Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight) * img.naturalHeight),
  }));
}

async function loadCustomPig(baseUrl = 'pig/'): Promise<{ run: Sprite[]; jump?: Sprite } | null> {
  // Los fotogramas se usan tal cual (sin recortar) para que no se desalineen entre sí.
  const toSprite = (img: HTMLImageElement): Sprite => ({
    img,
    w: Math.round((img.naturalWidth / img.naturalHeight) * PIG_H),
    h: PIG_H,
  });
  const imgs = await Promise.all([1, 2, 3, 4].map((n) => loadImage(`${baseUrl}run-${n}.png`)));
  if (imgs.some((i) => i === null)) return null;
  const jump = await loadImage(`${baseUrl}jump.png`);
  return {
    run: (imgs as HTMLImageElement[]).map(toSprite),
    jump: jump ? toSprite(jump) : undefined,
  };
}

/**
 * Trampas propias desde `public/traps/`. Cada una es opcional y, si falta, se usa el dibujo
 * por código. El pájaro necesita sus dos fotogramas: con uno solo no se puede animar el aleteo.
 */
async function loadCustomTraps(baseUrl = 'traps/'): Promise<{
  banana?: Sprite;
  bird?: Sprite[];
  ball?: Sprite;
}> {
  const [banana, bird1, bird2, ball] = await Promise.all([
    loadImage(`${baseUrl}banana.png`),
    loadImage(`${baseUrl}bird-1.png`),
    loadImage(`${baseUrl}bird-2.png`),
    loadImage(`${baseUrl}ball.png`),
  ]);
  return {
    banana: banana ? containFrames([banana], BANANA_W, BANANA_H)[0] : undefined,
    bird: bird1 && bird2 ? containFrames([bird1, bird2], BIRD_W, BIRD_H) : undefined,
    ball: ball ? containFrames([ball], BALL_SIZE, BALL_SIZE)[0] : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Obstáculos, monedas y HUD                                           */
/* ------------------------------------------------------------------ */

export const BANANA_W = 54;
export const BANANA_H = 32;
export const BIRD_W = 58;
export const BIRD_H = 44;
export const BALL_SIZE = 40;
export const COIN_SIZE = 34;

function buildBanana(): Sprite {
  // Se diseña grande y se reduce al tamaño del sprite: más cómodo para las curvas.
  const DW = 170;
  const K = BANANA_W / DW;
  const OUTLINE = '#5a3418';
  const TIP_DARK = '#6b3f1c';

  /** Curva cuadrática que hace de "columna" de una tira. */
  interface Spine {
    x0: number;
    y0: number;
    cx: number;
    cy: number;
    x1: number;
    y1: number;
  }

  const at = (s: Spine, t: number) => {
    const u = 1 - t;
    return { x: u * u * s.x0 + 2 * u * t * s.cx + t * t * s.x1, y: u * u * s.y0 + 2 * u * t * s.cy + t * t * s.y1 };
  };
  const normal = (s: Spine, t: number) => {
    const vx = 2 * (1 - t) * (s.cx - s.x0) + 2 * t * (s.x1 - s.cx);
    const vy = 2 * (1 - t) * (s.cy - s.y0) + 2 * t * (s.y1 - s.cy);
    const l = Math.hypot(vx, vy) || 1;
    return { x: -vy / l, y: vx / l };
  };
  /** Ancho interpolado entre base, medio y punta. */
  const widthAt = (a0: number, b0: number, c0: number) => (t: number) => {
    const u = 1 - t;
    return u * u * a0 + 2 * u * t * b0 + t * t * c0;
  };

  const stripPath = (ctx: Ctx, s: Spine, wid: (t: number) => number, t0 = 0, t1 = 1) => {
    const N = 24;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = t0 + (t1 - t0) * (i / N);
      const p = at(s, t);
      const n = normal(s, t);
      const r = wid(t);
      const x = p.x + n.x * r;
      const y = p.y + n.y * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      const t = t0 + (t1 - t0) * (i / N);
      const p = at(s, t);
      const n = normal(s, t);
      const r = wid(t);
      ctx.lineTo(p.x - n.x * r, p.y - n.y * r);
    }
    ctx.closePath();
  };

  interface PeelOpts {
    /** La punta se oscurece (las tiras sueltas sí, los extremos del arco no). */
    darkTip?: boolean;
    /** Más saturada: para la pieza de adelante, que recibe la luz. */
    bright?: boolean;
  }

  /** Una tira de cáscara: contorno marrón, relleno amarillo, interior crema y punta oscura. */
  const peel = (
    ctx: Ctx,
    s: Spine,
    [wa, wb, wc]: [number, number, number],
    { darkTip = true, bright = false }: PeelOpts = {},
  ) => {
    const wid = widthAt(wa, wb, wc);

    // El contorno se traza grueso y el relleno tapa la mitad de adentro.
    stripPath(ctx, s, wid);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 5;
    ctx.stroke();

    const p0 = at(s, 0);
    const p1 = at(s, 1);
    const g = ctx.createLinearGradient(p0.x, p0.y - 24, p1.x, p1.y + 24);
    if (bright) {
      g.addColorStop(0, '#ffe96b');
      g.addColorStop(0.45, '#ffd12e');
      g.addColorStop(1, '#efa61c');
    } else {
      g.addColorStop(0, '#ffd63d');
      g.addColorStop(0.5, '#f6ba22');
      g.addColorStop(1, '#dc9013');
    }
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    stripPath(ctx, s, wid);
    ctx.clip();

    // Banda crema: siempre del lado de abajo, que es donde se ve el interior de la cáscara.
    const cream = normal(s, 0.5).y > 0 ? 1 : -1;
    ctx.strokeStyle = '#fff2cf';
    ctx.lineWidth = 6.5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    const N = 22;
    for (let i = 0; i <= N; i++) {
      const t = 0.14 + (0.82 - 0.14) * (i / N);
      const p = at(s, t);
      const n = normal(s, t);
      const r = wid(t) * 0.76 * cream;
      const x = p.x + n.x * r;
      const y = p.y + n.y * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (darkTip) {
      stripPath(ctx, s, wid, 0.89, 1);
      ctx.fillStyle = TIP_DARK;
      ctx.fill();
    }
    ctx.restore();
  };

  return makeSprite(
    BANANA_W,
    BANANA_H,
    (ctx) => {
      softShadow(ctx, 86, 92, 76, 9, 0.32);

      // El cabito está arriba a la derecha y de ahí cuelgan todas las tiras.
      const SX = 112;
      const SY = 20;

      // Tiras de atrás. Las de la izquierda son largas y cruzan por debajo de la pieza grande.
      peel(ctx, { x0: SX, y0: SY, cx: 66, cy: 22, x1: 26, y1: 44 }, [10, 14, 7]);
      peel(ctx, { x0: SX, y0: SY, cx: 58, cy: 74, x1: 14, y1: 80 }, [11, 15, 8]);
      peel(ctx, { x0: SX, y0: SY, cx: 144, cy: 22, x1: 156, y1: 42 }, [9, 12, 6]);
      peel(ctx, { x0: SX, y0: SY, cx: 152, cy: 52, x1: 158, y1: 78 }, [10, 13, 7]);

      // Pieza derecha: baja desde el cabito y forma el otro lado de la "V" invertida.
      peel(ctx, { x0: SX, y0: SY, cx: 132, cy: 42, x1: 128, y1: 78 }, [13, 16, 11], { darkTip: false });

      // Pieza principal: sube en diagonal desde abajo a la izquierda hasta el cabito.
      // Este barrido curvo es lo que hace que se lea como banana.
      const main: Spine = { x0: 58, y0: 82, cx: 70, cy: 46, x1: SX, y1: SY };
      peel(ctx, main, [15, 19, 13], { darkTip: false, bright: true });

      // pliegue a lo largo de la pieza principal
      ctx.strokeStyle = 'rgba(150,95,10,0.35)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        const t = 0.12 + 0.76 * (i / 10);
        const pt = at(main, t);
        const n = normal(main, t);
        const r = widthAt(15, 19, 13)(t) * 0.25;
        const x = pt.x + n.x * r;
        const y = pt.y + n.y * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Cabito: una punta corta que sale para arriba, no una bolita.
      const stem: Spine = { x0: SX - 3, y0: SY + 7, cx: 113, cy: 8, x1: 125, y1: 9 };
      stripPath(ctx, stem, widthAt(7.5, 5.5, 3.5));
      ctx.lineJoin = 'round';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 5;
      ctx.stroke();
      const sg = ctx.createLinearGradient(106, 4, 124, 22);
      sg.addColorStop(0, '#a56c33');
      sg.addColorStop(0.55, '#7d4a1d');
      sg.addColorStop(1, '#5b3313');
      ctx.fillStyle = sg;
      ctx.fill();

      // brillos
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(62, 74);
      ctx.quadraticCurveTo(70, 48, 96, 28);
      ctx.stroke();
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(136, 52);
      ctx.quadraticCurveTo(140, 62, 140, 70);
      ctx.stroke();
    },
    K,
  );
}

function drawBird(ctx: Ctx, wingsUp: boolean): void {
  const BLUE: Tri = ['#a5defc', '#55b4f0', '#2e86c8'];
  const DARK: Tri = ['#6cc0f2', '#2f86c8', '#1d5b94'];

  softShadow(ctx, 30, 40, 18, 2.4, 0.12);
  // cola
  ctx.save();
  ctx.translate(43, 26);
  for (const [r, c] of [
    [-0.45, DARK],
    [0.05, BLUE],
    [0.55, DARK],
  ] as [number, Tri][]) {
    ctx.save();
    ctx.rotate(r);
    ell3d(ctx, 8, 0, 9, 3.6, c);
    ctx.restore();
  }
  ctx.restore();
  // cuerpo
  ell3d(ctx, 30, 26, 18, 13.5, BLUE);
  ell3d(ctx, 27, 31, 11.5, 7.5, ['#ffffff', '#fff3df', '#ead3b0']);
  // cabeza
  ell3d(ctx, 15, 20, 11.5, 11, BLUE);
  // mechón
  ctx.strokeStyle = '#2f86c8';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(14, 9.5);
  ctx.quadraticCurveTo(13, 4.5, 18, 3.5);
  ctx.moveTo(18, 9.8);
  ctx.quadraticCurveTo(19, 5.5, 23.5, 6);
  ctx.stroke();
  // pico (mira hacia la izquierda: viene hacia el chanchito)
  ctx.beginPath();
  ctx.moveTo(6.5, 17);
  ctx.quadraticCurveTo(-1.5, 20, 6.5, 24);
  ctx.quadraticCurveTo(8.5, 20.5, 6.5, 17);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, 17, 8, 24, ['#ffc067', '#ff9028', '#d96a0c']);
  ctx.fill();
  // ojo
  drawEye(ctx, 13, 18, 4.3, 4.9);
  // cachete
  const bl = ctx.createRadialGradient(10, 25, 0, 10, 25, 5);
  bl.addColorStop(0, 'rgba(255,110,120,0.55)');
  bl.addColorStop(1, 'rgba(255,110,120,0)');
  ctx.fillStyle = bl;
  ctx.beginPath();
  ctx.arc(10, 25, 5, 0, Math.PI * 2);
  ctx.fill();
  // ala
  ctx.save();
  ctx.translate(30, wingsUp ? 22 : 27);
  ctx.rotate(wingsUp ? -0.95 : 0.7);
  ell3d(ctx, 8, 0, 13, 6, DARK);
  shine(ctx, 5, -2, 6, 2, 0, 0.35);
  ctx.restore();
  // brillo del cuerpo
  shine(ctx, 26, 16, 7, 2.6, -0.3, 0.4);
}

function buildBird(): Sprite[] {
  return [true, false].map((up) => makeSprite(BIRD_W, BIRD_H, (ctx) => drawBird(ctx, up)));
}

function buildBall(): Sprite {
  return makeSprite(BALL_SIZE, BALL_SIZE, (ctx) => {
    const c = BALL_SIZE / 2;
    const r = c - 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.clip();
    // paneles
    ctx.fillStyle = '#ff6a3d';
    ctx.fillRect(0, 0, BALL_SIZE, BALL_SIZE);
    ctx.fillStyle = '#fff6e4';
    ctx.beginPath();
    ctx.moveTo(c - 5, 0);
    ctx.quadraticCurveTo(c - 11, c, c - 5, BALL_SIZE);
    ctx.lineTo(c + 5, BALL_SIZE);
    ctx.quadraticCurveTo(c + 11, c, c + 5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3fb7c9';
    ctx.beginPath();
    ctx.moveTo(0, c - 4);
    ctx.quadraticCurveTo(c, c + 3, BALL_SIZE, c - 4);
    ctx.lineTo(BALL_SIZE, c + 5);
    ctx.quadraticCurveTo(c, c + 12, 0, c + 5);
    ctx.closePath();
    ctx.fill();
    // volumen
    const g = ctx.createRadialGradient(c - r * 0.4, c - r * 0.45, r * 0.1, c, c, r * 1.1);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(90,20,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BALL_SIZE, BALL_SIZE);
    ctx.restore();
    ctx.strokeStyle = 'rgba(130,40,10,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    shine(ctx, c - 6.5, c - 8, 6, 3.2, -0.6, 0.85);
  });
}

/** Y de la moneda (trazo grueso redondeado). */
function drawY(ctx: Ctx, ox: number, oy: number, s: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ox - 5.6 * s, oy - 6.4 * s);
  ctx.lineTo(ox, oy + 0.4 * s);
  ctx.lineTo(ox + 5.6 * s, oy - 6.4 * s);
  ctx.moveTo(ox, oy + 0.4 * s);
  ctx.lineTo(ox, oy + 7.2 * s);
  ctx.stroke();
}

/** 4 fotogramas de moneda naranja con una "Y" en relieve girando. */
function buildCoin(): Sprite[] {
  const widths = [1, 0.64, 0.2, 0.64];
  return widths.map((k, idx) =>
    makeSprite(COIN_SIZE, COIN_SIZE, (ctx) => {
      const c = COIN_SIZE / 2;
      const r = c - 2;
      const back = idx === 3; // la cara de atrás se ve levemente más oscura
      ctx.save();
      ctx.translate(c, c);
      ctx.scale(Math.max(k, 0.12), 1);

      // canto (grosor)
      if (k < 0.7) {
        ctx.fillStyle = '#c4570f';
        ctx.beginPath();
        ctx.arc(2.2 / Math.max(k, 0.12), 0, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // disco
      ell3d(ctx, 0, 0, r, r, back ? (['#ff9a45', '#ee7016', '#bf4d08'] as const) : (['#ffb866', '#ff8620', '#d65a0c'] as const));
      // aro interior hundido
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(140,45,0,0.45)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,215,160,0.5)';
      ctx.beginPath();
      ctx.arc(0.6, 0.7, r * 0.74, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (k > 0.45) {
        ctx.save();
        ctx.translate(c, c);
        ctx.scale(k, 1);
        // Y en relieve: sombra, cuerpo y luz
        drawY(ctx, 0.9, 1.2, 1.12, 'rgba(120,35,0,0.55)', 4.3);
        drawY(ctx, 0, 0.4, 1.12, '#ff9a3a', 4.3);
        drawY(ctx, -0.5, -0.1, 1.12, 'rgba(255,225,175,0.75)', 1.4);
        ctx.restore();
      }
      if (k > 0.8) shine(ctx, c - 6, c - 7, 6.5, 3, -0.7, 0.55);
    }),
  );
}

function heartPath(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.95);
  ctx.bezierCurveTo(cx - s * 1.7, cy - s * 0.05, cx - s * 0.95, cy - s * 1.35, cx, cy - s * 0.5);
  ctx.bezierCurveTo(cx + s * 0.95, cy - s * 1.35, cx + s * 1.7, cy - s * 0.05, cx, cy + s * 0.95);
  ctx.closePath();
}

function buildHeart(filled: boolean): Sprite {
  const size = 32;
  return makeSprite(size, size, (ctx) => {
    const cx = size / 2;
    const cy = size / 2 + 1;
    heartPath(ctx, cx, cy, 9.5);
    if (filled) {
      ctx.fillStyle = linear(ctx, cx - 10, cy - 10, cx + 10, cy + 12, ['#ff8f8a', '#ff4b57', '#c42441']);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,20,40,0.55)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      shine(ctx, cx - 5, cy - 5, 4.6, 2.4, -0.7, 0.85);
    } else {
      ctx.fillStyle = linear(ctx, cx - 10, cy - 10, cx + 10, cy + 12, ['#f1e4dd', '#ddcdc6', '#c5b3ae']);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,85,0.5)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Escenario con parallax (ciudad plastilina)                          */
/* ------------------------------------------------------------------ */

interface Block {
  x: number;
  w: number;
}

/** Reparte edificios que llenan exactamente el ancho del tile (así el tile enlaza sin cortes). */
function layoutBlocks(rng: Rng, total: number, minW: number, maxW: number): Block[] {
  const blocks: Block[] = [];
  let x = 0;
  while (x < total) {
    let w = rng.int(minW, maxW);
    if (total - x - w < minW) w = total - x;
    blocks.push({ x, w });
    x += w;
  }
  return blocks;
}

/**
 * Lienzo de una capa. Solo cubre la franja vertical `top..top+height`, así el bitmap
 * ocupa menos memoria y el blit por frame mueve menos píxeles. El contexto queda
 * trasladado para poder seguir dibujando en coordenadas del mundo.
 */
function newTile(top: number, height: number, scale: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const t = makeCanvas(TILE_W, height, scale);
  t.ctx.translate(0, -top);
  t.ctx.lineCap = 'round';
  t.ctx.lineJoin = 'round';
  return t;
}

function layerOf(
  canvas: HTMLCanvasElement,
  k: number,
  top: number,
  height: number,
  scale: number,
): Layer {
  return { tile: canvas, tw: TILE_W, k, top, height, scale };
}

/** Nubes y estrellitas comparten capa: ahorra un blit por frame y se mueven casi igual. */
function buildSky(rng: Rng, scale: number): Layer {
  const TOP = 4;
  const H = 172;
  const { canvas, ctx } = newTile(TOP, H, scale);

  const count = 6;
  for (let i = 0; i < count; i++) {
    const cx = (TILE_W / count) * i + rng.range(30, 110);
    const cy = rng.range(46, 140);
    const sc = rng.range(0.85, 1.5);
    const blobs: [number, number, number, number][] = [
      [0, 2, 44, 15],
      [-28, 6, 26, 12],
      [30, 7, 28, 11],
      [6, -9, 24, 14],
    ];
    // sombra inferior
    for (const [dx, dy, rx, ry] of blobs) {
      ctx.fillStyle = 'rgba(176,206,236,0.55)';
      ctx.beginPath();
      ctx.ellipse(cx + dx * sc, cy + (dy + 3.5) * sc, rx * sc, ry * sc, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [dx, dy, rx, ry] of blobs) {
      ell3d(ctx, cx + dx * sc, cy + dy * sc, rx * sc, ry * sc, ['#ffffff', '#fdfeff', '#e4f0fb']);
    }
  }

  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = (TILE_W / n) * i + rng.range(10, 90);
    const y = rng.range(66, 150);
    drawStar(ctx, x, y, rng.range(6, 10));
  }

  return layerOf(canvas, 0.07, TOP, H, scale);
}

function skylineWindows(ctx: Ctx, rng: Rng, b: Block, top: number, bottom: number): void {
  const cw = 6;
  const ch = 8;
  for (let y = top + 10; y + ch < bottom - 6; y += ch + 9) {
    for (let x = b.x + 9; x + cw < b.x + b.w - 8; x += cw + 8) {
      ctx.fillStyle = rng.next() < 0.3 ? 'rgba(255,255,255,0.75)' : 'rgba(150,176,214,0.4)';
      rr(ctx, x, y, cw, ch, 2);
      ctx.fill();
    }
  }
}

function buildFarSkyline(rng: Rng, scale: number): Layer {
  const TOP = 50;
  const H = 286;
  const { canvas, ctx } = newTile(TOP, H, scale);
  const tones: Tri[] = [
    ['#e3ebf7', '#cfdcee', '#b9cae4'],
    ['#e7e6f6', '#d3d2ec', '#bcbbdc'],
    ['#dbeaf5', '#c6dcec', '#aecbe0'],
  ];
  for (const b of layoutBlocks(rng, TILE_W, 54, 112)) {
    const h = rng.range(125, 250);
    const top = GROUND_Y - h;
    const tone = rng.pick(tones);
    if (rng.next() < 0.35) {
      ctx.fillStyle = tone[2];
      rr(ctx, b.x + b.w / 2 - 2, top - 24, 4, 26, 2);
      ctx.fill();
      ell3d(ctx, b.x + b.w / 2, top - 25, 3.5, 3.5, ['#ffd09a', '#ff9a4a', '#e0721c']);
    }
    rr(ctx, b.x, top, b.w, h + 2, [10, 10, 0, 0]);
    ctx.fillStyle = linear(ctx, b.x, 0, b.x + b.w, 0, tone);
    ctx.fill();
    skylineWindows(ctx, rng, b, top, GROUND_Y);
  }
  return layerOf(canvas, 0.12, TOP, H, scale);
}

const MID_TONES: Tri[] = [
  ['#ffe2cf', '#f6b996', '#dc8d68'],
  ['#fff1d4', '#f4dba8', '#d9b97a'],
  ['#d9f2e7', '#abdfc8', '#7fbea3'],
  ['#e8def7', '#c9b9ea', '#a08fcf'],
  ['#d7e9fc', '#aed0f2', '#82ade0'],
];

function buildMidBuildings(rng: Rng, scale: number): Layer {
  const TOP = 84;
  const H = 252;
  const { canvas, ctx } = newTile(TOP, H, scale);
  for (const b of layoutBlocks(rng, TILE_W, 74, 140)) {
    const h = rng.range(110, 230);
    const top = GROUND_Y - h;
    const tone = rng.pick(MID_TONES);
    // cuerpo con volumen (luz a la izquierda)
    rr(ctx, b.x + 1, top, b.w - 2, h + 2, [9, 9, 0, 0]);
    ctx.fillStyle = linear(ctx, b.x, 0, b.x + b.w, 0, tone);
    ctx.fill();
    // cornisa
    rr(ctx, b.x - 1, top, b.w + 2, 8, [8, 8, 2, 2]);
    ctx.fillStyle = linear(ctx, 0, top, 0, top + 8, ['#ffffff66', '#ffffff22', '#00000022'] as unknown as Tri);
    ctx.fill();
    // aire acondicionado / tanque
    if (rng.next() < 0.4) {
      const tx = b.x + b.w * rng.range(0.2, 0.6);
      rr(ctx, tx, top - 13, 22, 14, 4);
      ctx.fillStyle = linear(ctx, tx, 0, tx + 22, 0, tone);
      ctx.fill();
    }
    // ventanas con brillo
    const cw = 10;
    const ch = 14;
    for (let y = top + 18; y + ch < GROUND_Y - 6; y += ch + 12) {
      for (let x = b.x + 11; x + cw < b.x + b.w - 9; x += cw + 10) {
        const lit = rng.next() < 0.38;
        rr(ctx, x, y, cw, ch, 3);
        ctx.fillStyle = lit
          ? linear(ctx, x, y, x, y + ch, ['#fff7d2', '#ffe38f', '#ffc95a'])
          : linear(ctx, x, y, x, y + ch, ['#c9def5', '#9fc0e6', '#7ea2d0']);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        rr(ctx, x + 1.5, y + 1.5, 3, ch - 5, 1.5);
        ctx.fill();
      }
    }
  }
  return layerOf(canvas, 0.3, TOP, H, scale);
}

const SHOP_WALLS: Tri[] = [
  ['#fffaf0', '#f8e6c6', '#e2caa0'],
  ['#ffc9a0', '#ff9f55', '#da7a28'],
  ['#f7b79a', '#e48660', '#bd5f3a'],
  ['#ffe0d6', '#f9bfae', '#dd9582'],
  ['#d9f2e7', '#a9dcc6', '#7cbba2'],
];
const AWNINGS = ['#ff7a1f', '#d9592c', '#ffa63d', '#2fa7a0'];

function buildNearShops(rng: Rng, scale: number): Layer {
  const TOP = 148;
  const H = 188;
  const { canvas, ctx } = newTile(TOP, H, scale);
  for (const b of layoutBlocks(rng, TILE_W, 112, 190)) {
    const h = rng.range(108, 170);
    const top = GROUND_Y - h;
    const wall = rng.pick(SHOP_WALLS);

    rr(ctx, b.x + 1, top, b.w - 2, h + 2, [8, 8, 0, 0]);
    ctx.fillStyle = linear(ctx, b.x, 0, b.x + b.w, 0, wall);
    ctx.fill();
    // cornisa superior
    rr(ctx, b.x - 1.5, top - 2, b.w + 3, 9, 4);
    ctx.fillStyle = linear(ctx, 0, top - 2, 0, top + 7, ['#fffaf0', '#f3e1c0', '#d9bf94']);
    ctx.fill();

    // ventanas del piso alto
    const wy = top + 20;
    const cols = Math.max(2, Math.floor(b.w / 46));
    const cellW = b.w / cols;
    for (let i = 0; i < cols; i++) {
      const wx = b.x + i * cellW + (cellW - 24) / 2;
      rr(ctx, wx - 2.5, wy - 2.5, 29, 34, 6);
      ctx.fillStyle = '#fff6e4';
      ctx.fill();
      rr(ctx, wx, wy, 24, 29, 4);
      const lit = rng.next() < 0.45;
      ctx.fillStyle = lit
        ? linear(ctx, wx, wy, wx, wy + 29, ['#fff4c4', '#ffdd85', '#ffbe4d'])
        : linear(ctx, wx, wy, wx, wy + 29, ['#d3e6fa', '#a7c8ec', '#7fa5d3']);
      ctx.fill();
      ctx.fillStyle = '#fff6e4';
      ctx.fillRect(wx + 11, wy, 2, 29);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      rr(ctx, wx + 3, wy + 3, 4, 12, 2);
      ctx.fill();
      // macetero
      rr(ctx, wx - 1, wy + 29, 26, 5, 2);
      ctx.fillStyle = '#d9592c';
      ctx.fill();
      ell3d(ctx, wx + 6, wy + 28, 5, 3.4, ['#9be07a', '#5cbf55', '#3a9a47']);
      ell3d(ctx, wx + 15, wy + 27.5, 5.5, 3.8, ['#9be07a', '#5cbf55', '#3a9a47']);
    }

    // local: base, vidriera, puerta y toldo
    const shopTop = GROUND_Y - 64;
    rr(ctx, b.x + 6, shopTop, b.w - 12, 64, [4, 4, 0, 0]);
    ctx.fillStyle = linear(ctx, 0, shopTop, 0, GROUND_Y, ['#8a5a45', '#6e4333', '#4f2e24']);
    ctx.fill();
    rr(ctx, b.x + 13, shopTop + 17, b.w - 64, 42, 5);
    ctx.fillStyle = linear(ctx, 0, shopTop + 17, 0, shopTop + 59, ['#f2fbff', '#cbe8f8', '#9fd0ea']);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(b.x + 20, shopTop + 59);
    ctx.lineTo(b.x + 34, shopTop + 59);
    ctx.lineTo(b.x + 46, shopTop + 17);
    ctx.lineTo(b.x + 32, shopTop + 17);
    ctx.closePath();
    ctx.fill();
    rr(ctx, b.x + b.w - 42, shopTop + 15, 28, 49, [6, 6, 0, 0]);
    ctx.fillStyle = linear(ctx, b.x + b.w - 42, 0, b.x + b.w - 14, 0, ['#c98a55', '#a86a3a', '#7e4a26']);
    ctx.fill();
    ell3d(ctx, b.x + b.w - 20, shopTop + 40, 2.3, 2.3, ['#fff0b0', '#ffc94d', '#d9962a']);

    // toldo a rayas con borde ondulado
    const aw = rng.pick(AWNINGS);
    const stripes = Math.max(4, Math.floor(b.w / 16));
    const sw = (b.w + 4) / stripes;
    for (let i = 0; i < stripes; i++) {
      const sx = b.x - 2 + i * sw;
      ctx.beginPath();
      ctx.moveTo(sx, shopTop - 6);
      ctx.lineTo(sx + sw, shopTop - 6);
      ctx.lineTo(sx + sw, shopTop + 12);
      ctx.arc(sx + sw / 2, shopTop + 12, sw / 2, 0, Math.PI, false);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? aw : '#fff4de';
      ctx.fill();
    }
    const og = ctx.createLinearGradient(0, shopTop - 6, 0, shopTop + 20);
    og.addColorStop(0, 'rgba(255,255,255,0.28)');
    og.addColorStop(0.55, 'rgba(255,255,255,0)');
    og.addColorStop(1, 'rgba(60,20,0,0.3)');
    ctx.fillStyle = og;
    ctx.fillRect(b.x - 2, shopTop - 6, b.w + 4, 28);
  }
  return layerOf(canvas, 0.6, TOP, H, scale);
}

/** Calle, vereda, farolas y árboles: todo va a la misma velocidad, así que es una sola capa. */
function buildStreet(rng: Rng, scale: number): Layer {
  const TOP = 200;
  const H = WORLD_H - TOP;
  const { canvas, ctx } = newTile(TOP, H, scale);

  // ---- vereda
  ctx.fillStyle = linear(ctx, 0, GROUND_Y, 0, GROUND_Y + 22, ['#fff6e8', '#f2e2c8', '#e0cba8']);
  ctx.fillRect(0, GROUND_Y, TILE_W, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(0, GROUND_Y, TILE_W, 2.5);
  ctx.fillStyle = 'rgba(160,125,85,0.35)';
  for (let x = 0; x < TILE_W; x += 100) ctx.fillRect(x, GROUND_Y + 2, 2, 20);
  // cordón
  ctx.fillStyle = linear(ctx, 0, GROUND_Y + 22, 0, GROUND_Y + 29, ['#e6d4b6', '#c9b08a', '#a98f6a']);
  ctx.fillRect(0, GROUND_Y + 22, TILE_W, 7);
  // calle
  ctx.fillStyle = linear(ctx, 0, GROUND_Y + 29, 0, WORLD_H, ['#6a6275', '#585066', '#463f54']);
  ctx.fillRect(0, GROUND_Y + 29, TILE_W, WORLD_H - GROUND_Y - 29);
  const sh = ctx.createLinearGradient(0, GROUND_Y + 29, 0, GROUND_Y + 40);
  sh.addColorStop(0, 'rgba(30,20,40,0.35)');
  sh.addColorStop(1, 'rgba(30,20,40,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, GROUND_Y + 29, TILE_W, 11);
  // línea de carril discontinua (período 100 = divide TILE_W)
  for (let x = 10; x < TILE_W; x += 100) {
    rr(ctx, x, GROUND_Y + 50, 56, 6, 3);
    ctx.fillStyle = linear(ctx, 0, GROUND_Y + 50, 0, GROUND_Y + 56, ['#fff2b0', '#ffd34d', '#f0a82a']);
    ctx.fill();
  }

  // ---- farolas y árboles sobre la vereda
  const slots = 5;
  for (let i = 0; i < slots; i++) {
    const x = (TILE_W / slots) * i + rng.range(30, 120);
    if (rng.next() < 0.55) {
      // farola
      rr(ctx, x - 3, GROUND_Y - 124, 6, 124, 3);
      ctx.fillStyle = linear(ctx, x - 3, 0, x + 3, 0, ['#7a6b7a', '#5a4d5c', '#3f3441']);
      ctx.fill();
      rr(ctx, x - 3, GROUND_Y - 127, 30, 5, 2.5);
      ctx.fillStyle = '#5a4d5c';
      ctx.fill();
      softShadow(ctx, x + 22, GROUND_Y - 112, 18, 14, 0);
      ell3d(ctx, x + 22, GROUND_Y - 120, 9, 6, ['#fffbe0', '#ffe9a0', '#f0c35a']);
      rr(ctx, x - 8, GROUND_Y - 7, 16, 7, 3);
      ctx.fillStyle = '#4a3e4c';
      ctx.fill();
    } else {
      // árbol de copa redonda
      rr(ctx, x - 5, GROUND_Y - 62, 10, 62, 4);
      ctx.fillStyle = linear(ctx, x - 5, 0, x + 5, 0, ['#b48458', '#8a5f3a', '#5e3f24']);
      ctx.fill();
      const G: Tri = ['#b4ec8b', '#63c45a', '#3b9a49'];
      ell3d(ctx, x - 19, GROUND_Y - 62, 19, 17, G);
      ell3d(ctx, x + 19, GROUND_Y - 62, 19, 17, G);
      ell3d(ctx, x, GROUND_Y - 80, 27, 24, G);
      shine(ctx, x - 9, GROUND_Y - 90, 11, 6, -0.5, 0.4);
      // maceta
      rr(ctx, x - 12, GROUND_Y - 9, 24, 9, [2, 2, 4, 4]);
      ctx.fillStyle = linear(ctx, 0, GROUND_Y - 9, 0, GROUND_Y, ['#f08a50', '#d9592c', '#a8401c']);
      ctx.fill();
    }
  }

  return layerOf(canvas, 1, TOP, H, scale);
}

/** Escala máxima de los tiles: más resolución no se nota y multiplica la memoria. */
const MAX_TILE_SCALE = 2;

/**
 * Genera las capas del fondo a `scale` píxeles por unidad lógica. Conviene pasarle
 * la misma escala con la que se van a dibujar: así el blit es 1:1 y no hay filtrado.
 */
export function buildLayers(seed: number, scale = 1.5): Layer[] {
  const sc = Math.min(Math.max(scale, 0.75), MAX_TILE_SCALE);
  const rng = new Rng(seed);
  return [
    buildSky(rng, sc),
    buildFarSkyline(rng, sc),
    buildMidBuildings(rng, sc),
    buildNearShops(rng, sc),
    buildStreet(rng, sc),
  ];
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

export async function buildSprites(seed = 1234): Promise<SpriteSet> {
  const [custom, traps] = await Promise.all([loadCustomPig(), loadCustomTraps()]);
  return {
    pig: custom?.run ?? buildPigFrames(),
    pigJump: custom ? custom.jump : buildPigJump(),
    banana: traps.banana ?? buildBanana(),
    bird: traps.bird ?? buildBird(),
    ball: traps.ball ?? buildBall(),
    coin: buildCoin(),
    heart: buildHeart(true),
    heartEmpty: buildHeart(false),
    // Placeholder barato: el motor las regenera con makeLayers() a la resolución de pantalla.
    layers: buildLayers(seed, 1),
    makeLayers: (scale: number) => buildLayers(seed, scale),
  };
}

/** Versión sincrónica (siempre procedural). Útil para pruebas. */
export function buildSpritesSync(seed = 1234): SpriteSet {
  return {
    pig: buildPigFrames(),
    pigJump: buildPigJump(),
    banana: buildBanana(),
    bird: buildBird(),
    ball: buildBall(),
    coin: buildCoin(),
    heart: buildHeart(true),
    heartEmpty: buildHeart(false),
    // Placeholder barato: el motor las regenera con makeLayers() a la resolución de pantalla.
    layers: buildLayers(seed, 1),
    makeLayers: (scale: number) => buildLayers(seed, scale),
  };
}
