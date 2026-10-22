// Where rooms are saved so a game survives a refresh, a dropped connection or
// a server restart. One document per room holding the whole room (game state
// included); every change rewrites it, so a room is always saved as a whole —
// there is no partial update to go wrong. Saves are coalesced per room.
//
//   FileStore  — JSON files in a folder (default; zero setup for local dev)
//   MongoStore — MongoDB via mongoose when MONGODB_URI is set
//   MemoryStore — tests
//
// Limitation: a save happens a moment after the change (SAVE_DELAY_MS); a crash
// in that window loses the last action. On Heroku the file system is wiped on
// every restart, so use MongoStore there if games must survive restarts.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedRoom } from '../rooms/roomManager.js';

export interface RoomStore {
  loadAll(): Promise<SavedRoom[]>;
  save(room: SavedRoom): Promise<void>;
  remove(code: string): Promise<void>;
  close?(): Promise<void>;
}

const SAVE_DELAY_MS = 150;

/** Coalesce rapid changes to the same room into one write; never let a save throw. */
export function saver(store: RoomStore, log: Pick<Console, 'error'> = console) {
  const pending = new Map<string, SavedRoom | null>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const flushOne = async (code: string) => {
    timers.delete(code);
    const room = pending.get(code);
    pending.delete(code);
    try {
      if (room) await store.save(room);
      else await store.remove(code);
    } catch (err) {
      log.error(`[store] saving room ${code} failed:`, err);
    }
  };
  return {
    push(item: SavedRoom | { code: string; deleted: true }) {
      pending.set(item.code, 'deleted' in item ? null : item);
      if (!timers.has(item.code)) timers.set(item.code, setTimeout(() => void flushOne(item.code), SAVE_DELAY_MS));
    },
    async flush() {
      for (const [code, t] of timers) {
        clearTimeout(t);
        await flushOne(code);
      }
    },
  };
}

export class MemoryStore implements RoomStore {
  rooms = new Map<string, SavedRoom>();
  async loadAll() { return [...this.rooms.values()].map((r) => structuredClone(r)); }
  async save(room: SavedRoom) { this.rooms.set(room.code, structuredClone(room)); }
  async remove(code: string) { this.rooms.delete(code); }
}

export class FileStore implements RoomStore {
  constructor(private dir: string) {}

  private file(code: string) {
    return path.join(this.dir, `${code.replace(/[^A-Z]/g, '')}.json`);
  }

  async loadAll(): Promise<SavedRoom[]> {
    await mkdir(this.dir, { recursive: true });
    const out: SavedRoom[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await readFile(path.join(this.dir, f), 'utf8')));
      } catch {
        // a half-written or corrupt file: skip it rather than refuse to start
      }
    }
    return out;
  }

  async save(room: SavedRoom) {
    await mkdir(this.dir, { recursive: true });
    // write in place with retries: renames are unreliable inside synced folders (OneDrive locks)
    const body = JSON.stringify(room);
    for (let attempt = 0; ; attempt++) {
      try {
        await writeFile(this.file(room.code), body, 'utf8');
        return;
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  }

  async remove(code: string) {
    await rm(this.file(code), { force: true });
  }
}

export class MongoStore implements RoomStore {
  private model: any;
  private mongoose: any;

  static async connect(uri: string): Promise<MongoStore> {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(uri);
    const schema = new mongoose.Schema(
      { code: { type: String, unique: true, index: true }, data: { type: mongoose.Schema.Types.Mixed } },
      { timestamps: true, minimize: false },
    );
    const store = new MongoStore();
    store.mongoose = mongoose;
    store.model = mongoose.models.OkocRoom ?? mongoose.model('OkocRoom', schema, 'rooms');
    return store;
  }

  async loadAll(): Promise<SavedRoom[]> {
    const docs = await this.model.find({}).lean();
    return docs.map((d: { data: SavedRoom }) => d.data);
  }

  async save(room: SavedRoom) {
    await this.model.updateOne({ code: room.code }, { $set: { data: room } }, { upsert: true });
  }

  async remove(code: string) {
    await this.model.deleteOne({ code });
  }

  async close() {
    await this.mongoose.disconnect();
  }
}
