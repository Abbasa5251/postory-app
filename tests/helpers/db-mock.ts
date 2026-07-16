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
  where: Mock;
  orderBy: Mock;
  limit: Mock;
};

const dialect = new PgDialect();

/**
 * Chainable select() mock resolving to `rows`, wired onto `selectFn`. Both
 * orderBy and limit resolve to `rows` so either terminal (list vs. single-row)
 * works; the where() argument is captured for predicate assertions.
 */
export function makeSelectChain(selectFn: Mock, rows: unknown[]): SelectChain {
  const chain: SelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
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
