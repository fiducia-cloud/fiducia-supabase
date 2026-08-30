# Agent guidance — Supabase provider overlays

This repository is the Git-backed provider-overlay boundary for one GitHub
organization's Supabase projects. Read the repository-root `README.md`,
`catalog.json`, and each changed `projects/<project-ref>/target.json` before
editing a project.

## Authority boundaries

- The product's `*-lib-core` repository is the preferred human-authored
  persistence-contract authority. `*-lib` is the fallback only where the
  catalog explicitly says so.
- This repository owns Supabase-specific deployment material: ordered
  migrations, RLS and grant overlays, Auth/Storage/Realtime configuration, and
  Edge Functions for the mapped project.
- AWS RDS Postgres and Supabase Postgres may deliberately diverge. Never copy or
  synthesize DDL merely to make the catalogs identical. Reconciliation is an
  explicit, reviewed `declarative-migrations` operation with provenance.
- `ORESoftware/k8s-libs-and-shared-defs` is the fleet registry and verifier, not
  a competing authoring or provider-deployment source.
- `ORESoftware/api-docs`, the `shared-auth` organization, and the `opto-sync`
  organization are contract consumers/dependencies. Do not vendor or silently
  redefine their contracts here.

## Project layout

Every Supabase project has a stable directory keyed by its 20-character project
reference:

```text
projects/<project-ref>/target.json
projects/<project-ref>/supabase/config.toml
projects/<project-ref>/supabase/migrations/
projects/<project-ref>/supabase/functions/
```

The Supabase GitHub integration working directory is
`projects/<project-ref>`—the parent containing `supabase/`. A future project may
map to a different repository in the same GitHub organization; record that
explicitly in its target and remove it from this repository's local-project
catalog instead of creating two provider writers.

## Safety and delivery

- Never commit database passwords, connection strings, API/service-role keys,
  access or refresh tokens, JWT signing keys, SMTP credentials, user data,
  production dumps, or decrypted environment files.
- Keep migrations append-only after publication. Do not renumber, rewrite, or
  delete a migration that any shared or hosted environment may have observed.
- Destructive DDL requires an expand/contract plan, backup/restore evidence, a
  forward-fix, and explicit review. Do not hide it in generated SQL.
- New tables and views must fail closed: explicit grants, RLS enabled where
  client roles can reach the object, and tenant/owner negative tests.
- Do not mark a target `connected` until its baseline, branch protection,
  required checks, provider repository/working-directory read-back, and exact
  production branch are verified. Do not enable production deployment for a
  merely scaffolded or partially reconciled target.
- Run `just validate` before committing. Stage explicit paths, fetch and merge
  without rebase, push, and publish reviewable work. Never use force-push,
  reset, stash, or destructive cleanup.

