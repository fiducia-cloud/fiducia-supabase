# Schema authority and controlled drift

The provider-overlay repository does not replace the product's `*-lib-core`.
The target records the contract source and its readiness independently from the
Supabase deployment tree.

Changes fall into one of four classes:

- **Cross-database contract:** author in `*-lib-core`, publish its reviewed
  contract, then derive reviewed RDS and Supabase migrations with provenance.
- **Supabase-only overlay:** author here when the object is specific to RLS,
  `auth.users`, Storage, Realtime, or an Edge Function.
- **RDS-only implementation:** author in the RDS migration authority and record
  that no Supabase convergence is intended.
- **Temporary drift:** record the difference, owner, and intended convergence
  event. Do not generate a destructive migration merely to erase the diff.

The shared systems have distinct jobs:

- `declarative-migrations` computes and verifies explicit convergence plans;
- `ORESoftware/api-docs` publishes API contracts rather than database DDL;
- `shared-auth` owns shared authentication behavior and boundaries;
- `opto-sync` owns cross-device/boundary synchronization behavior;
- `ORESoftware/k8s-libs-and-shared-defs` inventories and verifies fleet targets.

