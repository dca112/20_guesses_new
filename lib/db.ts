import { createClient, type Client, type InArgs, type Transaction } from "@libsql/client";
import { SCHEMA } from "./schema";

/**
 * Turso / libSQL connection.
 *
 *  TURSO_DATABASE_URL  e.g. libsql://my-db-org.turso.io  (defaults to a local file for dev)
 *  TURSO_AUTH_TOKEN    Turso auth token (not needed for local files)
 */
type DbGlobal = {
  client?: Client;
  ready?: Promise<void>;
  lock?: Promise<unknown>;
};
const g = globalThis as unknown as { __twentyGuessesDb?: DbGlobal };
const state: DbGlobal = (g.__twentyGuessesDb ??= {});

function makeClient(): Client {
  const url = process.env.TURSO_DATABASE_URL || "file:local.db";
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
}

export async function migrate(client: Client): Promise<void> {
  await client.batch(SCHEMA, "write");
}

export async function getDb(): Promise<Client> {
  if (!state.client) state.client = makeClient();
  if (!state.ready) {
    state.ready = migrate(state.client).catch((err) => {
      state.ready = undefined;
      throw err;
    });
  }
  await state.ready;
  return state.client;
}

/** Test hook: replace the client (e.g. with an in-memory database). */
export function setDbForTests(client: Client): void {
  state.client = client;
  state.ready = undefined;
}

function isBusy(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  const code = String((err as { code?: string })?.code ?? "");
  return /SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(msg + code);
}

/**
 * Runs `fn` inside a serialisable write transaction (BEGIN IMMEDIATE).
 * Writes within one server process are queued through an in-memory mutex,
 * and lock contention across processes/instances is retried with backoff.
 * Either everything in `fn` commits or nothing does.
 */
export async function withTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const db = await getDb();
  const run = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      let tx: Transaction | undefined;
      try {
        tx = await db.transaction("write");
        const result = await fn(tx);
        await tx.commit();
        return result;
      } catch (err) {
        if (tx && !tx.closed) {
          try {
            await tx.rollback();
          } catch {
            /* ignore */
          }
        }
        if (isBusy(err) && attempt < 8) {
          await new Promise((r) => setTimeout(r, 25 * 2 ** attempt + Math.random() * 25));
          continue;
        }
        throw err;
      } finally {
        tx?.close();
      }
    }
  };
  const prev = state.lock ?? Promise.resolve();
  const next = prev.then(run, run);
  state.lock = next.catch(() => undefined);
  return next;
}

export type Executor = Pick<Transaction, "execute">;

export async function all<T = Record<string, unknown>>(
  ex: Executor,
  sql: string,
  args: InArgs = [],
): Promise<T[]> {
  const rs = await ex.execute({ sql, args });
  return rs.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(
  ex: Executor,
  sql: string,
  args: InArgs = [],
): Promise<T | undefined> {
  const rows = await all<T>(ex, sql, args);
  return rows[0];
}

export async function run(
  ex: Executor,
  sql: string,
  args: InArgs = [],
): Promise<number> {
  const rs = await ex.execute({ sql, args });
  return rs.rowsAffected;
}
