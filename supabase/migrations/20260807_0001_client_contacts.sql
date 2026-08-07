-- Migration 1 — client_contacts: many emails/phones per client.
--
-- Why this exists: only 495 of 934 clients have `clients.email` and 358 have
-- `clients.phone`, and those columns are free text carrying MULTIPLE values —
-- "a@x.com,b@y.com", "9545101901 Owner 9823373138 Rahul", "8097629472 (Rakesh
-- Khandare)", and occasionally an email sitting in the phone column. Matching
-- inbound mail/calls against those columns directly would silently drop about
-- half of everything, so we derive a normalised contact table instead.
--
-- The derivation lives in Postgres (not TypeScript) and is kept current by a
-- trigger on `clients`, so the Excel import path stays in sync for free and the
-- parsing rules exist in exactly one place.

-- ---------------------------------------------------------------- helpers

-- App-code gates several pages on admin|partner; the DB had no equivalent.
create or replace function public.is_admin_or_partner()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select app_role in ('admin', 'partner') from staff where auth_user_id = auth.uid()),
    false
  )
$$;

-- Canonical form of an Indian mobile number: bare 10 digits, or null when the
-- input is not one. Handles a 0 trunk prefix and a 91 country code.
create or replace function public.normalize_phone(raw text)
returns text
language sql immutable
as $$
  select case
    when length(d) = 10 and left(d, 1) between '6' and '9' then d
    when length(d) = 11 and left(d, 1) = '0' and substr(d, 2, 1) between '6' and '9' then right(d, 10)
    when length(d) = 12 and left(d, 2) = '91' and substr(d, 3, 1) between '6' and '9' then right(d, 10)
    else null
  end
  from (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as d) t
$$;

create or replace function public.array_distinct(arr text[])
returns text[]
language sql immutable
as $$
  select coalesce(array(select distinct x from unnest(coalesce(arr, '{}')) x where x is not null), '{}')
$$;

create or replace function public.extract_emails(raw text)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}')
  from regexp_matches(
    coalesce(raw, ''),
    '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',
    'g'
  ) as m
$$;

-- Pulls every distinct valid mobile out of a free-text field. Two passes:
-- per-run (splits "7507916399/8600710653" and "9545101901 Owner 9823373138")
-- and whole-string (rejoins "91725 40614"). Invalid runs normalise to null and
-- drop out, so "776775786", "0" and "-" yield nothing.
create or replace function public.extract_phones(raw text)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(distinct p), '{}')
  from (
    select public.normalize_phone(m[1]) as p
    from regexp_matches(coalesce(raw, ''), '[0-9][0-9 \-]{8,}[0-9]', 'g') as m
    union all
    select public.normalize_phone(raw)
  ) t
  where p is not null
$$;

-- ---------------------------------------------------------------- table

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('email', 'phone')),
  value text not null,
  value_norm text not null,
  label text,
  is_primary boolean not null default false,
  -- 'import'  derived from clients.email/phone by the trigger below (managed)
  -- 'manual'  typed by a user
  -- 'learned' captured when a user assigned an unmatched inbox item
  source text not null default 'manual' check (source in ('import', 'manual', 'learned')),
  created_at timestamptz not null default now(),
  unique (client_id, kind, value_norm)
);

create index if not exists client_contacts_lookup
  on public.client_contacts (kind, value_norm);
create index if not exists client_contacts_client
  on public.client_contacts (client_id, kind);

alter table public.client_contacts enable row level security;

create policy client_contacts_select on public.client_contacts
  for select to authenticated
  using (is_admin() or has_allotment_on(client_id));

create policy client_contacts_write on public.client_contacts
  for all to authenticated
  using (is_admin() or has_allotment_on(client_id))
  with check (is_admin() or has_allotment_on(client_id));

-- ---------------------------------------------------------------- sync

-- Rebuilds the source='import' contacts for one client from clients.email /
-- clients.phone. Never touches 'manual' or 'learned' rows — those are the
-- user's, and the sheet must not clobber them (same principle as
-- clients.manual_fields in the import pipeline).
create or replace function public.sync_client_derived_contacts(cid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  c record;
  emails text[];
  phones text[];
begin
  select email, phone into c from clients where id = cid;
  if not found then
    return;
  end if;

  -- Emails are pulled from both columns: we found real addresses parked in the
  -- phone column. Phones are pulled only from the phone column — digit runs
  -- inside an email local-part are not phone numbers.
  emails := array_distinct(extract_emails(c.email) || extract_emails(c.phone));
  phones := array_distinct(extract_phones(c.phone));

  delete from client_contacts
   where client_id = cid
     and source = 'import'
     and not (
       (kind = 'email' and value_norm = any (emails)) or
       (kind = 'phone' and value_norm = any (phones))
     );

  insert into client_contacts (client_id, kind, value, value_norm, source, is_primary)
  select cid, 'email', e, e, 'import', e = emails[1]
  from unnest(emails) e
  on conflict (client_id, kind, value_norm) do nothing;

  insert into client_contacts (client_id, kind, value, value_norm, source, is_primary)
  select cid, 'phone', p, p, 'import', p = phones[1]
  from unnest(phones) p
  on conflict (client_id, kind, value_norm) do nothing;
end
$$;

create or replace function public.clients_contacts_sync_trg()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  perform sync_client_derived_contacts(new.id);
  return null;
end
$$;

drop trigger if exists clients_contacts_sync on public.clients;
create trigger clients_contacts_sync
  after insert or update of email, phone on public.clients
  for each row execute function public.clients_contacts_sync_trg();

-- ---------------------------------------------------------------- backfill

select public.sync_client_derived_contacts(id) from public.clients;
