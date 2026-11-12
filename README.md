# 🐷 Chanchito Runner

Runner infinito estilo "dinosaurio de Chrome" para celular. **Angular 20 + Capacitor 7**, gráficos en `canvas` 2D
y puntajes guardados en **SQLite** dentro del teléfono.

## Qué incluye

| Requisito | Dónde está |
|---|---|
| Chanchito con 4 fotogramas corriendo | `src/app/game/sprites.ts` (procedural, estilo de la mascota). Tus PNG lo reemplazan: ver abajo |
| Parallax de ciudad | 6 capas (nubes, skyline lejano, edificios, locales, farolas/árboles, calle) en `sprites.ts`; se dibujan en `engine.ts → drawLayers()` |
| Puntos = distancia recorrida | `engine.ts` (metros = px / 40) |
| Monedas con una Y que suman puntos | +25 por moneda (`CFG.coinPoints`), en filas y arcos aleatorios |
| Trampas: cáscaras de banana, pájaros, pelotas que rebotan | `engine.ts → spawnObstacle()`, aparecen al azar. Reemplazables por PNG propios |
| 3 golpes y se pierde | `CFG.maxHits`; tras cada golpe hay 1,4 s de invulnerabilidad (parpadeo) |
| Nombre y correo al empezar | `pages/register.page.ts` (formulario validado, se precarga el último jugador) |
| Pantalla principal con **Jugar** y **Puntajes** | `pages/menu.page.ts` |
| Ranking con SQLite | `services/db.service.ts` + `pages/scores.page.ts` |

**Cómo se juega:** tocá la pantalla (o `Espacio`/`↑` en la PC) para saltar.
- Cáscara de banana y pelota → saltalas.
- Pájaro **bajo** → saltalo. Pájaro **alto** → no saltes, pasá por debajo.
- Botón de pausa arriba a la derecha; el juego también se pausa solo si la app pasa a segundo plano.

## Puesta en marcha

Requisitos: Node 20+ (recomendado 22), y para el APK Android Studio con JDK 21.

```bash
npm install

# Probar en el navegador (los puntajes usan localStorage en este modo)
npm start            # http://localhost:4200

# Generar el proyecto Android (una sola vez)
npx cap add android

# Compilar la web y copiarla al proyecto Android
npm run sync

# Abrir en Android Studio → Build > Build APK(s)
npx cap open android
```

APK de debug por línea de comandos (con el SDK de Android instalado):

```bash
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Cada vez que cambies código: `npm run sync` y volvé a compilar desde Android Studio.

> En el celular los puntajes se guardan en **SQLite** (plugin `@capacitor-community/sqlite`).
> En el navegador ese plugin no existe, por eso se usa `localStorage` con la misma interfaz;
> al pie de la pantalla de Puntajes se indica cuál de los dos se está usando.

## Estilo gráfico (mascota Yapas)

Todo el arte está dibujado por código imitando la mascota: render 3D tipo plastilina, luz arriba-izquierda,
paleta naranja / durazno / crema y estrellitas doradas.

- **Chanchito corredor** (`sprites.ts → drawPig`): **bípedo** (dos piernas y dos brazos), cabeza grande,
  gorro naranja tejido, remera crema y delantal, sin nada en las manos. El ciclo de carrera son 4 poses
  escritas a mano en `RUN_POSES` (apoyo, vuelo, apoyo opuesto, vuelo opuesto) más una pose de salto, así el
  pie de apoyo siempre queda sobre el piso. Piernas y brazos son de dos segmentos (`drawLeg` / `drawArm`).
- **Moneda**: naranja con una **Y** en relieve, 4 fotogramas girando.
- **Trampas**: cáscara de banana (tiras largas desplegadas sobre el piso, con el cabito a un costado),
  pájaro azul y pelota, con el mismo sombreado.
- **Ciudad con parallax**: nubes, estrellas, skyline lejano, edificios, locales con toldos, farolas/árboles y calle.
- **Menú**: usa `public/pig/menu.png`, el recorte de tu imagen original (con moneda y café), con una animación de rebote.
- Cualquiera de estos sprites se puede reemplazar por un PNG propio: ver más abajo.

## Usar tus propias imágenes

Todos los PNG son **opcionales**: si falta alguno se usa el dibujo por código. Van en `public/`:

```
public/pig/run-1.png ... run-4.png   fotogramas de carrera (hacen falta los 4)
public/pig/jump.png                  pose de salto (opcional)
public/pig/menu.png                  imagen del menú (ya incluida)
public/traps/banana.png              cáscara de banana
public/traps/bird-1.png, bird-2.png  pájaro (hacen falta los 2: son el aleteo)
public/traps/ball.png                pelota
```

Con fondo transparente y mirando hacia la derecha.

**Trampas** (`public/traps/`): a cada imagen se le recorta solo el margen transparente y se escala
para entrar en su caja sin deformarse, así que podés exportarlas centradas en un lienzo grande sin
preocuparte. El tamaño resultante es el que usa la colisión, por lo que el golpe siempre coincide con
lo que se ve, y como nunca se agranda más allá de la caja, cambiar una imagen no vuelve el juego más
difícil. Las cajas están en `sprites.ts`:

| Trampa | Caja | Notas |
|---|---|---|
| `banana.png` | `BANANA_W` x `BANANA_H` = 54 x 32 | apoya sobre la vereda |
| `bird-1.png` / `bird-2.png` | `BIRD_W` x `BIRD_H` = 58 x 44 | se alternan para el aleteo |
| `ball.png` | `BALL_SIZE` = 40 x 40 | rota al rebotar, conviene que sea redonda y centrada |

**Los dos fotogramas del pájaro se recortan con una caja común** (la unión de ambos), no cada uno por
su cuenta: si no, el pájaro saltaría de posición al aletear. Por eso tienen que venir exportados con
el mismo tamaño de lienzo; si no coinciden, se usan sin recortar. Lo mismo vale para los fotogramas
del chanchito, que además se usan siempre sin recortar.

La pelota puede no ser cuadrada (se ajusta sin deformar), y el radio con el que choca sale de su lado
más corto para que nunca golpee fuera del dibujo. El pájaro bajo se ancla por su borde inferior y el
alto por su centro, así una imagen de otra altura no cambia si se puede pasar por debajo o no.

Agregar otra imagen propia es una línea: `loadImage()` + `containFrames()` en `sprites.ts`, como hace
`loadCustomTraps()`. La moneda todavía no se puede reemplazar: son 4 fotogramas de giro que habría que
exportar coherentes entre sí.

> El recorte automático necesita leer los píxeles del PNG. En Capacitor los assets se sirven desde el
> mismo origen que la app, así que funciona; si algún día no pudiera leerlos, usa la imagen completa
> en vez de fallar.

## Ajustar la jugabilidad

Todo está en `CFG` al inicio de `src/app/game/engine.ts`:

```ts
gravity, jumpVelocity     // física del salto
startSpeed, maxSpeed, accel // velocidad y cuánto acelera
coinPoints                // puntos por moneda
maxHits, invulnSeconds    // golpes para perder / tiempo de gracia
obstacleGap, coinGap      // segundos (aleatorios) entre trampas / grupos de monedas
```

Puntaje final = metros recorridos + monedas × `coinPoints`.

## Estructura

```
src/app/
  game/
    engine.ts      motor: física, spawns, colisiones, HUD, render (sin dependencias de Angular)
    sprites.ts     sprites y capas de parallax dibujados por código + carga de PNG opcionales
    rng.ts         aleatorio con semilla (partidas reproducibles para pruebas)
  pages/           menu · register · game · scores
  services/        db.service (SQLite) · session.service (jugador actual)
```

El motor no depende de Angular: si más adelante querés pasar a Three.js u otro render,
solo se reemplaza `render()`/`sprites.ts`; la lógica queda igual.

## Rendimiento en celular

El cuello de botella era el parallax: las capas se dibujaban escaladas (tiles de 1500 px estirados
a ~2900 px) con `imageSmoothingQuality = 'high'`, siete veces por frame, sobre un lienzo de 3x.
Medido en Chromium con rasterizado forzado, un frame tardaba **594 ms**; ahora tarda **~6 ms**.

Qué se cambió, en orden de impacto:

1. **Blit 1:1.** Los tiles se generan a la misma cantidad de píxeles con la que se dibujan
   (`sprites.makeLayers(scale)`, que el motor llama desde `resize()`), así `drawImage` copia sin
   escalar ni filtrar. De paso el fondo se ve más nítido que antes.
2. **Recorte al área visible.** Cada tile se dibuja con la forma de 9 argumentos de `drawImage`,
   pasando solo la porción que cae dentro del lienzo, en vez del tile entero.
3. **Franjas verticales.** Cada capa declara la banda que realmente ocupa (`top` / `height`) y el
   bitmap cubre solo esa franja. En promedio se mueve un 55% de los píxeles.
4. **Menos capas: de 7 a 5.** Nubes y estrellas van juntas; calle, vereda, farolas y árboles también
   (comparten el mismo factor de parallax).
5. **Tope de resolución.** `MAX_RENDER_SCALE = 2` y `MAX_CANVAS_PX`: los celulares reportan hasta 3,
   y dibujar a 3x triplica el relleno sin diferencia visible en un juego 2D. El lienzo se escala por
   CSS, que es gratis porque lo hace la GPU.
6. **Cielo pre-renderizado.** Rellenar el gradiente a pantalla completa cada frame costaba tanto
   como todo el parallax junto; ahora es un lienzo estático que se copia.
7. **Menos basura por frame.** Los arrays de obstáculos, monedas y popups solo se filtran cuando
   hay algo para sacar, para no generar un array nuevo en cada frame.
8. Los bitmaps del fondo (~26 MB) se liberan en `destroy()` al salir de la pantalla de juego.

Si querés más nitidez a costa de velocidad, subí `MAX_RENDER_SCALE` en `engine.ts`.
Si algún equipo viejo sigue trabado, bajalo a 1.5.

Desglose actual por frame (Chromium, 844x390): parallax 4,6 ms · cielo 0,5 ms · sprites 0,5 ms ·
HUD 0,2 ms. La simulación (`advance`) no llega a 0,01 ms, así que la física nunca fue el problema.

## Estado de verificación

Probado de verdad:
- Rendimiento medido en Chromium forzando el rasterizado (`getImageData`): 594 ms -> ~6 ms por frame.
  Tras optimizar, la simulación da resultados idénticos (mismos golpes, mismos puntajes), así que el
  comportamiento del juego no cambió.
- El motor (`engine.ts`, `sprites.ts`) compila en modo estricto y corre en Chromium headless: parallax,
  los 3 tipos de trampa, monedas, pérdida con 3 golpes, pausa y un bot que sobrevive 60 s.
- `db.service.ts` se probó contra un SQLite real (simulando el plugin): inserción, orden, límite y
  consultas parametrizadas, además del modo `localStorage`.

**No** se pudo probar (el entorno donde se escribió no tenía acceso a npm): `npm install`, `ng build`,
`npx cap sync` ni el APK en un dispositivo. Las versiones del `package.json` usan rangos (`^20`, `^7`).
Si `ng build` marca algún error de tipos o de versión en las páginas Angular o en `angular.json`,
es lo primero a revisar.

## Pendientes / ideas

- Ícono y splash propios (`@capacitor/assets`).
- Botón "atrás" de Android durante la partida (plugin `@capacitor/app`).
- Sonidos y música.
- Evitar repetir el mismo correo en el ranking (hoy cada partida es una fila).
