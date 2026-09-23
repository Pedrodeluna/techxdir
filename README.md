# techxdir

**Your tech-event badge is the menu.**

techxdir gives every attendee of tech events in Spain a digital badge, in the same vertical format as the physical badge you wear at HackSpain. The badge is the whole navigation of the app:

| Touch this zone | You get |
|---|---|
| **Photo** (top left) | Edit your photo, name, role, company and bio. The badge updates while you type. |
| **Events** (top right) | The events you went to and the events you will go to. Discover other events. |
| **Contacts** (bottom) | The people you met at the same events, and other people in the community. |

You can also share the badge as a 1080×1350 image on X, LinkedIn or WhatsApp.

> Status: early prototype. Sign-in, the profile and event attendance work against Supabase. People and event dates are still sample data, and the app labels them as examples. The photo stays in the browser.

---

## Contents

- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick start (demo mode)](#quick-start-demo-mode)
- [Run with a local Supabase](#run-with-a-local-supabase)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Routes](#routes)
- [Backend](#backend)
- [Deploy](#deploy)
- [Design system](#design-system)
- [Contributing](#contributing)
- [Authors](#authors)

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript (strict), Vite, React Router |
| Auth | Supabase Auth: X (Twitter) OAuth 2.0 and email magic link. No passwords. |
| Database | Supabase Postgres with row level security |
| Backend logic | Supabase Edge Functions (Deno) |
| Tooling | npm workspaces, oxlint, Deno test |

## Repository layout

```
.
├── web/                        React app (npm workspace)
│   ├── src/
│   │   ├── features/badge/     The badge: front, flip, panels, share image
│   │   ├── pages/              Landing, sign-in, auth callback
│   │   ├── lib/                Supabase client, auth provider, profile API
│   │   ├── data/sample.ts      Typed sample data (real events, invented people)
│   │   └── styles/             Design tokens, base and badge styles
│   └── .env.example
├── supabase/
│   ├── config.toml             Local stack config (ports 553xx)
│   ├── migrations/             Schema and row level security
│   ├── seed.sql                Organizations and events for local development
│   └── functions/
│       ├── _shared/cors.ts
│       └── profile/            GET / PATCH the caller's profile
├── PRODUCT.md                  Product context
├── DESIGN.md                   Design system ("The Lanyard Object")
└── package.json                Workspace root
```

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 24 LTS (see `.nvmrc`) | Frontend build and dev server |
| npm | 11+ | Workspaces |
| Docker | Any recent version | Local Supabase stack |
| Supabase CLI | 2.x | `supabase start`, migrations, functions |
| Deno | 2.x | Edge function tests (optional) |

With [mise](https://mise.jdx.dev) or nvm, run `mise use node@24` or `nvm use` in the repository root.

## Quick start (demo mode)

Demo mode needs no backend. The app uses the sample data and saves your changes in the browser.

1. Install the dependencies:
   ```sh
   npm install
   ```
2. Start the dev server:
   ```sh
   npm run dev
   ```
3. Open http://localhost:5173.

Without Supabase variables, `/entrar` shows a demo notice and `/acreditacion` opens the sample badge.

## Run with a local Supabase

1. Start the local stack. The first run downloads the Docker images (about 5 minutes):
   ```sh
   supabase start
   ```
   The stack applies `supabase/migrations/` and loads `supabase/seed.sql`.
2. Copy the local anon key into the frontend env:
   ```sh
   supabase status -o env | grep ANON_KEY
   cp web/.env.example web/.env.local   # then paste the key
   ```
3. Start the frontend:
   ```sh
   npm run dev
   ```
4. Sign in at http://localhost:5173/entrar with any email. Open the magic link from the local mail inbox at http://127.0.0.1:55324.

This project uses the ports **55320–55329** so that it can run next to another local Supabase project on the default 543xx ports.

### X (Twitter) sign-in

1. Create an app in the [X developer portal](https://developer.x.com) with OAuth 2.0 enabled.
2. Set the callback URL to `http://127.0.0.1:55321/auth/v1/callback` (local) or `https://<project-ref>.supabase.co/auth/v1/callback` (hosted).
3. Copy `supabase/.env.example` to `supabase/.env` and fill in the client ID and secret.
4. Restart the stack: `supabase stop && supabase start`.

## Environment variables

| File | Variable | Description |
|---|---|---|
| `web/.env.local` | `VITE_SUPABASE_URL` | Supabase API URL. Local: `http://127.0.0.1:55321`. |
| `web/.env.local` | `VITE_SUPABASE_ANON_KEY` | Public anon key. If this or the URL is missing, the app runs in demo mode. |
| `supabase/.env` | `SUPABASE_AUTH_EXTERNAL_X_CLIENT_ID` | X OAuth 2.0 client ID. |
| `supabase/.env` | `SUPABASE_AUTH_EXTERNAL_X_SECRET` | X OAuth 2.0 client secret. |

Never commit `.env` or `.env.local` files. The root `.gitignore` excludes them.

## Scripts

Run these from the repository root.

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server on port 5173. |
| `npm run build` | Type-check and build the frontend into `web/dist`. |
| `npm run lint` | Lint the frontend with oxlint. |
| `npm run preview` | Serve the production build. |
| `npm run supabase:start` | Start the local Supabase stack. |
| `npm run supabase:functions` | Serve the edge functions with hot reload. |
| `cd supabase/functions && deno task test` | Run the edge function tests. |

## Routes

| Path | Access | Page |
|---|---|---|
| `/` | Public | Landing page |
| `/entrar` | Public | Sign in or register (X or magic link) |
| `/auth/callback` | Public | Return from X or the magic link. Asks for name and X handle if they are missing. |
| `/ejemplo` | Public | Sample badge |
| `/acreditacion` | Signed in | Your badge (open to everyone in demo mode) |

## Backend

### Data model

| Table | Content | Row level security |
|---|---|---|
| `orgs` | Organizations that run events | Public read. Managers edit their organization. |
| `org_managers` | Who manages each organization | Public read. Managers add and remove managers; an organization always keeps one. |
| `events` | Events, with dates, city, URL and kind | Public read. Managers create, edit and delete their organization's events. Organizers edit their event. |
| `profiles` | One row per user, created by a trigger on the first sign-in | Public read. Each user updates only their own row. The X handle cannot change once set. |
| `attendances` | Which profile went to which event, as `attendee` or `organizer` | Signed-in read. Each user adds or removes only their own rows, as `attendee`. Managers choose the organizers of their events. |

The app derives contacts from shared attendance. There is no follow table.

Admins create organizations and name their first manager from the SQL editor:

```sql
insert into public.org_managers (org_id, profile_id)
select 'hackspain', id from public.profiles where lower(handle) = 'someone';
```

### `profile` edge function

The function runs as the caller (it forwards their JWT), so row level security applies.

| Method | Body | Result |
|---|---|---|
| `GET` | None | The caller's profile |
| `PATCH` | Any of `name`, `handle`, `role`, `company`, `bio`, `photo_url` | The updated profile. `400` for invalid input, `409` if the handle is taken, `403` if the handle was already set. |

```sh
curl http://127.0.0.1:55321/functions/v1/profile \
  -H "Authorization: Bearer <user access token>"
```

## Deploy

1. Create a project at [supabase.com](https://supabase.com) and link it:
   ```sh
   supabase link --project-ref <project-ref>
   ```
2. Push the schema and deploy the function:
   ```sh
   supabase db push
   supabase functions deploy profile
   ```
3. In the Supabase dashboard, set the site URL and add `https://<your-domain>/auth/callback` to the redirect URLs. Enable the X provider.
4. Build the frontend with the hosted `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and deploy `web/dist` to any static host. Configure the host to serve `index.html` for all routes (single-page app).

## Design system

`DESIGN.md` records the visual system: a warm paper badge on a grey hall floor, ink type, one orange signal, JetBrains Mono for printed fields, and a full card turn as the page transition. `PRODUCT.md` records the product context. Read both before you add a screen.

## Contributing

1. Create a branch from `main`: `feat/<topic>` or `fix/<topic>`.
2. Keep `npm run build` and `npm run lint` green.
3. Write commit messages in [Conventional Commits](https://www.conventionalcommits.org) format, in English:
   ```
   feat(badge): add event search
   fix(auth): show an error when the magic link expired
   ```
4. Open a pull request against `main`.

## Authors

A side project by [@pedrodelunah](https://x.com/pedrodelunah), [@franms_dev](https://x.com/franms_dev) and [@elashera](https://x.com/elashera).
