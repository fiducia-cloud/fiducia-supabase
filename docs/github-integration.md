# Supabase GitHub integration runbook

For each project, connect the Supabase GitHub App to the repository and branch
declared in `target.json`. Set **Working directory** to
`projects/<project-ref>`—not to the nested `supabase/` directory.

## Safe activation sequence

1. Confirm the project ref, organization, repository, branch, and working
   directory from `target.json`.
2. Pull the live database baseline with the pinned Supabase CLI and review the
   generated migration. Never put the database password or connection string in
   Git, a command argument, a ticket, or chat.
3. Reconcile the baseline against the catalogued contract source. Record
   deliberate RDS/Supabase differences instead of forcing parity.
4. Run migration replay, RLS/grant negative tests, schema validation, and secret
   scanning. Protect `main` and require the validation check.
5. Connect the GitHub repository with automatic branching and **Supabase changes
   only** enabled. Keep production deployment disabled during the first preview.
6. Prove a preview branch applies the migration and report the provider result
   on the exact pull-request head.
7. Enable production deployment only after a no-op/baseline deployment,
   production catalog read-back, and a documented forward-fix/restore path.
8. Record the verified timestamp, source commit, and migration head, then change
   the target state from `planned` to `connected`.

Supabase deploys new migrations, configured Edge Functions, and declared
Storage buckets to production. Auth, API, and seed configuration are not
production-deployed by default; verify provider behavior rather than assuming
the local configuration controls hosted Auth.

