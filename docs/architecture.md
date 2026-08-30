# Architecture

This repository separates three related but non-identical concerns:

1. The product `*-lib-core` (or catalogued fallback `*-lib`) owns the reviewed,
   cross-runtime persistence contract and declarative desired state.
2. This repository owns project-specific Supabase provider overlays and the
   exact tree watched by the Supabase GitHub App.
3. `ORESoftware/k8s-libs-and-shared-defs` records the fleet-level mapping,
   digests, and verification evidence.

The split allows Supabase Postgres and AWS RDS Postgres to evolve at different
rates. A table may exist in one database before the other, and Supabase-only
RLS/Auth/Storage objects need not exist in RDS. Drift is intentional only when
it is declared and reviewed. `declarative-migrations/declarative-postgres-migrate.rs`
is the convergence engine when a change is meant to cross the boundary.

Each Supabase project is isolated by its stable project reference. It gets its
own migration sequence, configuration, functions, baseline evidence, and Git
integration working directory. This prevents a commit for one project from
silently mutating another project's database.

The repository state machine is fail closed:

```text
planned --baseline + contract + protected branch + provider read-back--> connected
connected --operator/provider suspension--------------------------------> paused
paused ----fresh verification-------------------------------------------> connected
```

`connected` is rejected by validation unless the baseline and contract source
are verified. Production deployment is rejected unless the target is already
connected with a verified baseline.

