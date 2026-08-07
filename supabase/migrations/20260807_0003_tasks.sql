-- Migration 3 — compliance task management.
--
-- Recurring statutory work per client per period, with due dates, assignment
-- derived from existing allotments, and evidence of what was actually filed.
--
-- Instances are materialised by a generator rather than computed on read,
-- because a task carries mutable state — who owns it, what status it is in,
-- what the ARN was — and none of that can live in a derived query.

create type task_department as enum
  ('accounting', 'income_tax', 'tds', 'gst', 'professional_tax');

create type task_status as enum
  ('pending', 'in_progress', 'blocked', 'filed', 'not_applicable');

-- Applicability for TDS and Professional Tax cannot be derived from anything
-- already in `clients` — there is no column that implies either obligation.
-- Rather than guess (and fabricate statutory duties for 900+ clients), make it
-- explicit and default it off.
alter table public.clients
  add column if not exists tds_applicable boolean not null default false;
alter table public.clients
  add column if not exists pt_applicable boolean not null default false;

create table if not exists public.task_templates (
  code text primary key,
  department task_department not null,
  title text not null,
  statutory_ref text,
  recurrence text not null check (recurrence in ('monthly', 'quarterly', 'annual')),
  -- {"kind":"after_period_end","months":1,"day":20}
  -- {"kind":"after_fy_end","months":4,"day":31}
  due_rule jsonb not null,
  -- Which allotment role owns it, resolved against client_allotments.
  assign_role text,
  -- Evaluated by src/lib/tasks/applicability.ts against the client row.
  applies_when jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 100
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  template_code text references public.task_templates(code) on update cascade,
  department task_department not null,
  period_key text not null,       -- '2026-07' | '2026-Q2' | 'FY2025-26'
  period_label text not null,     -- 'July 2026' | 'Apr–Jun 2026' | 'AY 2026-27'
  title text not null,
  due_date date not null,
  status task_status not null default 'pending',
  assigned_staff_id uuid references public.staff(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.staff(id) on delete set null,
  evidence jsonb,
  notes text,
  source text not null default 'auto' check (source in ('auto', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Makes generation idempotent: re-running never duplicates a period.
  unique (client_id, template_code, period_key)
);

create index if not exists tasks_worklist
  on public.tasks (assigned_staff_id, status, due_date);
create index if not exists tasks_client
  on public.tasks (client_id, due_date desc);
create index if not exists tasks_open_due
  on public.tasks (due_date)
  where status in ('pending', 'in_progress', 'blocked');
create index if not exists tasks_department
  on public.tasks (department, period_key);

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_staff_id uuid references public.staff(id) on delete set null, -- null = system
  action text not null,
  from_status task_status,
  to_status task_status,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists task_events_task on public.task_events (task_id, created_at desc);

create table if not exists public.filing_status_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null,
  department task_department not null,
  form_code text not null,
  period_key text not null,
  state text not null check (state in ('filed', 'not_filed', 'not_applicable', 'unknown')),
  filed_on date,
  reference text,
  -- 'authoritative' (GSP/ERI) may verify; 'public' may only mark filed.
  confidence text not null default 'public',
  payload jsonb,
  fetched_at timestamptz not null default now(),
  unique (client_id, form_code, period_key)
);
create index if not exists filing_status_client
  on public.filing_status_cache (client_id, fetched_at desc);

-- ---------------------------------------------------------------------- RLS

alter table public.task_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.filing_status_cache enable row level security;

drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
  for select to authenticated using (true);

drop policy if exists task_templates_admin on public.task_templates;
create policy task_templates_admin on public.task_templates
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    is_admin()
    or has_allotment_on(client_id)
    or assigned_staff_id = current_staff_id()
  );

-- RLS is column-blind, so this grants row access only; the API re-derives which
-- COLUMNS the caller may set (reassignment stays admin/partner).
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    is_admin()
    or has_allotment_on(client_id)
    or assigned_staff_id = current_staff_id()
  )
  with check (
    is_admin()
    or has_allotment_on(client_id)
    or assigned_staff_id = current_staff_id()
  );

drop policy if exists tasks_admin_write on public.tasks;
create policy tasks_admin_write on public.tasks
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists task_events_select on public.task_events;
create policy task_events_select on public.task_events
  for select to authenticated
  using (exists (
    select 1 from public.tasks t
    where t.id = task_id
      and (is_admin() or has_allotment_on(t.client_id)
           or t.assigned_staff_id = current_staff_id())
  ));

drop policy if exists task_events_insert on public.task_events;
create policy task_events_insert on public.task_events
  for insert to authenticated
  with check (exists (
    select 1 from public.tasks t
    where t.id = task_id
      and (is_admin() or has_allotment_on(t.client_id)
           or t.assigned_staff_id = current_staff_id())
  ));

drop policy if exists filing_status_select on public.filing_status_cache;
create policy filing_status_select on public.filing_status_cache
  for select to authenticated
  using (is_admin() or has_allotment_on(client_id));

-- ------------------------------------------------------------------- rollup
--
-- current_date on a UTC server is the wrong day for 5.5 hours out of every 24,
-- which would mis-state "overdue" every evening IST. Anchor to Asia/Kolkata.

create or replace view public.task_rollup with (security_invoker = true) as
select
  t.assigned_staff_id as staff_id,
  t.department,
  count(*) filter (
    where t.status in ('pending', 'in_progress', 'blocked')
  ) as open,
  count(*) filter (
    where t.status in ('pending', 'in_progress', 'blocked')
      and t.due_date < (now() at time zone 'Asia/Kolkata')::date
  ) as overdue,
  count(*) filter (
    where t.status in ('pending', 'in_progress', 'blocked')
      and t.due_date between (now() at time zone 'Asia/Kolkata')::date
                         and (now() at time zone 'Asia/Kolkata')::date + 7
  ) as due_7d,
  count(*) filter (where t.status = 'filed') as filed
from public.tasks t
group by 1, 2;

-- ------------------------------------------------------------ seed
-- Mirrors src/lib/tasks/templates.ts. TDS and Professional Tax ship
-- inactive: no client carries tds_applicable / pt_applicable yet, so
-- activating them before that master data exists would generate nothing.

insert into public.task_templates
  (code, department, title, statutory_ref, recurrence, due_rule, assign_role, applies_when, is_active, sort_order)
values
('gstr1_monthly', 'gst', 'GSTR-1 (monthly)', 'Sec 37 CGST', 'monthly', '{"kind":"after_period_end","months":1,"day":11}'::jsonb, 'gst', '{"equals":{"gst_status":["registered"],"gst_frequency":["MONTHLY"]}}'::jsonb, true, 10),
('gstr3b_monthly', 'gst', 'GSTR-3B (monthly)', 'Sec 39 CGST', 'monthly', '{"kind":"after_period_end","months":1,"day":20}'::jsonb, 'gst', '{"equals":{"gst_status":["registered"],"gst_frequency":["MONTHLY"]}}'::jsonb, true, 11),
('gstr1_quarterly', 'gst', 'GSTR-1 (QRMP quarterly)', 'Sec 37 CGST', 'quarterly', '{"kind":"after_period_end","months":1,"day":13}'::jsonb, 'gst', '{"equals":{"gst_status":["registered"],"gst_frequency":["QUARTERLY"]}}'::jsonb, true, 12),
('gstr3b_quarterly', 'gst', 'GSTR-3B (QRMP quarterly)', 'Sec 39 CGST', 'quarterly', '{"kind":"after_period_end","months":1,"day":22}'::jsonb, 'gst', '{"equals":{"gst_status":["registered"],"gst_frequency":["QUARTERLY"]}}'::jsonb, true, 13),
('gstr9_annual', 'gst', 'GSTR-9 annual return', 'Sec 44 CGST', 'annual', '{"kind":"after_fy_end","months":9,"day":31}'::jsonb, 'gst', '{"equals":{"gst_status":["registered"]}}'::jsonb, true, 14),
('itr_non_audit', 'income_tax', 'Income tax return (non-audit)', 'Sec 139(1)', 'annual', '{"kind":"after_fy_end","months":4,"day":31}'::jsonb, 'income_tax', '{"equals":{"it_category":["NON AUDIT","SALARY"]}}'::jsonb, true, 20),
('tax_audit_3cd', 'income_tax', 'Tax audit report (3CA/3CB-3CD)', 'Sec 44AB', 'annual', '{"kind":"after_fy_end","months":6,"day":30}'::jsonb, 'income_tax', '{"equals":{"it_category":["AUDIT","COMP AUDIT","TRUST AUDIT","AUDIT PARTNER"]}}'::jsonb, true, 21),
('itr_audit', 'income_tax', 'Income tax return (audit case)', 'Sec 139(1)', 'annual', '{"kind":"after_fy_end","months":7,"day":31}'::jsonb, 'income_tax', '{"equals":{"it_category":["AUDIT","COMP AUDIT","TRUST AUDIT","AUDIT PARTNER","COMP DIRECTOR"]}}'::jsonb, true, 22),
('tds_payment_monthly', 'tds', 'TDS payment (challan 281)', 'Rule 30', 'monthly', '{"kind":"after_period_end","months":1,"day":7,"exceptions":{"03":{"months":1,"day":30}}}'::jsonb, 'income_tax', '{"isTrue":["tds_applicable"]}'::jsonb, false, 30),
('tds_return_quarterly', 'tds', 'TDS return (24Q / 26Q)', 'Rule 31A', 'quarterly', '{"kind":"after_period_end","months":1,"day":31,"exceptions":{"Q4":{"months":2,"day":31}}}'::jsonb, 'income_tax', '{"isTrue":["tds_applicable"]}'::jsonb, false, 31),
('form16_annual', 'tds', 'Form 16 issuance', 'Rule 31', 'annual', '{"kind":"after_fy_end","months":3,"day":15}'::jsonb, 'income_tax', '{"isTrue":["tds_applicable"]}'::jsonb, false, 32),
('ptrc_monthly', 'professional_tax', 'PTRC monthly return', 'MH PT Act 1975', 'monthly', '{"kind":"after_period_end","months":1,"day":"last"}'::jsonb, 'accounts', '{"isTrue":["pt_applicable"]}'::jsonb, false, 40),
('ptrc_annual', 'professional_tax', 'PTRC annual return', 'MH PT Act 1975', 'annual', '{"kind":"after_fy_end","months":0,"day":31}'::jsonb, 'accounts', '{"isTrue":["pt_applicable"]}'::jsonb, false, 41),
('accounts_monthly_close', 'accounting', 'Monthly bookkeeping close', null, 'monthly', '{"kind":"after_period_end","months":1,"day":10}'::jsonb, 'accounts', '{"startsWith":{"books":["BM"]}}'::jsonb, true, 50)
on conflict (code) do update set
  department = excluded.department, title = excluded.title,
  statutory_ref = excluded.statutory_ref, recurrence = excluded.recurrence,
  due_rule = excluded.due_rule, assign_role = excluded.assign_role,
  applies_when = excluded.applies_when, sort_order = excluded.sort_order;
