# Server actions

Every mutation is authored through **`withAction`** (ADR-013 / AGENTS.md §7). It
runs the standardized front of the pipeline and maps every failure to a typed
`ActionResult`, so actions never leak raw errors and forms always get structured
field errors.

## Writing an action

```ts
"use server";
import { withAction } from "@/server/actions";
import { createBrandSchema } from "@/lib/validation/brands";

export const createBrand = withAction(
  createBrandSchema, // 1. VALIDATE  — zod-parsed from `unknown`
  "brand:create", //    2. AUTHENTICATE (getAuthCtx) + 3. AUTHORIZE (coarse gate)
  async (data, ctx) => {
    // 4-7. YOUR job: scoped DAL fetch, domain rules, persist + audit_log,
    //      revalidatePath. `data` is validated; `ctx` is the member context.
    const brand = await dal.brands.create(ctx, data);
    revalidatePath("/brands");
    return { id: brand.id }; // minimal data — never raw rows with other-tenant refs
  },
);
```

`withAction(schema, permission, handler)` returns an RPC-style action
`(input: unknown) => Promise<ActionResult<T>>`. The handler owns everything after
authorization — the wrapper does **not** own `audit_log` writes or
`revalidatePath` (§7 keeps those in the handler/DAL).

## The result contract

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };
```

Failures never throw to the caller (except unexpected ones in development):

| Cause | `code` | Notes |
|---|---|---|
| zod parse failed | `VALIDATION` | carries `fieldErrors` for forms |
| `getAuthCtx` found no session/org | `UNAUTHORIZED` | not reported |
| `authorize` denied the role | `FORBIDDEN` | it's a `DomainError` |
| any `DomainError` (`NotFoundError`, future `EntitlementError`, …) | `err.code` | user-safe `message`; not reported |
| anything unexpected | `INTERNAL` | reported to Sentry + `log.error`; **re-thrown in dev**, generic message in prod |

Cross-org / unassigned-brand access is `NOT_FOUND`, never `FORBIDDEN` — the
product never reveals another tenant's existence (§7).

## Calling from a form (`useActionState`)

`withAction` is RPC-style (takes a typed object). React 19's `useActionState`
wants `(prevState, formData)`, so adapt at the form with a one-liner:

```ts
const [state, formAction] = useActionState(
  (_prev, fd: FormData) => createBrand(Object.fromEntries(fd)),
  null,
);
```

When the first real form lands (Epic B/C), extract this into a shared
`toFormAction(action)` helper — deferred until a real consumer shapes it.

## Testing

`withAction` is unit-tested in `tests/unit/server/with-action.test.ts`: the
session (`getAuthCtx`) and the observability module are mocked; `authorize`,
zod, and the error mapping run for real. New actions get their role×permission
cases in `tests/authz` per `tests/authz/README.md`.
