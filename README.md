# fiducia-supabase

Git-backed Supabase provider overlays for [`fiducia-cloud`](https://supabase.com/dashboard/org/mkwkyvjiprtmdepshkys), mapped to [`fiducia-cloud`](https://github.com/fiducia-cloud).

Two Supabase projects intentionally share this repository through distinct working directories. Either project can later move to another `fiducia-cloud/*-supabase` repository by changing exactly one provider target.

## Project inventory

| Project ref | Local slug | Canonical | Provider status | Git working directory | Integration |
|---|---|---:|---|---|---|
| `tsghmyixghclfmmvptln` | `fiducia-cloud-main` | yes | active | `projects/tsghmyixghclfmmvptln` | planned |
| `ruxctrzdvugxztbjcpoi` | `fiducia-cloud-secondary` | no | active | `projects/ruxctrzdvugxztbjcpoi` | planned |

The catalog is `catalog.json`; each hosted project has a machine-readable `target.json`. Project refs and organization refs are public routing identifiers, not credentials. Database passwords, connection URLs, tokens, keys, data, and dumps never belong in this repository.

## Authority

- Cross-database persistence contracts: the target's `contractSource`, preferring `*-lib-core`.
- Supabase-only provider overlays: this repository.
- Explicit convergence and drift analysis: [`declarative-migrations/declarative-postgres-migrate.rs`](https://github.com/declarative-migrations/declarative-postgres-migrate.rs).
- Fleet target registry and verification: [`ORESoftware/k8s-libs-and-shared-defs`](https://github.com/ORESoftware/k8s-libs-and-shared-defs).
- API, authentication, and synchronization dependencies remain owned by [`ORESoftware/api-docs`](https://github.com/ORESoftware/api-docs), [`shared-auth`](https://github.com/shared-auth), and [`opto-sync`](https://github.com/opto-sync).

Supabase and AWS RDS Postgres may be intentionally out of step. No automated job treats catalog equality as an invariant.

## Current gate

All discovered targets begin in `planned`. Production deployment is disabled until a reviewed `supabase db pull` baseline, contract-source readiness, migration/RLS tests, branch protection, exact repository/working-directory verification, provider preview, and production read-back are recorded.

## Shared fleet contract

`shared-defs.lock.json` pins contract version `1.0.0` and immutable commit
`33bd1bec3f1044cc973e3fdc18b6864762d2a097` from
`ORESoftware/k8s-libs-and-shared-defs`. Validation compares normalized schema
digests, so local schema identifiers may remain relative while their behavior
cannot drift from the reviewed fleet contract. The Zed coordinate is
`oresoftware/supabase-gitops-contract`.

Run:

```sh
just validate
```

See `docs/architecture.md`, `docs/schema-authority.md`, and `docs/github-integration.md`.
