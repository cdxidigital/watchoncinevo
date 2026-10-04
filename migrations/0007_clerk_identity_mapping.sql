-- Staged Clerk migration: preserve Better Auth user ids while linking
-- verified Clerk subjects. This is additive and reversible until cutover.
create table if not exists cinevo_clerk_identity (
  clerk_user_id text primary key,
  internal_user_id text not null unique references "user" ("id") on delete cascade,
  email text not null,
  status text not null default 'active' check (status in ('active', 'conflict', 'revoked')),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create index if not exists cinevo_clerk_identity_internal_idx
  on cinevo_clerk_identity (internal_user_id);
