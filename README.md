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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## Omnichannel inbox & compliance tasks

Two features share this stack: a unified per-client communication timeline
(Outlook mail + WhatsApp + calls) and recurring statutory task management
(Accounting / Income Tax / TDS / GST / Professional Tax).

### Which department data can actually be fetched

| Source | API? | Status here |
|---|---|---|
| Outlook mail | Microsoft Graph `/users/{upn}/messages/delta` | Implemented |
| WhatsApp | Nextel (send + inbound webhook) | Already live |
| Call logs | Yeastar P-Series `/cdr/search` | Implemented (full CDR, in and out) |
| GST | Full GSTN APIs need a **licensed GSP contract**. A free public GSTIN lookup returns per-period return-filing status with no contract. | `public-gst` adapter implemented, off by default; `gsp-gst` declared |
| Income Tax | Official **ERI Type-2 API** — needs the firm registered as an e-Return Intermediary + DSC | `eri-income-tax` declared, not onboarded |
| TDS / TRACES | **No API exists.** Portal only. | Manual — tracked, never auto-closed |
| Professional Tax | **No API exists** (MahaGST is portal only). | Manual — tracked, never auto-closed |

### Microsoft Graph mail — one-time tenant setup

Reuses the existing Entra app (`GRAPH_*`). An admin must:

1. Add the **application** permission `Mail.Read` and grant admin consent.
   (`Mail.ReadBasic.All` is insufficient — it excludes `bodyPreview`.)
2. **Scope it.** By default that permission reads *every* mailbox in the
   tenant. Restrict it before granting:

   ```powershell
   New-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> `
     -PolicyScopeGroupId ka-crm-mailboxes@<domain> `
     -AccessRight RestrictAccess -Description "KA CRM inbox"
   ```

   This policy is the security boundary and is not optional. Changes take up
   to ~30 minutes to propagate.

Mailboxes are then managed at `/admin/mailboxes` — no redeploy to add one.

### Scheduling

`vercel.json` registers a single `/api/cron/tick` dispatcher; each job is gated
internally on the IST clock. This keeps the cron-entry count within Vercel's
per-plan limit and means new jobs need no `vercel.json` change.

```
GET /api/cron/tick                          # run whatever is due
GET /api/cron/tick?only=mail&force=1        # run one job on demand
GET /api/cron/tick?only=tasks&dryRun=true   # count without writing
```

Authorised with `Authorization: Bearer $CRON_SECRET`.

### Environment variables

Every new integration is **off by default**; deploying changes nothing until a
flag is set.

| Var | Default | Purpose |
|---|---|---|
| `MAIL_SYNC_ENABLED` | `false` | Enable Outlook sync |
| `GRAPH_MAILBOXES` | — | Comma-separated UPNs; seeds `mailboxes` on first run only |
| `FIRM_MAIL_DOMAINS` | — | Comma-separated; decides inbound vs outbound |
| `MAIL_SYNC_BACKFILL_DAYS` | `90` | First-run window. Graph caps a filtered delta at 5,000 messages — lower this if that ceiling is hit |
| `MAIL_SYNC_MAX_PAGES` | `10` | Pages per mailbox per tick |
| `CDR_SYNC_ENABLED` | `false` | Enable Yeastar CDR sync |
| `CDR_LOOKBACK_HOURS` | `24` | First-run watermark |
| `CDR_MAX_RECORDS_PER_RUN` | `500` | |
| `TASKS_ENABLED` | `false` | Enable task generation |
| `TASK_GEN_HORIZON_DAYS` | `45` | How far ahead to generate |
| `CRON_DAILY_HOUR_IST` | `3` | Hour the daily jobs run |
| `DEPT_SYNC_ENABLED` | `false` | Enable department filing-status reconciliation |
| `DEPT_PROVIDER_GST` | — | `public-gst` to enable the free GST lookup |
| `PUBLIC_GST_API_URL` | — | Base URL for that lookup |
| `PUBLIC_GST_API_KEY` | — | Optional bearer token |
| `DEPT_SYNC_MAX_PER_RUN` / `DEPT_SYNC_DELAY_MS` / `DEPT_SYNC_CACHE_HOURS` | `100` / `400` / `24` | Rate limiting |
| `GSP_GST_BASE_URL` / `GSP_GST_CLIENT_ID` / `GSP_GST_CLIENT_SECRET` | — | Declared, unimplemented |
| `ERI_BASE_URL` / `ERI_USER_ID` / `ERI_PASSWORD` | — | Declared, unimplemented |

### Database migrations

`supabase/migrations/` is new. Until now all schema lived only in the hosted
Supabase project, invisible to the repo. Anything applied via the Supabase MCP
must also be committed here or the schema goes invisible again.

### Tests

`npm run test:dates` checks the statutory due-date calendar (GSTR-1/3B monthly
and QRMP, GSTR-9, ITR audit/non-audit, 3CD, TDS payment and returns including
the March and Q4 exceptions, PTRC, and month-length clamping).
