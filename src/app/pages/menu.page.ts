import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-menu',
  imports: [RouterLink],
  template: `
    <main class="page">
      <section class="menu">
        <div class="hero">
          <img class="mascot" src="pig/menu.png" alt="Mascota Yapas" draggable="false" />
          <div class="ground-shadow" aria-hidden="true"></div>
        </div>

        <div class="side">
          <h1>Yapi<br />Runner</h1>
          <div class="buttons">
            <button type="button" class="btn big" routerLink="/registro">▶ Jugar</button>
            <button type="button" class="btn big secondary" routerLink="/puntajes">🏆 Puntajes</button>
          </div>
        </div>
      </section>
    </main>
  `,
  styles: `
    .menu {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      text-align: center;
      width: 100%;
      max-width: 760px;
    }
    .hero {
      position: relative;
      width: min(52vw, 40vh, 280px);
      aspect-ratio: 720 / 836;
      flex: none;
    }
    .mascot {
      position: relative;
      z-index: 1;
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
      transform-origin: 50% 100%;
      animation: bounce 1.1s ease-in-out infinite;
      filter: drop-shadow(0 6px 6px rgba(120, 50, 20, 0.18));
    }
    .ground-shadow {
      position: absolute;
      left: 22%;
      right: 22%;
      bottom: 1%;
      height: 5%;
      border-radius: 50%;
      background: radial-gradient(closest-side, rgba(90, 40, 20, 0.28), rgba(90, 40, 20, 0));
      animation: shadow 1.1s ease-in-out infinite;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.9rem, 7vw, 3.1rem);
      line-height: 1.02;
      color: #fff;
      text-shadow: 0 3px 0 var(--accent-dark), 0 7px 14px rgba(120, 50, 20, 0.28);
      letter-spacing: 0.5px;
    }
    .buttons {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-top: 12px;
      width: min(280px, 80vw);
    }
    .big {
      font-size: 1.3rem;
      padding: 15px 28px;
    }
    @keyframes bounce {
      0%, 100% { transform: translateY(0) scale(1.02, 0.97); }
      50% { transform: translateY(-4%) scale(0.99, 1.02); }
    }
    @keyframes shadow {
      0%, 100% { transform: scaleX(1); opacity: 1; }
      50% { transform: scaleX(0.8); opacity: 0.65; }
    }
    /* Celular acostado: mascota a la izquierda, título y botones a la derecha */
    @media (orientation: landscape) and (max-height: 520px) {
      .menu { flex-direction: row; justify-content: center; gap: 36px; }
      .hero { width: min(46vh, 40vw, 280px); }
      h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); }
      .buttons { margin-top: 14px; }
    }
  `,
})
export class MenuPage {}
