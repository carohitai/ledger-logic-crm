import { NextResponse } from "next/server";
import { connectWithCode } from "@/lib/microsoft/delegated";
import { requestOrigin } from "@/lib/microsoft/origin";

// Step 2: Entra redirects back here with ?code=…&state=…; we swap the code for
// tokens and store them for the cron / notifier.
export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/admin/integrations?${q}`, origin));

  const error = url.searchParams.get("error");
  if (error) {
    const desc = url.searchParams.get("error_description") ?? error;
    return back(`error=${encodeURIComponent(desc.slice(0, 300))}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith("ms_oauth_state="))
    ?.slice("ms_oauth_state=".length);
  if (!code || !state || !cookieState || state !== cookieState) {
    return back("error=Sign-in+state+mismatch+%E2%80%94+please+try+connecting+again");
  }

  try {
    const conn = await connectWithCode(code, origin);
    const res = back(`connected=${encodeURIComponent(conn.account_upn ?? "ok")}`);
    res.cookies.delete("ms_oauth_state");
    return res;
  } catch (e) {
    return back(`error=${encodeURIComponent((e instanceof Error ? e.message : String(e)).slice(0, 300))}`);
  }
}
