// Name matching between CRM clients and Microsoft Teams team names.
// Token-based (Dice coefficient over normalised words) so "USHA AUTOMOBILES"
// matches "Rajendra Agrawal Usha Automobiles Tirupati traders" reasonably,
// while legal-form noise words don't inflate scores.

const NOISE = new Set([
  "PRIVATE", "PVT", "LIMITED", "LTD", "LLP", "M/S", "MS", "HUF", "AND", "&", "THE", "OF",
  "PROP", "PROPRIETOR", "ITR", "GST", "TEAM", "GROUP", "FAMILY", "ENTERPRISES", "ENTERPRISE",
  "CO", "COMPANY", "TRADERS", "TRADING", "INDUSTRIES", "INDUSTRY",
]);

export function tokens(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (s ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/)) {
    if (raw.length < 2 || NOISE.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

export function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

export interface Candidate {
  id: string;
  name: string;
  description?: string | null;
}

export interface Suggestion {
  id: string;
  name: string;
  score: number;
}

/**
 * Best team for a client, comparing both the legal name and trade name against
 * each team's display name (and description, which often carries the trade
 * name). Returns null below `threshold`.
 */
export function suggestTeam(
  client: { name: string; trade_name: string | null },
  teams: { id: string; name: string; nameTokens: Set<string>; descTokens: Set<string> }[],
  threshold: number
): Suggestion | null {
  const n = tokens(client.name);
  const t = tokens(client.trade_name);
  let best: Suggestion | null = null;
  for (const team of teams) {
    const score = Math.max(
      dice(n, team.nameTokens),
      dice(t, team.nameTokens),
      // Description matches count a little less — they are looser text.
      dice(n, team.descTokens) * 0.9,
      dice(t, team.descTokens) * 0.9
    );
    if (score >= threshold && (!best || score > best.score)) {
      best = { id: team.id, name: team.name, score };
    }
  }
  return best;
}

export function indexTeams(teams: Candidate[]) {
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    nameTokens: tokens(t.name),
    descTokens: tokens(t.description),
  }));
}
