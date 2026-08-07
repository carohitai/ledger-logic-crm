-- Migration 2 — Outlook mail, sync cursors, and the unified communications view.

-- ------------------------------------------------- call_logs: accept real CDR
--
-- call_logs was built for click-to-call only, so client_id, staff_id and
-- caller_ext are all NOT NULL. Syncing the PBX's full CDR breaks every one of
-- those: an inbound call has no caller extension, a call from an unrecognised
-- number has no client, and a call on a ring group has no single staff member.
-- Relax them so unmatched calls can land and be triaged rather than dropped.

alter table public.call_logs alter column client_id  drop not null;
alter table public.call_logs alter column staff_id   drop not null;
alter table public.call_logs alter column caller_ext drop not null;

-- Direction was previously implicit (everything was outbound click-to-call).
-- CDR carries both, so make it explicit rather than inferring it from which
-- columns happen to be populated.
alter table public.call_logs
  add column if not exists direction text not null default 'out'
    check (direction in ('in', 'out'));
alter table public.call_logs add column if not exists duration_seconds integer;
alter table public.call_logs add column if not exists source text not null default 'crm'
  check (source in ('crm', 'cdr'));

-- The CDR sync upserts on this so it enriches the row click-to-call already
-- created instead of inserting a duplicate.
create unique index if not exists call_logs_pbx_call_id_key
  on public.call_logs (pbx_call_id) where pbx_call_id is not null;

create index if not exists call_logs_client_time
  on public.call_logs (client_id, placed_at desc);
create index if not exists call_logs_unmatched
  on public.call_logs (placed_at desc) where client_id is null;

-- ------------------------------------------------------------------ mailboxes

create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  upn text not null unique,
  display_name text,
  is_active boolean not null default true,
  -- Graph delta cursor. Null means "never synced" and triggers a bounded
  -- backfill rather than a full-mailbox delta.
  delta_link text,
  backfilled_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.mailboxes enable row level security;

drop policy if exists mailboxes_select on public.mailboxes;
create policy mailboxes_select on public.mailboxes
  for select to authenticated using (is_admin_or_partner());

drop policy if exists mailboxes_admin_write on public.mailboxes;
create policy mailboxes_admin_write on public.mailboxes
  for all to authenticated using (is_admin()) with check (is_admin());

-- -------------------------------------------------------------- mail messages
--
-- body_preview only, never the full body. Client correspondence is sensitive,
-- the preview is enough to scan a timeline, and web_link opens the real mail in
-- Outlook — so there is no reason to hold the full text in the CRM.

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  graph_id text not null unique,
  internet_message_id text,
  conversation_id text,
  client_id uuid references public.clients(id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  subject text,
  body_preview text,
  from_address text,
  from_name text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  has_attachments boolean not null default false,
  web_link text,
  sent_at timestamptz,
  received_at timestamptz not null,
  raw jsonb,
  -- Which firm mailboxes this message was seen in. The same physical mail
  -- arrives twice when both correspondents are firm mailboxes (once in A's
  -- Sent Items, once in B's Inbox); we keep one row and record both.
  seen_in_mailboxes text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- graph_id is assigned per-mailbox so it cannot collapse the duplicate above.
-- The RFC 5322 Message-ID can, so it is the real dedupe key when present.
create unique index if not exists email_messages_internet_id_key
  on public.email_messages (internet_message_id)
  where internet_message_id is not null;

create index if not exists email_messages_client
  on public.email_messages (client_id, received_at desc);
create index if not exists email_messages_unmatched
  on public.email_messages (received_at desc) where client_id is null;
create index if not exists email_messages_conversation
  on public.email_messages (conversation_id);
create index if not exists email_messages_mailbox
  on public.email_messages (mailbox_id, received_at desc);

alter table public.email_messages enable row level security;

drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages
  for select to authenticated
  using (
    is_admin()
    or (client_id is not null and has_allotment_on(client_id))
    -- Unattributed mail has no client to scope by, so only the people who
    -- triage it can see it.
    or (client_id is null and is_admin_or_partner())
  );

drop policy if exists email_messages_triage on public.email_messages;
create policy email_messages_triage on public.email_messages
  for update to authenticated
  using (is_admin_or_partner()) with check (is_admin_or_partner());

-- ----------------------------------------------------------------- sync state

create table if not exists public.sync_state (
  key text primary key,
  cursor text,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.sync_state enable row level security;

drop policy if exists sync_state_select on public.sync_state;
create policy sync_state_select on public.sync_state
  for select to authenticated using (is_admin_or_partner());

-- -------------------------------------------- widen unmatched-item visibility
--
-- The existing policies scope everything through client_id, which leaves rows
-- awaiting triage invisible to the very people who triage them.

drop policy if exists wa_select on public.whatsapp_messages;
create policy wa_select on public.whatsapp_messages
  for select to authenticated
  using (
    is_admin()
    or (client_id is not null and has_allotment_on(client_id))
    or (client_id is null and is_admin_or_partner())
  );

drop policy if exists whatsapp_messages_triage on public.whatsapp_messages;
create policy whatsapp_messages_triage on public.whatsapp_messages
  for update to authenticated
  using (is_admin_or_partner()) with check (is_admin_or_partner());

drop policy if exists call_logs_select on public.call_logs;
create policy call_logs_select on public.call_logs
  for select to authenticated
  using (
    is_admin()
    or (client_id is not null and has_allotment_on(client_id))
    or staff_id = current_staff_id()
    or (client_id is null and is_admin_or_partner())
  );

-- ------------------------------------------------------- communications view
--
-- One timeline over the three channels. A view rather than a materialised
-- table: the three ingest paths would otherwise each need a dual-write and
-- would drift. security_invoker makes each branch obey its own table's RLS, so
-- no policy is restated here and nothing leaks.

create or replace view public.communications with (security_invoker = true) as
  select
    'email'::text                              as channel,
    e.id                                       as id,
    e.client_id                                as client_id,
    e.direction                                as direction,
    coalesce(nullif(e.subject, ''), '(no subject)') as title,
    e.body_preview                             as body,
    e.received_at                              as occurred_at,
    e.from_address                             as counterparty,
    null::uuid                                 as staff_id,
    e.web_link                                 as web_link,
    e.conversation_id                          as thread_key,
    jsonb_build_object(
      'has_attachments', e.has_attachments,
      'to', e.to_addresses,
      'from_name', e.from_name
    )                                          as meta
  from public.email_messages e

  union all

  select
    'whatsapp',
    w.id,
    w.client_id,
    w.direction,
    coalesce(w.template_id, 'WhatsApp message'),
    w.body,
    w.created_at,
    w.phone,
    null::uuid,
    null,
    null,
    jsonb_build_object('status', w.status)
  from public.whatsapp_messages w

  union all

  select
    'call',
    c.id,
    c.client_id,
    c.direction,
    'Call',
    c.disposition,
    coalesce(c.placed_at, c.scheduled_at),
    c.callee,
    c.staff_id,
    null,
    null,
    jsonb_build_object(
      'status', c.status,
      'attempt', c.attempt,
      'duration_seconds', c.duration_seconds
    )
  from public.call_logs c;

-- Items awaiting attribution, for the triage queue.
create or replace view public.unmatched_comms with (security_invoker = true) as
  select * from public.communications where client_id is null;
