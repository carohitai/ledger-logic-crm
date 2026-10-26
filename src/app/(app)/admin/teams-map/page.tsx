import { AppLink } from "@/components/nav-progress";
import { SubmitButton } from "@/components/button";
import { createClient } from "@/lib/supabase/server";
import { indexTeams, suggestTeam } from "@/lib/match";
import { getSettings } from "@/lib/settings";
import { unlinkClientTeamForm } from "../../clients/[id]/teams-actions";
import { acceptSuggestions, linkOne } from "./actions";

export const dynamic = "force-dynamic";

const PAGE = 100;
const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase";
const THS = { letterSpacing: "0.1em" } as const;
const MUTED = { color: "var(--ink-500)" } as const;

export default async function TeamsMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("staff").select("app_role").eq("auth_user_id", user!.id).maybeSingle();
  if (me?.app_role !== "admin") return <p className="text-sm" style={MUTED}>Admin only.</p>;

  const view = params.view === "mapped" ? "mapped" : params.view === "all" ? "all" : "unmapped";
  const q = (params.q ?? "").trim();
  const page = Math.max(1, Number(params.page ?? 1));

  const [settings, { data: dir }, { data: clientsRaw }] = await Promise.all([
    getSettings(supabase),
    supabase.from("teams_directory").select("team_id, display_name, description, web_url").order("display_name"),
    (() => {
      let qb = supabase
        .from("clients")
        .select("id, name, trade_name, category, status, teams_team_id, teams_team_name")
        .eq("status", "active")
        .order("name");
      if (view === "unmapped") qb = qb.is("teams_team_id", null);
      if (view === "mapped") qb = qb.not("teams_team_id", "is", null);
      if (q) qb = qb.or(`name.ilike.%${q.replaceAll(",", " ")}%,trade_name.ilike.%${q.replaceAll(",", " ")}%`);
      return qb.limit(5000);
    })(),
  ]);
  const teamsDir = (dir ?? []) as { team_id: string; display_name: string; description: string | null; web_url: string | null }[];
  const index = indexTeams(teamsDir.map((t) => ({ id: t.team_id, name: t.display_name, description: t.description })));
  const threshold = settings.teams_match_threshold;

  const clients = (clientsRaw ?? []) as {
    id: string; name: string; trade_name: string | null; category: string | null; status: string;
    teams_team_id: string | null; teams_team_name: string | null;
  }[];
  const rows = clients.map((c) => ({
    ...c,
    suggestion: c.teams_team_id ? null : suggestTeam({ name: c.name, trade_name: c.trade_name }, index, 0.4),
  }));
  // Confident suggestions first, so the "accept all" button's targets are visible.
  if (view !== "mapped") {
    rows.sort((a, b) => (b.suggestion?.score ?? -1) - (a.suggestion?.score ?? -1) || a.name.localeCompare(b.name));
  }
  const confident = rows.filter((r) => r.suggestion && r.suggestion.score >= threshold).length;
  const total = rows.length;
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const href = (patch: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { view, q, page, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) sp.set(k, String(v));
    const s = sp.toString();
    return `/admin/teams-map${s ? `?${s}` : ""}`;
  };
  const tab = (key: string, label: string) => (
    <AppLink
      key={key}
      href={href({ view: key, page: 1 })}
      className="px-3 py-1.5 text-[12.5px] font-semibold"
      style={{
        borderRadius: "var(--radius-pill)",
        background: view === key ? "var(--brand-blue-pale)" : "transparent",
        color: view === key ? "var(--brand-blue-deep)" : "var(--ink-500)",
      }}
    >
      {label}
    </AppLink>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}>
          Kolte &amp; Associates LLP — Internal
        </div>
        <h1 className="m-0 text-[38px] font-semibold leading-[1.1]" style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}>
          Teams map
        </h1>
        <p className="mt-2 max-w-[720px] text-sm leading-relaxed" style={MUTED}>
          Link every client to its Microsoft Team so changes to the master sheet reach the right people. Suggestions
          come from name similarity between the client list and the {teamsDir.length} teams in the directory;
          accept the confident ones in bulk, fix the rest by hand.
        </p>
      </div>

      {params.ok && (
        <div className="px-4 py-3 text-sm" style={{ borderRadius: "var(--radius-lg)", background: "var(--brand-green-pale)", color: "var(--earth-moss)" }}>
          {params.ok}
        </div>
      )}
      {!teamsDir.length && (
        <div className="px-4 py-3 text-sm" style={{ borderRadius: "var(--radius-lg)", background: "rgba(201,154,78,0.15)", color: "#8F6A2E" }}>
          The Teams directory is empty. Connect Microsoft 365 and press &quot;Refresh directory&quot; on{" "}
          <AppLink href="/admin/integrations" className="font-semibold underline">Integrations</AppLink> first.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">{tab("unmapped", "Unmapped")}{tab("mapped", "Mapped")}{tab("all", "All")}</div>
        <form className="flex items-center gap-2" method="get">
          <input type="hidden" name="view" value={view} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search client or trade name"
            className="w-64 px-3 py-1.5 text-[13px]"
            style={{ border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", background: "var(--white)" }}
          />
          <SubmitButton variant="secondary" size="sm">Search</SubmitButton>
        </form>
        {view !== "mapped" && (
          <form action={acceptSuggestions} className="ml-auto flex items-center gap-2 text-[12.5px]" style={MUTED}>
            <input type="hidden" name="threshold" value={threshold} />
            <span>
              <b className="tabular-nums" style={{ color: "var(--ink-900)" }}>{confident}</b> confident match{confident === 1 ? "" : "es"} (≥ {Math.round(threshold * 100)}%)
            </span>
            <SubmitButton variant="success" size="sm" disabled={!confident}>Accept next 40</SubmitButton>
          </form>
        )}
      </div>

      <div className="overflow-x-auto bg-white" style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" }}>
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left" style={{ background: "var(--paper-2)", color: "var(--ink-500)" }}>
              <th className={TH} style={THS}>Client</th>
              <th className={TH} style={THS}>Trade name</th>
              <th className={TH} style={THS}>Cat.</th>
              <th className={TH} style={THS}>Team</th>
              <th className={TH} style={THS}>Action</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const score = r.suggestion ? Math.round(r.suggestion.score * 100) : null;
              const confidentRow = (r.suggestion?.score ?? 0) >= threshold;
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                  <td className="px-4 py-2.5">
                    <AppLink href={`/clients/${r.id}`} className="font-semibold hover:underline" style={{ color: "var(--ink-900)" }}>{r.name}</AppLink>
                  </td>
                  <td className="px-4 py-2.5" style={MUTED}>{r.trade_name ?? "—"}</td>
                  <td className="px-4 py-2.5" style={MUTED}>{r.category ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {r.teams_team_id ? (
                      <span className="font-semibold" style={{ color: "var(--brand-blue-deep)" }}>{r.teams_team_name}</span>
                    ) : r.suggestion ? (
                      <span>
                        <span style={{ color: "var(--ink-900)" }}>{r.suggestion.name}</span>{" "}
                        <span
                          className="ml-1 px-2 py-[1px] text-[11px] font-semibold tabular-nums"
                          style={{
                            borderRadius: "var(--radius-pill)",
                            background: confidentRow ? "var(--brand-green-pale)" : "var(--paper-3)",
                            color: confidentRow ? "var(--earth-moss)" : "var(--ink-500)",
                          }}
                        >
                          {score}%
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-400)" }}>no similar team</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.teams_team_id ? (
                      <form action={unlinkClientTeamForm}>
                        <input type="hidden" name="client_id" value={r.id} />
                        <SubmitButton variant="ghost" size="xs">Unlink</SubmitButton>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {r.suggestion && (
                          <form action={linkOne}>
                            <input type="hidden" name="client_id" value={r.id} />
                            <input type="hidden" name="team_id" value={r.suggestion.id} />
                            <SubmitButton variant={confidentRow ? "success" : "secondary"} size="xs">Accept</SubmitButton>
                          </form>
                        )}
                        <AppLink href={`/clients/${r.id}`} className="text-[12px] font-semibold hover:underline" style={{ color: "var(--brand-blue-deep)" }}>
                          pick…
                        </AppLink>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!slice.length && (
              <tr><td colSpan={5} className="px-4 py-6 text-center" style={MUTED}>Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[12.5px]" style={MUTED}>
        <span>{total} client{total === 1 ? "" : "s"} · page {page} of {pages}</span>
        <span className="flex gap-3">
          {page > 1 && <AppLink href={href({ page: page - 1 })} className="font-semibold" style={{ color: "var(--brand-blue-deep)" }}>← Previous</AppLink>}
          {page < pages && <AppLink href={href({ page: page + 1 })} className="font-semibold" style={{ color: "var(--brand-blue-deep)" }}>Next →</AppLink>}
        </span>
      </div>
    </div>
  );
}
