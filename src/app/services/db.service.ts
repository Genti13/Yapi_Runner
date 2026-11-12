import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

export interface ScoreRow {
  id: number;
  name: string;
  email: string;
  score: number;
  /** Metros recorridos. */
  distance: number;
  coins: number;
  /** Fecha ISO. */
  createdAt: string;
}

export type NewScore = Omit<ScoreRow, 'id' | 'createdAt'>;

export type StorageMode = 'pending' | 'sqlite' | 'localStorage';

const DB_NAME = 'chanchito_runner';
const LS_KEY = 'chanchito.scores.v1';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    score      INTEGER NOT NULL,
    distance   INTEGER NOT NULL,
    coins      INTEGER NOT NULL,
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scores_score ON scores (score DESC);
`;

interface DbRow {
  id: number;
  name: string;
  email: string;
  score: number;
  distance: number;
  coins: number;
  created_at: string;
}

/**
 * Puntajes persistidos en SQLite dentro del teléfono (plugin @capacitor-community/sqlite).
 * En el navegador (`ng serve`) el plugin no está disponible, así que se usa localStorage
 * con la misma interfaz para poder desarrollar y probar sin un dispositivo.
 */
@Injectable({ providedIn: 'root' })
export class DbService {
  /** Con qué almacenamiento se está trabajando realmente (útil para mostrarlo en pantalla). */
  readonly mode = signal<StorageMode>('pending');

  private db?: SQLiteDBConnection;
  private ready?: Promise<void>;

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.open().catch((err) => {
        this.ready = undefined; // permite reintentar
        throw err;
      });
    }
    return this.ready;
  }

  async addScore(entry: NewScore): Promise<void> {
    await this.init();
    const createdAt = new Date().toISOString();
    if (this.db) {
      await this.db.run(
        'INSERT INTO scores (name, email, score, distance, coins, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [entry.name, entry.email, entry.score, entry.distance, entry.coins, createdAt],
      );
      return;
    }
    const all = this.readLocal();
    const id = all.reduce((max, r) => Math.max(max, r.id), 0) + 1;
    all.push({ ...entry, id, createdAt });
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  }

  async topScores(limit = 50): Promise<ScoreRow[]> {
    await this.init();
    if (this.db) {
      const res = await this.db.query(
        `SELECT id, name, email, score, distance, coins, created_at
           FROM scores
          ORDER BY score DESC, created_at ASC
          LIMIT ?`,
        [limit],
      );
      return ((res.values ?? []) as DbRow[]).map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        score: r.score,
        distance: r.distance,
        coins: r.coins,
        createdAt: r.created_at,
      }));
    }
    return this.readLocal()
      .sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  /* ------------------------------ internos ------------------------------ */

  private async open(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.mode.set('localStorage');
      return;
    }

    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const consistent = (await sqlite.checkConnectionsConsistency()).result === true;
    const exists = (await sqlite.isConnection(DB_NAME, false)).result === true;

    const db =
      consistent && exists
        ? await sqlite.retrieveConnection(DB_NAME, false)
        : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

    await db.open();
    await db.execute(SCHEMA);
    this.db = db;
    this.mode.set('sqlite');
  }

  private readLocal(): ScoreRow[] {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as ScoreRow[]) : [];
    } catch {
      return [];
    }
  }
}
