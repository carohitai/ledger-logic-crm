import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, delegatedConfigured } from "@/lib/microsoft/delegated";
import { requestOrigin } from "@/lib/microsoft/origin";

// Step 1 of connecting the firm's Microsoft 365 account: admin only, sets a
// CSRF state cookie and sends the browser to Entra's consent screen.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", requestOrigin(request)));
  const { data: me } = await supabase
    .from("staff")
    .select("app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (me?.app_role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  if (!delegatedConfigured()) {
    return NextResponse.redirect(
      new URL("/admin/integrations?error=Microsoft+Graph+env+vars+missing", requestOrigin(request))
    );
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(requestOrigin(request), state));
  res.cookies.set("ms_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
