import { expect, vi, type Mock } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Drizzle select() mock + SQL renderer, shared by the mock-level DAL/authz
 * suites. The db client itself is never imported (AGENTS.md §6 boundary); each
 * test file keeps its own `vi.hoisted` + `vi.mock("@/db/db", …)` — vitest
 * hoists those per-module — and passes the hoisted `select` spy in here.
 */

export type SelectChain = {
  from: Mock;
  innerJoin: Mock;
  where: Mock;
  orderBy: Mock;
  limit: Mock;
};

const dialect = new PgDialect();

/**
 * Chainable select() mock resolving to `rows`, wired onto `selectFn`. Both
 * orderBy and limit resolve to `rows` so either terminal (list vs. single-row)
 * works; the where() argument is captured for predicate assertions. The chain
 * is itself thenable (like a real drizzle query builder), so a query that
 * terminates at `.where()` — no orderBy/limit — also resolves to `rows`.
 */
export function makeSelectChain(selectFn: Mock, rows: unknown[]): SelectChain {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    // Thenable: `await db.select()...where()` resolves to rows.
    then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: unknown) =>
      Promise.resolve(rows).then(onFulfilled, onRejected as never),
  } as unknown as SelectChain;
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(rows);
  chain.limit.mockResolvedValue(rows);
  selectFn.mockReturnValue(chain);
  return chain;
}

/** Renders the captured where() SQL to `{ sql, params }` for assertions. */
export function renderedWhere(chain: SelectChain) {
  expect(chain.where).toHaveBeenCalledOnce();
  return dialect.sqlToQuery(chain.where.mock.calls[0]![0] as SQL);
}

/** Renders a captured SQL fragment (e.g. an update's where) to `{ sql, params }`. */
export function renderedSql(sql: SQL) {
  return dialect.sqlToQuery(sql);
}

/** The captured `db.update(table).set(payload).where(cond)` of one update. */
export type UpdateCall = { table: unknown; set: unknown; where?: SQL };

/**
 * update() mock wired onto `updateFn`, capturing `.set()`/`.where()`.
 * `.returning()` resolves to `returningRows` (awaited inside a `db.transaction`
 * — see `makeTransaction`). Empty `returningRows` models a 0-row update (row
 * not in the caller's org → NotFound).
 */
export function captureUpdate(
  updateFn: Mock,
  returningRows: unknown[] = [],
): UpdateCall {
  const record: UpdateCall = { table: undefined, set: undefined };
  updateFn.mockImplementation((table: unknown) => {
    record.table = table;
    const chain = {
      set(payload: unknown) {
        record.set = payload;
        return chain;
      },
      where(cond: SQL) {
        record.where = cond;
        return chain;
      },
      returning: () => Promise.resolve(returningRows),
    };
    return chain;
  });
  return record;
}

/** The captured `db.delete(table).where(cond)` of one delete. */
export type DeleteCall = { table: unknown; where?: SQL };

/**
 * delete() mock wired onto `deleteFn`, capturing `.where()`. `.returning()`
 * resolves to `returningRows` (awaited inside a `db.transaction`). Empty
 * `returningRows` models a 0-row delete (row not in the caller's org → NotFound).
 */
export function captureDelete(
  deleteFn: Mock,
  returningRows: unknown[] = [],
): DeleteCall {
  const record: DeleteCall = { table: undefined };
  deleteFn.mockImplementation((table: unknown) => {
    record.table = table;
    const chain = {
      where(cond: SQL) {
        record.where = cond;
        return chain;
      },
      returning: () => Promise.resolve(returningRows),
    };
    return chain;
  });
  return record;
}

/**
 * transaction() mock: `db.transaction(cb)` invokes `cb(tx)` with a tx handle
 * exposing the same insert/update/delete spies the test wired (via
 * captureUpdate/captureDelete/captureInserts), so writes issued through `tx`
 * inside the DAL are captured exactly as before. The callback's promise is
 * returned verbatim, so a `throw` inside it (0-row → NotFoundError) rejects the
 * transaction — mirroring the driver's rollback-on-throw.
 */
export function makeTransaction(transactionFn: Mock, tx: unknown) {
  transactionFn.mockImplementation((cb: (tx: unknown) => unknown) =>
    Promise.resolve(cb(tx)),
  );
}

/** One captured `db.insert(table).values(payload)` call. */
export type InsertCall = { table: unknown; values: unknown };

/**
 * insert() mock wired onto `insertFn`, recording every
 * `db.insert(table).values(payload)`. The returned array fills as inserts run.
 * `values()` yields a thenable (so an audit insert can be `await`ed directly)
 * that also exposes `.returning()` resolving to `returningRows` (so a
 * `.returning()` create path gets its row) and `.onConflictDoNothing()`
 * (chainable, for idempotent upserts). All paths share `returningRows`.
 */
export function captureInserts(
  insertFn: Mock,
  returningRows: unknown[] = [],
): InsertCall[] {
  const calls: InsertCall[] = [];
  insertFn.mockImplementation((table: unknown) => {
    const record: InsertCall = { table, values: undefined };
    return {
      values(payload: unknown) {
        record.values = payload;
        calls.push(record);
        const thenable = Promise.resolve(returningRows) as Promise<
          unknown[]
        > & {
          returning: () => Promise<unknown[]>;
          onConflictDoNothing: () => typeof thenable;
        };
        thenable.returning = () => Promise.resolve(returningRows);
        thenable.onConflictDoNothing = () => thenable;
        return thenable;
      },
    };
  });
  return calls;
}
