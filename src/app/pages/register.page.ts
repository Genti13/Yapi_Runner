import { Component, inject } from '@angular/core';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SessionService } from '../services/session.service';

function minTrimmed(min: number) {
  return (c: AbstractControl): ValidationErrors | null =>
    String(c.value ?? '').trim().length >= min ? null : { minTrimmed: { min } };
}

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="page">
      <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <h2>¿Quién juega?</h2>
        <p class="hint">Tu nombre y correo se guardan con tu puntaje en el ranking.</p>

        <label>
          Nombre
          <input
            type="text"
            formControlName="name"
            autocomplete="nickname"
            maxlength="24"
            placeholder="Ej: Chanchito"
          />
        </label>
        @if (form.controls.name.touched && form.controls.name.invalid) {
          <p class="error">Ingresá un nombre de al menos 2 letras.</p>
        }

        <label>
          Correo
          <input
            type="email"
            formControlName="email"
            autocomplete="email"
            inputmode="email"
            placeholder="tucorreo@ejemplo.com"
          />
        </label>
        @if (form.controls.email.touched && form.controls.email.invalid) {
          <p class="error">Ingresá un correo válido.</p>
        }

        <div class="actions">
          <a class="btn secondary" routerLink="/">Volver</a>
          <button class="btn" type="submit">¡A correr!</button>
        </div>
      </form>
    </main>
  `,
  styles: `
    h2 { margin: 0 0 4px; font-size: 1.6rem; }
    .hint { margin: 0 0 14px; color: #7a5f58; font-size: 0.95rem; }
    label { display: block; font-weight: 700; margin-top: 10px; }
    input {
      display: block;
      width: 100%;
      margin-top: 6px;
      padding: 13px 14px;
      font-size: 1.05rem;
      border: 2px solid #ecd9c0;
      border-radius: 14px;
      background: #fff;
      color: var(--ink);
      -webkit-user-select: text;
      user-select: text;
    }
    input:focus { outline: none; border-color: var(--accent); }
    .error { margin: 6px 2px 0; color: #c62840; font-size: 0.9rem; font-weight: 600; }
    .actions { display: flex; gap: 12px; justify-content: space-between; margin-top: 22px; }
    .actions .btn { text-align: center; text-decoration: none; padding: 13px 22px; }
  `,
})
export class RegisterPage {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  readonly form = this.fb.group({
    name: [this.session.player()?.name ?? '', [Validators.required, Validators.maxLength(24), minTrimmed(2)]],
    email: [
      this.session.player()?.email ?? '',
      [Validators.required, Validators.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)],
    ],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, email } = this.form.getRawValue();
    this.session.set({ name: name.trim(), email: email.trim().toLowerCase() });
    void this.router.navigateByUrl('/juego');
  }
}
