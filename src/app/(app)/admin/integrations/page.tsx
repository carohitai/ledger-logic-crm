import { createClient } from "@/lib/supabase/server";
import { createServiceClient, serviceConfigured } from "@/lib/supabase/service";
import { graphConfigured, getLinkStatus } from "@/lib/graph";
import { delegatedConfigured, getConnection, type Connection } from "@/lib/microsoft/delegated";
import { listChannels, type ChannelSummary } from "@/lib/microsoft/teams";
import { periskopeConfigured } from "@/lib/periskope";
import { getSettings } from "@/lib/settings";
import { getSheetSyncState } from "@/lib/import/sheet-sync";
import { SubmitButton } from "@/components/button";
import {
  disconnectMicrosoft,
  refreshTeamsDirectory,
  saveFirmChannel,
  saveToggles,
  syncNow,
} from "./actions";

export const dynamic = "force-dynamic";

const card = {
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
const H3 = "mb-1 text-[13px] font-semibold";
const H3S = { color: "var(--ink-700)" } as const;
const MUTED = { color: "var(--ink-500)" } as const;

function fmt(iso: string | null | undefined) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-[3px] text-[11px] font-semibold"
      style={{
        borderRadius: "var(--radius-pill)",
        background: ok ? "var(--brand-green-pale)" : "rgba(201,154,78,0.15)",
        color: ok ? "var(--earth-moss)" : "#8F6A2E",
      }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
      {label}
    </span>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("staff").select("app_role").eq("auth_user_id", user!.id).maybeSingle();
  if (me?.app_role !== "admin") {
    return <p className="text-sm" style={MUTED}>Admin only.</p>;
  }

  const svc = serviceConfigured();
  const [settings, link, connection, syncState, dirStats, log] = await Promise.all([
    getSettings(supabase),
    getLinkStatus(),
    svc && delegatedConfigured() ? getConnection().catch(() => null) : Promise.resolve<Connection | null>(null),
    svc ? getSheetSyncState(createServiceClient()).catch(() => null) : Promise.resolve(null),
    supabase.from("teams_directory").select("team_id, display_name, synced_at").order("display_name"),
    supabase
      .from("notification_log")
      .select("id, channel, target, status, error, created_at, client:client_id (name)")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const teams = (dirStats.data ?? []) as { team_id: string; display_name: string; synced_at: string }[];
  const lastDirSync = teams.reduce<string | null>((acc, t) => (!acc || t.synced_at > acc ? t.synced_at : acc), null);

  // Channel picker for the firm-wide channel: two-step (team, then channel).
  const pickTeam = params.team ?? settings.firm_channel?.teamId ?? "";
  let channels: ChannelSummary[] = [];
  let channelErr: string | null = null;
  if (pickTeam && connection) {
    try {
      channels = await listChannels(pickTeam);
    } catch (e) {
      channelErr = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}>
          Kolte &amp; Associates LLP — Internal
        </div>
        <h1 className="m-0 text-[38px] font-semibold leading-[1.1]" style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}>
          Integrations
        </h1>
        <p className="mt-2 max-w-[720px] text-sm leading-relaxed" style={MUTED}>
          The CRM watches the master client list on OneDrive/SharePoint, imports every change automatically and
          tells the people concerned on Microsoft Teams, Outlook and the staff WhatsApp group. Connect the firm&apos;s
          Microsoft 365 account once; everything else is configured here.
        </p>
      </div>

      {params.ok && (
        <div className="px-4 py-3 text-sm" style={{ ...card, background: "var(--brand-green-pale)", color: "var(--earth-moss)" }}>
          {params.ok}
        </div>
      )}
      {params.connected && (
        <div className="px-4 py-3 text-sm" style={{ ...card, background: "var(--brand-green-pale)", color: "var(--earth-moss)" }}>
          Microsoft 365 connected as {params.connected}. Now refresh the Teams directory and pick a firm-wide channel.
        </div>
      )}
      {params.error && (
        <div className="px-4 py-3 text-sm" style={{ ...card, background: "rgba(180,60,60,0.08)", color: "var(--danger)" }}>
          {params.error}
        </div>
      )}

      {/* Environment checklist */}
      <section className="px-6 py-[22px]" style={card}>
        <h3 className={H3} style={H3S}>Server configuration</h3>
        <p className="mb-3 text-[12.5px]" style={MUTED}>Set these in Vercel → Project → Environment Variables. Nothing here is editable from the browser.</p>
        <div className="flex flex-wrap gap-2">
          <Pill ok={graphConfigured()} label="Graph app (GRAPH_TENANT_ID / CLIENT_ID / CLIENT_SECRET)" />
          <Pill ok={svc} label="SUPABASE_SERVICE_ROLE_KEY" />
          <Pill ok={Boolean(process.env.CRON_SECRET)} label="CRON_SECRET" />
          <Pill ok={Boolean(process.env.APP_URL)} label="APP_URL (links in notices)" />
          <Pill ok={periskopeConfigured()} label="Periskope (PERISKOPE_API_KEY / PERISKOPE_PHONE)" />
        </div>
      </section>

      {/* Microsoft 365 connection */}
      <section className="px-6 py-[22px]" style={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className={H3} style={H3S}>Microsoft 365 account</h3>
            <p className="text-[12.5px]" style={MUTED}>
              Teams messages and Outlook mails are sent as this account. Use a partner&apos;s account or a dedicated
              &quot;Ledger Logic&quot; user that is a member of every client Team.
            </p>
          </div>
          {connection ? (
            <form action={disconnectMicrosoft}>
              <SubmitButton variant="ghost" size="sm">Disconnect</SubmitButton>
            </form>
          ) : (
            <a
              href="/api/microsoft/connect"
              className="ll-press inline-flex items-center rounded-[var(--radius-md)] bg-[var(--brand-blue)] px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] hover:bg-[var(--brand-blue-deep)]"
              aria-disabled={!delegatedConfigured() || !svc}
            >
              Connect Microsoft 365
            </a>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          {connection ? (
            <>
              <Pill ok label="Connected" />
              <span style={{ color: "var(--ink-900)" }}>
                <b>{connection.account_name ?? connection.account_upn}</b>{" "}
                <span style={MUTED}>({connection.account_upn}) · token refreshed {fmt(connection.updated_at)}</span>
              </span>
            </>
          ) : (
            <Pill ok={false} label="Not connected" />
          )}
        </div>
      </section>

      {/* Teams directory + firm channel */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="px-6 py-[22px]" style={card}>
          <h3 className={H3} style={H3S}>Teams directory</h3>
          <p className="mb-3 text-[12.5px]" style={MUTED}>
            Snapshot of the Teams the connected account belongs to, used for mapping clients to their Team.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <span style={{ color: "var(--ink-900)" }}>
              <b className="tabular-nums">{teams.length}</b> teams · refreshed {fmt(lastDirSync)}
            </span>
            <form action={refreshTeamsDirectory} className="ml-auto">
              <SubmitButton variant="secondary" size="sm" disabled={!connection}>Refresh directory</SubmitButton>
            </form>
          </div>
          <p className="mt-3 text-[12.5px]" style={MUTED}>
            Then map clients in bulk on <a href="/admin/teams-map" className="font-semibold underline" style={{ color: "var(--brand-blue-deep)" }}>Teams map</a>, or one at a time from each client page.
          </p>
        </section>

        <section className="px-6 py-[22px]" style={card}>
          <h3 className={H3} style={H3S}>Firm-wide channel</h3>
          <p className="mb-3 text-[12.5px]" style={MUTED}>
            Receives a digest of every sheet sync and every CRM edit, including for clients with no Team mapped.
          </p>
          {settings.firm_channel && (
            <p className="mb-3 text-[13px]" style={{ color: "var(--ink-900)" }}>
              Current: <b>{settings.firm_channel.teamName}</b> / {settings.firm_channel.channelName}
            </p>
          )}
          <form action={saveFirmChannel} className="flex flex-col gap-2 text-[13px]">
            <select name="team_id" defaultValue={pickTeam} className="cursor-pointer px-2.5 py-1.5" style={inputStyle}>
              <option value="">— none (disable firm-wide posts) —</option>
              {teams.map((t) => (
                <option key={t.team_id} value={t.team_id}>{t.display_name}</option>
              ))}
            </select>
            {channelErr && <span style={{ color: "var(--danger)" }}>{channelErr}</span>}
            {channels.length > 0 ? (
              <select name="channel_id" defaultValue={settings.firm_channel?.channelId ?? ""} className="cursor-pointer px-2.5 py-1.5" style={inputStyle}>
                <option value="">— pick a channel —</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.displayName}</option>
                ))}
              </select>
            ) : (
              <span className="text-[12px]" style={MUTED}>Choose a team and press Next to list its channels.</span>
            )}
            <div>
              <SubmitButton variant="ink" size="sm" disabled={!connection && teams.length === 0}>
                {channels.length ? "Save channel" : "Next"}
              </SubmitButton>
            </div>
          </form>
        </section>
      </div>

      {/* Notification routing */}
      <section className="px-6 py-[22px]" style={card}>
        <h3 className={H3} style={H3S}>What gets notified where</h3>
        <form action={saveToggles} className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="notify_client_team" defaultChecked={settings.notify_client_team} className="mt-0.5" />
            <span>
              <b style={{ color: "var(--ink-900)" }}>Post in the client&apos;s own Team</b>
              <br />
              <span style={MUTED}>General channel of the mapped Team, @-mentioning the incharges.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="notify_outlook_incharges" defaultChecked={settings.notify_outlook_incharges} className="mt-0.5" />
            <span>
              <b style={{ color: "var(--ink-900)" }}>Email the incharges (Outlook)</b>
              <br />
              <span style={MUTED}>Staff with an email on the Staff screen get a mail per change.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="notify_periskope" defaultChecked={settings.notify_periskope} className="mt-0.5" />
            <span>
              <b style={{ color: "var(--ink-900)" }}>Mirror to the staff WhatsApp group (Periskope)</b>
              <br />
              <span style={MUTED}>Internal group only — client groups are never messaged by the notifier.</span>
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase" style={{ letterSpacing: "0.1em", color: "var(--ink-400)" }}>
              Staff group chat id
            </span>
            <input
              name="periskope_internal_chat_id"
              defaultValue={settings.periskope_internal_chat_id ?? ""}
              placeholder="120363…@g.us"
              className="px-2.5 py-1.5 font-mono text-[12px]"
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase" style={{ letterSpacing: "0.1em", color: "var(--ink-400)" }}>
              Teams auto-match threshold (0.3 – 1)
            </span>
            <input
              name="teams_match_threshold"
              type="number"
              step="0.01"
              min="0.3"
              max="1"
              defaultValue={settings.teams_match_threshold}
              className="w-28 px-2.5 py-1.5 tabular-nums"
              style={inputStyle}
            />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton variant="ink" size="sm">Save settings</SubmitButton>
          </div>
        </form>
      </section>

      {/* Sheet sync */}
      <section className="px-6 py-[22px]" style={card}>
        <h3 className={H3} style={H3S}>Master client sheet sync</h3>
        {!link.configured ? (
          <p className="text-[13px]" style={MUTED}>Graph app credentials missing — the sheet cannot be read.</p>
        ) : link.error !== null ? (
          <p className="text-[13px]" style={{ color: "var(--danger)" }}>Linked, but the file could not be reached: {link.error}</p>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--ink-900)" }}>
            <a href={link.file.webUrl} target="_blank" rel="noreferrer" className="font-semibold underline" style={{ color: "var(--brand-blue-deep)" }}>
              {link.file.name}
            </a>{" "}
            <span style={MUTED}>· last modified on OneDrive {fmt(link.file.lastModified)}</span>
          </p>
        )}
        <p className="mt-2 text-[13px]" style={MUTED}>
          Cron checks every 30 minutes and imports only when the workbook changed. Last run {fmt(syncState?.last_run_at)}
          {syncState?.last_error ? <span style={{ color: "var(--danger)" }}> · last error: {syncState.last_error}</span> : null}
          {syncState?.cursor && link.configured && link.error === null && link.file.eTag && syncState.cursor !== link.file.eTag ? (
            <span style={{ color: "#8F6A2E" }}> · the workbook has changed since the last import</span>
          ) : null}
        </p>
        <form action={syncNow} className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <label className="flex items-center gap-2" style={MUTED}>
            <input type="checkbox" name="force" /> Re-import even if unchanged
          </label>
          <SubmitButton variant="ink" size="sm" disabled={!link.configured || !svc}>Sync now</SubmitButton>
        </form>
      </section>

      {/* Log */}
      <section className="overflow-hidden" style={card}>
        <div className="px-6 pb-3 pt-[18px]">
          <h3 className={`${H3} mb-0`} style={H3S}>Recent notifications</h3>
        </div>
        {!(log.data ?? []).length ? (
          <p className="px-6 pb-5 text-[13px]" style={MUTED}>Nothing sent yet.</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ background: "var(--paper-2)", color: "var(--ink-500)" }}>
                {["When", "Client", "Channel", "Target", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(log.data ?? []).map((row) => {
                const client = row.client as unknown as { name?: string } | { name?: string }[] | null;
                const name = (Array.isArray(client) ? client[0]?.name : client?.name) ?? "— digest —";
                return (
                  <tr key={row.id} style={{ borderTop: "1px solid var(--ink-100)" }}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums" style={MUTED}>{fmt(row.created_at)}</td>
                    <td className="px-4 py-2" style={{ color: "var(--ink-900)" }}>{name}</td>
                    <td className="px-4 py-2 capitalize">{row.channel}</td>
                    <td className="max-w-[320px] truncate px-4 py-2" style={MUTED} title={row.target ?? ""}>{row.target}</td>
                    <td className="px-4 py-2">
                      <Pill ok={row.status === "sent"} label={row.status} />
                      {row.error && <span className="ml-2 text-[11.5px]" style={{ color: "var(--danger)" }} title={row.error}>{row.error.slice(0, 80)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
