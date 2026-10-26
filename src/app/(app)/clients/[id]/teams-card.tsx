import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/button";
import { indexTeams, suggestTeam } from "@/lib/match";
import { getSettings } from "@/lib/settings";
import { linkClientTeamForm, setPeriskopeChatForm, unlinkClientTeamForm } from "./teams-actions";

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

interface Props {
  clientId: string;
  clientName: string;
  tradeName: string | null;
  teamId: string | null;
  channelId: string | null;
  teamName: string | null;
  periskopeChatId: string | null;
  isAdmin: boolean;
}

/**
 * "Where this client's conversations live": the mapped Microsoft Team (change
 * notices post to its General channel) and the Periskope/WhatsApp group id.
 * Admins can change both; everyone else sees the links.
 */
export async function TeamsCard(p: Props) {
  const supabase = await createClient();
  const [{ data: dir }, settings] = await Promise.all([
    p.isAdmin
      ? supabase.from("teams_directory").select("team_id, display_name, description, web_url").order("display_name")
      : Promise.resolve({ data: null }),
    p.isAdmin ? getSettings(supabase).catch(() => null) : Promise.resolve(null),
  ]);
  const teams = (dir ?? []) as { team_id: string; display_name: string; description: string | null; web_url: string | null }[];
  const mapped = teams.find((t) => t.team_id === p.teamId);
  const teamLink =
    mapped?.web_url ??
    (p.teamId
      ? `https://teams.microsoft.com/l/team/${encodeURIComponent(p.channelId ?? "")}/conversations?groupId=${p.teamId}`
      : null);

  const suggestion =
    p.isAdmin && !p.teamId && teams.length
      ? suggestTeam(
          { name: p.clientName, trade_name: p.tradeName },
          indexTeams(teams.map((t) => ({ id: t.team_id, name: t.display_name, description: t.description }))),
          Math.min(settings?.teams_match_threshold ?? 0.72, 0.5)
        )
      : null;

  const LABEL = "mb-[5px] text-[10.5px] font-bold uppercase";
  const LABEL_STYLE = { letterSpacing: "0.1em", color: "var(--ink-400)" } as const;

  return (
    <section className="px-6 py-[22px]" style={cardStyle}>
      <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
        Teams &amp; WhatsApp
      </h3>

      <div className="space-y-4 text-[13px]">
        <div>
          <div className={LABEL} style={LABEL_STYLE}>Microsoft Teams</div>
          {p.teamId ? (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={teamLink ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline-offset-2 hover:underline"
                style={{ color: "var(--brand-blue-deep)" }}
              >
                {p.teamName ?? p.teamId}
              </a>
              <span style={{ color: "var(--ink-400)" }}>· change notices post to its General channel</span>
              {p.isAdmin && (
                <form action={unlinkClientTeamForm} className="ml-auto">
                  <input type="hidden" name="client_id" value={p.clientId} />
                  <SubmitButton variant="ghost" size="xs">Unlink</SubmitButton>
                </form>
              )}
            </div>
          ) : (
            <p className="m-0" style={{ color: "var(--ink-500)" }}>
              No Team linked{p.isAdmin ? "" : " — ask an admin to map one"}.
            </p>
          )}

          {p.isAdmin && !p.teamId && (
            <div className="mt-2 space-y-2">
              {suggestion && (
                <form action={linkClientTeamForm} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="client_id" value={p.clientId} />
                  <input type="hidden" name="team_id" value={suggestion.id} />
                  <span style={{ color: "var(--ink-500)" }}>
                    Suggested: <b style={{ color: "var(--ink-900)" }}>{suggestion.name}</b>{" "}
                    <span className="tabular-nums">({Math.round(suggestion.score * 100)}% match)</span>
                  </span>
                  <SubmitButton variant="success" size="xs">Link this team</SubmitButton>
                </form>
              )}
              {teams.length ? (
                <form action={linkClientTeamForm} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="client_id" value={p.clientId} />
                  <select name="team_id" defaultValue="" className="max-w-[320px] cursor-pointer px-2.5 py-1.5" style={inputStyle}>
                    <option value="">— pick a team —</option>
                    {teams.map((t) => (
                      <option key={t.team_id} value={t.team_id}>
                        {t.display_name}
                      </option>
                    ))}
                  </select>
                  <SubmitButton variant="secondary" size="xs">Link</SubmitButton>
                </form>
              ) : (
                <p className="m-0" style={{ color: "var(--ink-400)" }}>
                  Teams directory is empty — refresh it on the Integrations screen first.
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <div className={LABEL} style={LABEL_STYLE}>Periskope / WhatsApp group</div>
          {p.isAdmin ? (
            <form action={setPeriskopeChatForm} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="client_id" value={p.clientId} />
              <input
                name="chat_id"
                defaultValue={p.periskopeChatId ?? ""}
                placeholder="120363…@g.us"
                className="w-[260px] px-2.5 py-1.5 font-mono text-[12px]"
                style={inputStyle}
              />
              <SubmitButton variant="secondary" size="xs">Save</SubmitButton>
              <span className="text-[11.5px]" style={{ color: "var(--ink-400)" }}>
                Stored for reference; internal notices go to the staff group set under Integrations.
              </span>
            </form>
          ) : (
            <span className="font-mono text-[12px]" style={{ color: "var(--ink-900)" }}>
              {p.periskopeChatId ?? "—"}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
