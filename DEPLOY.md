# AlzCare — Going Live (hosted Supabase + Vercel, local ingest server)

This deploys the **dashboard to Vercel** with the **database on hosted Supabase**,
while the **MQTT broker + bridge + shim run on your machine**. The bridge
computes positioning + alerts **in-process** and writes everything (plus a
heartbeat) up to the hosted project — so **no edge functions are deployed** and
hosted Supabase is just the database + realtime + auth. The live dashboard shows
a **"Server online / offline"** indicator from the heartbeat: turn the local
server on and data flows; turn it off and it goes stale.

```
your machine: sensors ─▶ broker ─▶ shim ─▶ bridge ─┐  (computes position + alerts)
                                                    ├─▶ HOSTED Supabase ─▶ realtime ─▶ Vercel dashboard
                                       heartbeat ───┘
```

> The live site can't reach into your machine (NAT/firewall), so the local
> server **pushes up** to hosted Supabase; the dashboard reads from there. All
> compute is local, so there are no edge functions, DB webhooks, or Vault
> secrets to manage on hosted.

---

## 0. Prerequisites

- The local stack works (see `SETUP.md`).
- A **hosted Supabase project** for AlzCare. The repo references
  `lchalkfkqftpxglgzkct` — that project must be reachable by your Supabase
  login. Verify:

  ```bash
  supabase login            # log into the account that OWNS the project
  supabase projects list    # the AlzCare project ref must appear here
  ```

  If it doesn't appear, you're logged into the wrong account/org — fix that
  before continuing.
- Vercel CLI logged in: `vercel login` (you're `hashfordd`).
- Have the hosted project's **API URL**, **publishable (anon) key**, and
  **service-role key** ready (Supabase dashboard → Project Settings → API).

---

## 1. Hosted Supabase — one-time setup

From `codebase/` — just the schema + seed data (no functions, no Vault):

```bash
# Link the CLI to the hosted project
supabase link --project-ref lchalkfkqftpxglgzkct

# Apply all migrations (incl. local_ingest_status for the heartbeat)
supabase db push
```

**Seed** the admin + the Live Feed Test patient into the hosted DB
(`ALLOW_NON_LOCAL=1` is required — these tools refuse non-local URLs by default):

```bash
ALLOW_NON_LOCAL=1 \
SB_URL=https://lchalkfkqftpxglgzkct.supabase.co \
SB_ANON_KEY=YOUR_HOSTED_PUBLISHABLE_KEY \
SB_SERVICE_KEY=YOUR_HOSTED_SERVICE_ROLE_KEY \
  npm run seed && \
ALLOW_NON_LOCAL=1 SB_URL=https://lchalkfkqftpxglgzkct.supabase.co \
SB_SERVICE_KEY=YOUR_HOSTED_SERVICE_ROLE_KEY \
  npm run seed:live
```

---

## 2. Dashboard — deploy to Vercel

From `codebase/`:

```bash
vercel link        # link this folder to the Vercel project
```

Set the project's environment variables (Vercel dashboard → Settings →
Environment Variables, or `vercel env add`):

| Var                       | Value                                            |
| ------------------------- | ------------------------------------------------ |
| `VITE_SUPABASE_URL`       | `https://lchalkfkqftpxglgzkct.supabase.co`       |
| `VITE_SUPABASE_ANON_KEY`  | the hosted **publishable** key (`sb_publishable_…`) |
| `VITE_MAPBOX_TOKEN`       | your Mapbox token                                |

```bash
vercel --prod      # build + deploy
```

Open the deployed URL and sign in (`admin@bizzieapp.com` / `DemoPass123!`).

> If live tiles/positions never update on the deployed site, realtime isn't
> delivering — confirm the tables are in the `supabase_realtime` publication and
> try the JWT anon key. (Hosted realtime usually works with the publishable key;
> the JWT-key requirement was a local-stack quirk.)

---

## 3. Turn ON the local ingest server

One-time config:

```bash
cp apps/edge/.env.live.example apps/edge/.env.live
# edit apps/edge/.env.live → set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (hosted)
```

Then, whenever you want to feed the live dashboard:

```bash
npm run stack:live          # broker + bridge + shim, pointed at hosted
```

Drive a sensor in another tab (`npm run sim`, or the D1 scenarios, or real
hardware). The deployed dashboard's header flips to **"Server online"** and the
data flows up. **Ctrl-C** `stack:live` → the heartbeat goes stale and the
dashboard shows **"Server offline."**

Pair real hardware exactly as locally: **Pair device → type the MAC**, then have
it publish to `device/{mac}/…` (see `SETUP.md`).

---

## 4. Before real patients (hardening)

- Replace self-signed broker certs with real TLS; require per-device
  credentials + ACL (see `mqtt-infra/`).
- Rotate the dev secrets (`bridgepass`, the demo passwords/keys).
- Consider a managed/cloud broker if the ingest server must run unattended.
- Lock down who can read `local_ingest_status` / patient data via RLS review.

---

## 5. Quick reference

| Action               | Command (from `codebase/`) |
| -------------------- | -------------------------- |
| Local-only dev stack | `npm run stack:up`         |
| Live ingest server   | `npm run stack:live`       |
| Push migrations      | `supabase db push`         |
| Deploy dashboard     | `vercel --prod`            |

Local-only setup + day-to-day usage: see **`SETUP.md`**.
