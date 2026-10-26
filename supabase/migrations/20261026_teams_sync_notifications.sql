-- Automated client-sheet sync + Teams / Outlook / Periskope notifications.
-- Additive only: new columns are nullable, new tables start empty.
-- Run once in the Supabase SQL editor (project: ka-crm).

-- 1. Where each client's conversations live --------------------------------
alter table public.clients
  add column if not exists teams_team_id     text,
  add column if not exists teams_channel_id  text,
  add column if not exists teams_team_name   text,
  add column if not exists periskope_chat_id text;

comment on column public.clients.teams_team_id     is 'Microsoft Teams team (group id) dedicated to this client';
comment on column public.clients.teams_channel_id  is 'Channel in that team where CRM change notices are posted (General by default)';
comment on column public.clients.periskope_chat_id is 'Periskope / WhatsApp group id (…@g.us) for this client';

-- 2. Sheet-driven changes are activity too ----------------------------------
alter table public.client_activity drop constraint if exists client_activity_action_check;
alter table public.client_activity
  add constraint client_activity_action_check check (
    action = any (array[
      'created', 'updated', 'bulk_message',
      'sheet_insert', 'sheet_update', 'sheet_missing', 'allotment_change'
    ])
  );

-- 3. Delegated Microsoft 365 token (one connected account posts on the firm's behalf)
create table if not exists public.integration_tokens (
  provider      text primary key,
  account_upn   text,
  account_name  text,
  scopes        text,
  access_token  text,
  refresh_token text not null,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.integration_tokens enable row level security;
-- No policies on purpose: only the service-role key (server routes / cron) may read it.

-- 4. Admin-editable settings (firm channel, Periskope internal group, toggles)
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select using (is_admin_or_partner());
drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings
  for all using (is_admin()) with check (is_admin());

-- 5. Snapshot of the Teams the connected account belongs to (for mapping UI)
create table if not exists public.teams_directory (
  team_id            text primary key,
  display_name       text not null,
  description        text,
  general_channel_id text,
  web_url            text,
  synced_at          timestamptz not null default now()
);
alter table public.teams_directory enable row level security;
drop policy if exists teams_directory_read on public.teams_directory;
create policy teams_directory_read on public.teams_directory
  for select using (is_admin_or_partner());
drop policy if exists teams_directory_admin_write on public.teams_directory;
create policy teams_directory_admin_write on public.teams_directory
  for all using (is_admin()) with check (is_admin());

-- 6. Every outbound notice, for the Integrations screen and for retries
create table if not exists public.notification_log (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete set null,
  activity_id uuid references public.client_activity(id) on delete set null,
  channel     text not null check (channel in ('teams', 'outlook', 'periskope')),
  target      text,
  status      text not null check (status in ('sent', 'failed', 'skipped')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists notification_log_created_idx on public.notification_log (created_at desc);
alter table public.notification_log enable row level security;
drop policy if exists notification_log_read on public.notification_log;
create policy notification_log_read on public.notification_log
  for select using (is_admin_or_partner());

-- 7. sync_state already exists (key / cursor / last_run_at / last_error) and
--    is used with key = 'client_sheet' to remember the last imported eTag.
