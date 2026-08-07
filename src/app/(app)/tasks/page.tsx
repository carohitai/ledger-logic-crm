// Compliance worklist: statutory filings due per client, per period.
//
// Defaults to the signed-in person's own open work, which is the question
// staff actually have ("what is on me this week"). Admins and partners can
// widen to the whole firm. RLS on `tasks` means a staff member only ever sees
// tasks for clients they are allotted to, or tasks assigned to them.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DEPARTMENT_LABELS, type Department } from "@/lib/tasks/templates";
import { istToday, isoDate } from "@/lib/tasks/periods";
import { TaskStatusSelect } from "./task-status";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const OPEN_STATUSES = ["pending", "in_progress", "blocked"];

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

interface TaskRow {
  id: string;
  client_id: string;
  department: Department;
  period_label: string;
  title: string;
  due_date: string;
  status: string;
  assigned_staff_id: string | null;
  notes: string | null;
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-[12.5px] font-semibold no-underline"
      style={{
        borderRadius: "var(--radius-pill)",
        background: active ? "var(--brand-blue-deep)" : "var(--paper-2)",
        color: active ? "var(--white)" : "var(--ink-500)",
      }}
    >
      {children}
    </Link>
  );
}

export default async function TasksPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const scope = params.scope === "firm" ? "firm" : "mine";
  const dept = params.dept as Department | undefined;
  const show = params.show === "all" ? "all" : "open";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user!.id)
    .maybeSingle();
  const canSeeFirm = me?.app_role === "admin" || me?.app_role === "partner";
  const effectiveScope = scope === "firm" && canSeeFirm ? "firm" : "mine";

  const today = istToday();
  const todayIso = isoDate(today.y, today.m, today.d);

  let query = supabase
    .from("tasks")
    .select(
      "id, client_id, department, period_label, title, due_date, status, assigned_staff_id, notes"
    )
    .order("due_date", { ascending: true })
    .limit(PAGE_SIZE);

  if (effectiveScope === "mine") query = query.eq("assigned_staff_id", me?.id ?? "");
  if (dept) query = query.eq("department", dept);
  if (show === "open") query = query.in("status", OPEN_STATUSES);

  const { data: rows, error } = await query.returns<TaskRow[]>();
  const tasks = rows ?? [];

  const clientIds = [...new Set(tasks.map((t) => t.client_id))];
  const staffIds = [...new Set(tasks.map((t) => t.assigned_staff_id).filter(Boolean))] as string[];

  const [{ data: clientRows }, { data: staffRows }] = await Promise.all([
    clientIds.length
      ? supabase.from("clients").select("id, name").in("id", clientIds)
      : Promise.resolve({ data: null }),
    staffIds.length
      ? supabase.from("staff").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: null }),
  ]);
  const clientNames = new Map((clientRows ?? []).map((c) => [c.id as string, c.name as string]));
  const staffNames = new Map((staffRows ?? []).map((s) => [s.id as string, s.full_name as string]));

  const overdue = tasks.filter(
    (t) => OPEN_STATUSES.includes(t.status) && t.due_date < todayIso
  ).length;
  const dueSoon = tasks.filter(
    (t) =>
      OPEN_STATUSES.includes(t.status) &&
      t.due_date >= todayIso &&
      t.due_date <= isoDate(today.y, today.m, today.d + 7)
  ).length;

  const qs = (next: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { scope: effectiveScope, dept, show, ...next };
    for (const [k, v] of Object.entries(merged)) {
      if (!v || v === "mine" || v === "open") continue;
      sp.set(k, v);
    }
    const s = sp.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
        >
          Compliance
        </div>
        <h1
          className="m-0 text-[34px] font-semibold leading-[1.1]"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          Tasks
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          Accounting, Income Tax, TDS, GST and Professional Tax filings with
          their statutory due dates.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          ["Overdue", overdue, "rgba(180,68,58,0.12)", "#B4443A"],
          ["Due in 7 days", dueSoon, "rgba(201,154,78,0.15)", "#8F6A2E"],
          ["Showing", tasks.length, "var(--brand-blue-pale)", "var(--brand-blue-deep)"],
        ].map(([label, value, bg, fg]) => (
          <div
            key={String(label)}
            className="px-5 py-3.5"
            style={{ ...cardStyle, background: bg as string, border: "none" }}
          >
            <div
              className="text-[10.5px] font-bold uppercase"
              style={{ letterSpacing: "0.1em", color: fg as string, opacity: 0.75 }}
            >
              {label}
            </div>
            <div className="text-[24px] font-semibold tabular-nums" style={{ color: fg as string }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip href={qs({ scope: "mine" })} active={effectiveScope === "mine"}>
          Assigned to me
        </Chip>
        {canSeeFirm && (
          <Chip href={qs({ scope: "firm" })} active={effectiveScope === "firm"}>
            Whole firm
          </Chip>
        )}
        <span className="mx-2 h-5 w-px" style={{ background: "var(--border-default)" }} />
        <Chip href={qs({ dept: undefined })} active={!dept}>
          All departments
        </Chip>
        {(Object.keys(DEPARTMENT_LABELS) as Department[]).map((d) => (
          <Chip key={d} href={qs({ dept: d })} active={dept === d}>
            {DEPARTMENT_LABELS[d]}
          </Chip>
        ))}
        <span className="mx-2 h-5 w-px" style={{ background: "var(--border-default)" }} />
        <Chip href={qs({ show: "open" })} active={show === "open"}>
          Open
        </Chip>
        <Chip href={qs({ show: "all" })} active={show === "all"}>
          All
        </Chip>
      </div>

      <div className="overflow-hidden" style={cardStyle}>
        {error ? (
          <p className="px-[22px] py-5 text-sm" style={{ color: "#B4443A" }}>
            Could not load tasks: {error.message}
          </p>
        ) : !tasks.length ? (
          <p className="px-[22px] py-5 text-sm" style={{ color: "var(--ink-400)" }}>
            Nothing here. Tasks are generated from the statutory calendar once
            the generator has run.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ background: "var(--paper-2)" }}>
                  {["Client", "Filing", "Period", "Due", "Owner", "Status"].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-2.5 text-left text-[10.5px] font-bold uppercase"
                      style={{ letterSpacing: "0.1em", color: "var(--ink-400)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const isOverdue = OPEN_STATUSES.includes(t.status) && t.due_date < todayIso;
                  return (
                    <tr key={t.id} style={{ borderTop: "1px solid var(--ink-100)" }}>
                      <td className="px-4 py-3">
                        <Link
                          href={`/clients/${t.client_id}`}
                          className="font-semibold no-underline"
                          style={{ color: "var(--brand-blue-deep)" }}
                        >
                          {clientNames.get(t.client_id) ?? "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--ink-900)" }}>
                        {t.title}
                        <div className="text-[11px]" style={{ color: "var(--ink-400)" }}>
                          {DEPARTMENT_LABELS[t.department]}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3" style={{ color: "var(--ink-500)" }}>
                        {t.period_label}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-3 tabular-nums"
                        style={{
                          color: isOverdue ? "#B4443A" : "var(--ink-700)",
                          fontWeight: isOverdue ? 700 : 400,
                        }}
                      >
                        {t.due_date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3" style={{ color: "var(--ink-500)" }}>
                        {t.assigned_staff_id ? staffNames.get(t.assigned_staff_id) ?? "—" : "Unassigned"}
                      </td>
                      <td className="px-4 py-3">
                        <TaskStatusSelect id={t.id} status={t.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {tasks.length === PAGE_SIZE && (
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          Showing the {PAGE_SIZE} soonest-due tasks. Narrow by department or
          status to see further out.
        </p>
      )}
    </div>
  );
}
