This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Master client list → Teams / Outlook / WhatsApp

Ledger Logic is the interface over the firm's master client list
(`Client List Final ….xlsx` on the admin-team SharePoint site). The sheet
stays the source of truth for master data and team allotments; the CRM
watches it, imports every change and tells the people concerned.

```
OneDrive / SharePoint workbook
        │  (Graph, app-only; eTag change detection, every 30 min or on demand)
        ▼
/api/cron/sheet-sync ──► runSync: diff per client + incharge ──► client_activity
        │                                                            │
        │                      notification bell in the CRM ◄────────┤
        ▼                                                            ▼
Teams: client's own Team (General, @-mentions incharges)   Teams: firm-wide digest
Outlook: mail to incharges (optional)                      Periskope: staff WhatsApp group (optional)
```

Edits made inside the CRM (profile fields, allotments) go through the same
fan-out, so the team hears about a change whichever side it was made on.

### One-time setup

1. **Database** — run `supabase/migrations/20261026_teams_sync_notifications.sql`
   in the Supabase SQL editor (additive: new nullable columns + 4 small tables).
2. **Entra app registration** (the existing one used for the sheet):
   - Authentication → add Web redirect URI `https://<APP_URL>/api/microsoft/callback`.
   - API permissions → *Delegated*: `User.Read`, `User.ReadBasic.All`,
     `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Send`,
     `Mail.Send`, `offline_access`. Grant admin consent.
   - Keep the existing *Application* `Sites.Selected` / `Sites.Read.All` for reading the workbook.
3. **Vercel env** — see `.env.example`: `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`,
   `CRON_SECRET`, the three `GRAPH_*` values, optionally `PERISKOPE_API_KEY` +
   `PERISKOPE_PHONE`.
4. **Connect** — as an admin open **Integrations**, press *Connect Microsoft
   365* and sign in with the account that should post in Teams (a partner, or a
   dedicated "Ledger Logic" user that is a member of every client Team).
5. **Map teams** — *Refresh directory* on Integrations, then on **Teams map**
   accept the confident name matches in batches of 40 and pick the rest by hand
   (also possible from each client page). Choose a firm-wide channel for the digest.
6. Cron (`vercel.json`) runs `/api/cron/sheet-sync` every 30 minutes. For an
   instant sync, point a Power Automate flow (*When a file is modified* →
   *HTTP POST* `https://<APP_URL>/api/cron/sheet-sync` with header
   `Authorization: Bearer <CRON_SECRET>`) at the workbook.

### Why a connected account and not an app-only token

Microsoft Graph only allows *delegated* permissions to post channel messages
(application permissions exist solely for migration). The CRM therefore stores
one account's refresh token (`integration_tokens`, service-role only) and acts
on its behalf; messages show that account as the sender.

### ERPCA

ERPCA has no public API or webhooks that we could find, so there is no direct
hook yet. The sheet's `ERP CA Task` column is imported as before; the
`notification_log` table is the natural place to add an ERPCA bridge once the
vendor exposes one.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
