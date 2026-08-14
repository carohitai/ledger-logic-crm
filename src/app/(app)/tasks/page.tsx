import { AppLink } from "@/components/nav-progress";
import { NavSubmitButton } from "@/components/button";
import { createClient } from "@/lib/supabase/server";
import { complianceConfigured, providerName } from "@/lib/compliance/provider";
import { istToday, periodLabel } from "@/lib/compliance/periods";
import {
  OPEN_STATUSES,
  STATUS_LABELS,
  TASK_KINDS,
  TASK_STATUSES,
  isOverdue,
  kindLabel,
  type TaskStatus,
} from "@/lib/tasks";
import { TaskStatusBadge, PriorityBadge } from "./task-badges";
import { StatusActions, AssigneeSelect } from "./task-controls";
import { NewTaskForm } from "./new-task-form";
import { SyncPanel } from "./sync-panel";

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase";
const THS = { letterSpacing: "0.1em" } as const;

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

const inputStyle = {
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--white)",
  color: "var(--ink-900)",
} as const;

interface TaskRow {
  id: string;
  client_id: string;
  title: string;
  details: string | null;
  kind: string;
  source: string;
  period: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  assignee_staff_id: string | null;
  created_at: string;
  client: { name: string } | { name: string }[] | null;
  assignee: { full_name: string } | { full_name: string }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function fmtDue(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y.slice(2)}`;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const today = istToday();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user!.id)
    .maybeSingle();
  const canRunSync = me?.app_role === "admin" || me?.app_role === "partner";

  // Default view: everything still open. `status=all` lifts the filter.
  const statusParam = params.status ?? "";
  let query = supabase
    .from("tasks")
    .select(
      "id, client_id, title, details, kind, source, period, due_date, priority, status, assignee_staff_id, created_at, client:client_id (name), assignee:assignee_staff_id (full_name)"
    )
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (TASK_STATUSES.includes(statusParam as TaskStatus)) {
    query = query.eq("status", statusParam);
  } else if (statusParam !== "all") {
    query = query.in("status", OPEN_STATUSES);
  }
  if (params.kind) query = query.eq("kind", params.kind);
  if (params.assignee === "me" && me?.id) query = query.eq("assignee_staff_id", me.id);
  else if (params.assignee) query = query.eq("assignee_staff_id", params.assignee);
  if (params.source === "auto" || params.source === "manual") {
    query = query.eq("source", params.source);
  }
  if (params.due === "overdue") query = query.lt("due_date", today).in("status", OPEN_STATUSES);

  const { data: tasksRaw, error } = await query.returns<TaskRow[]>();
  if (error) throw error;
  let tasks = tasksRaw ?? [];

  if (params.q) {
    const term = params.q.toLowerCase();
    tasks = tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(term) ||
        (one(t.client)?.name ?? "").toLowerCase().includes(term) ||
        (t.details ?? "").toLowerCase().includes(term)
    );
  }

  // Headline numbers are computed over ALL tasks, not the filtered view.
  const { data: statRows } = await supabase
    .from("tasks")
    .select("status, due_date, source")
    .returns<{ status: string; due_date: string | null; source: string }[]>();
  const all = statRows ?? [];
  const stats = {
    open: all.filter((t) => OPEN_STATUSES.includes(t.status as TaskStatus)).length,
    overdue: all.filter((t) => isOverdue(t, today)).length,
    auto: all.filter((t) => t.source === "auto" && OPEN_STATUSES.includes(t.status as TaskStatus)).length,
    doneThisWeek: all.filter((t) => t.status === "done").length,
  };

  const [{ data: staffList }, { data: clientList }] = await Promise.all([
    supabase.from("staff").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("clients")
      .select("id, name")
      .eq("status", "active")
      .order("name")
      .limit(3000),
  ]);
  const staff = staffList ?? [];

  const filtering = Boolean(
    params.q || params.status || params.kind || params.assignee || params.due || params.source
  );
  const kindsInUse = TASK_KINDS.filter((k) => k.group !== "manual");

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div>
        <div
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
        >
          Kolte &amp; Associates LLP — Internal
        </div>
        <h1
          className="m-0 text-[38px] font-semibold leading-[1.1]"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          Tasks
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          Compliance work items — generated automatically from PAN &amp; GST lookups,
          plus anything added by hand.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(
          [
            ["Open tasks", stats.open, null],
            ["Overdue", stats.overdue, stats.overdue > 0 ? "var(--danger)" : null],
            ["Auto-generated open", stats.auto, null],
            ["Completed", stats.doneThisWeek, "var(--earth-moss)"],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="px-5 py-4" style={cardStyle}>
            <div
              className="text-[10.5px] font-bold uppercase"
              style={{ letterSpacing: "0.1em", color: "var(--ink-400)" }}
            >
              {label}
            </div>
            <div
              className="mt-1 text-[26px] font-semibold tabular-nums"
              style={{ fontFamily: "var(--font-display)", color: color ?? "var(--ink-900)" }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Auto-generation */}
      {canRunSync && (
        <section className="px-6 py-[22px]" style={cardStyle}>
          <h3 className="mb-1 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
            Auto-generate from PAN &amp; GST
          </h3>
          <p className="mb-3.5 mt-0 text-[12.5px]" style={{ color: "var(--ink-500)" }}>
            Looks up each client&apos;s GSTIN and PAN against the compliance API, then
            creates tasks for unfiled returns, cancelled or suspended registrations,
            inoperative PANs and master-data mismatches. Tasks that are no longer
            reported (e.g. a return got filed) close themselves. The daily cron does
            this automatically; run it here to refresh sooner.
          </p>
          <SyncPanel configured={complianceConfigured()} provider={providerName()} />
        </section>
      )}

      {/* Filters */}
      <form className="flex flex-wrap items-center gap-2.5 text-[13px]" method="get">
        <input
          name="q"
          defaultValue={params.q}
          placeholder="Search task / client"
          className="w-[240px] px-3 py-2"
          style={inputStyle}
        />
        <select name="status" defaultValue={params.status ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
          <option value="">Open + in progress</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
          <option value="all">Everything</option>
        </select>
        <select name="kind" defaultValue={params.kind ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
          <option value="">All kinds</option>
          {kindsInUse.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
          <option value="manual">Manual</option>
        </select>
        <select name="assignee" defaultValue={params.assignee ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <select name="due" defaultValue={params.due ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
        </select>
        <select name="source" defaultValue={params.source ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
          <option value="">Auto + manual</option>
          <option value="auto">Auto-generated</option>
          <option value="manual">Manual</option>
        </select>
        <NavSubmitButton variant="ink" size="md">
          Filter
        </NavSubmitButton>
        {filtering && (
          <AppLink
            href="/tasks"
            inlineSpinner
            className="text-[12.5px] font-semibold no-underline"
            style={{ color: "var(--brand-blue)" }}
          >
            Clear
          </AppLink>
        )}
      </form>

      {/* Task table */}
      {!tasks.length ? (
        <div
          className="bg-white p-8 text-center text-sm"
          style={{ ...cardStyle, color: "var(--ink-500)" }}
        >
          {filtering
            ? "No tasks match these filters."
            : "No open tasks. Run the PAN/GST generation above, or add a manual task below."}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white" style={cardStyle}>
          <table className="w-full min-w-[960px] border-collapse text-[13px]">
            <thead>
              <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                <th className={TH} style={THS}>Task</th>
                <th className={TH} style={THS}>Client</th>
                <th className={TH} style={THS}>Period</th>
                <th className={TH} style={THS}>Due</th>
                <th className={TH} style={THS}>Priority</th>
                <th className={TH} style={THS}>Status</th>
                <th className={`${TH} min-w-[160px]`} style={THS}>Assignee</th>
                <th className={TH} style={THS}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const overdue = isOverdue(t, today);
                return (
                  <tr key={t.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="align-top hover:bg-[var(--paper)]">
                    <td className="max-w-[340px] px-4 py-[11px]">
                      <div className="font-semibold" style={{ color: "var(--ink-900)" }}>
                        {t.title}
                      </div>
                      <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-400)" }}>
                        {kindLabel(t.kind)}
                        {t.source === "auto" && " · auto"}
                      </div>
                      {t.details && (
                        <details className="mt-1">
                          <summary
                            className="cursor-pointer text-[11.5px] font-semibold"
                            style={{ color: "var(--brand-blue)" }}
                          >
                            Why this task
                          </summary>
                          <p className="mb-0 mt-1 text-[12px] leading-relaxed" style={{ color: "var(--ink-500)" }}>
                            {t.details}
                          </p>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-[11px]">
                      <AppLink
                        href={`/clients/${t.client_id}`}
                        inlineSpinner
                        className="font-semibold no-underline transition-colors hover:!text-[var(--brand-blue)] hover:underline"
                        style={{ color: "var(--ink-900)" }}
                      >
                        {one(t.client)?.name ?? "—"}
                      </AppLink>
                    </td>
                    <td className="whitespace-nowrap px-4 py-[11px]" style={{ color: "var(--ink-500)" }}>
                      {periodLabel(t.period)}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-[11px] font-semibold tabular-nums"
                      style={{ color: overdue ? "var(--danger)" : "var(--ink-700)" }}
                    >
                      {t.due_date ? fmtDue(t.due_date) : "—"}
                      {overdue && " ⚠"}
                    </td>
                    <td className="px-4 py-[11px]">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-4 py-[11px]">
                      <TaskStatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-[11px]">
                      <AssigneeSelect taskId={t.id} value={t.assignee_staff_id} staff={staff} />
                    </td>
                    <td className="px-4 py-[11px]">
                      <StatusActions taskId={t.id} status={t.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual task */}
      <section className="px-6 py-[22px]" style={cardStyle}>
        <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
          Add a manual task
        </h3>
        <NewTaskForm clients={clientList ?? []} staff={staff} />
      </section>
    </div>
  );
}
