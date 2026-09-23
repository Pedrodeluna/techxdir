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
| Auth | Supabase Auth: X (Twitter) OAuth 1.0a and email magic link. No passwords. |
| Database | Supabase Postgres with row level security |
| Backend logic | Supabase Edge Functions (Deno) |
| Tooling | npm workspaces, oxlint, Deno test |

## Repository layout

```
.
├── .env.example                Template for local Supabase OAuth secrets
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
3. Open http://127.0.0.1:55330.

Without Supabase variables, `/entrar` shows a demo notice and `/acreditacion` opens the sample badge.

## Run with a local Supabase

This starts a separate local database and Auth service; hosted users and data are not copied. Use `127.0.0.1` consistently for both services and the browser.

1. Install the dependencies with Node 24:
   ```sh
   npm ci
   ```
2. For **Sign in with X**, copy the server-side template to the repository root:
   ```sh
   cp .env.example .env
   ```
   Set `SUPABASE_AUTH_EXTERNAL_TWITTER_CLIENT_ID` to the X app's **API Key** and `SUPABASE_AUTH_EXTERNAL_TWITTER_SECRET` to its **API Secret Key**. These are the OAuth 1.0a credentials, not the OAuth 2.0 Client ID/Secret. The two `SUPABASE_AUTH_EXTERNAL_X_*` entries can stay empty because the OAuth 2.0 provider is disabled. If you only need email login, you can skip this step.
3. In the X Developer app's user authentication settings, enable **Sign in with X** and add this exact callback URL:
   ```text
   http://127.0.0.1:55321/auth/v1/callback
   ```
   Keep the hosted Supabase callback if the same X app serves production. The local website URL is `http://127.0.0.1:55330`. This is the callback to **Supabase Auth**, not the frontend route `/auth/callback`.
4. Start the local stack from the repository root:
   ```sh
   supabase start
   ```
   The first run downloads Docker images. The stack applies `supabase/migrations/` and loads `supabase/seed.sql`. After changing `.env`, restart it with `supabase stop` followed by `supabase start`; restarting Vite alone does not reload Auth credentials.
5. Copy `web/.env.example` to `web/.env.local` if it does not already exist. Set `VITE_SUPABASE_URL=http://127.0.0.1:55321`, copy the local `ANON_KEY` from `supabase status -o env` into `VITE_SUPABASE_ANON_KEY`, and leave `VITE_X_AUTH_PROVIDER=twitter`. Never put the X API Secret Key in a `VITE_` variable; those values are sent to the browser.
6. Start the frontend:
   ```sh
   npm run dev
   ```
   Open http://127.0.0.1:55330/entrar and choose **Continuar con X**. X returns to local Supabase Auth, which redirects to `http://127.0.0.1:55330/auth/callback`. The first sign-in creates a local profile. A verified X identity with username `elashera` receives the local global admin grant and can open `/organizaciones` to create an organization.

Email sign-in also works without X credentials. Enter an email at `/entrar`, then open its newest magic link in the local inbox at http://127.0.0.1:55324. Email sign-in does not grant admin rights just because a user chooses the handle `elashera`.

This project uses port **55330** for Vite and **55320–55329** for local Supabase so that it can run next to other local projects. Vite fails if port 55330 is occupied instead of silently serving this app on a different port.

If X redirects to a page saying `no Route matched with those values`, check both parts of the setup: the `SUPABASE_AUTH_EXTERNAL_TWITTER_*` variables must be set in the root `.env` and loaded by restarting Supabase, and X must approve the exact local callback above. X reports an unapproved callback as error 415; Supabase's legacy Twitter flow may still surface it as the same `no Route matched` page.

### X (Twitter) sign-in

The active login uses X OAuth 1.0a: the frontend calls `provider: 'twitter'`, and Supabase uses **Twitter (Deprecated)**. This is the flow tested against the hosted `techxdir` project. **X / Twitter (OAuth 2.0)** (`provider: 'x'`) is not configured there. OAuth 1.0a uses the X app's API Key and API Secret Key; its Bearer Token and OAuth 2.0 Client ID/Secret are not used. Supabase recommends OAuth 2.0 for new integrations and plans to deprecate this legacy provider. Do not assume OAuth 1.0a is free; check the applicable X Developer charges.

In the hosted Supabase Dashboard, open **Authentication → Sign In / Providers → Twitter (Deprecated)** and enable it. Enter the X app's **API Key** as the provider key/client ID and its **API Secret Key** as the provider secret. Turn on **Allow users without an email**: X may not return one, and without this setting sign-in fails. Copy the Supabase callback URL shown there into the X app's callback settings (`https://<project-ref>.supabase.co/auth/v1/callback`), and enable **Sign in with X** in the X app. Add the frontend's `/auth/callback` URL to Supabase Authentication → URL Configuration → Redirect URLs.

To test the web app locally against the hosted Supabase project, use `http://127.0.0.1:55330` as the X app's **Website URL** if X rejects `localhost` in that field (Supabase documents `127.0.0.1` as a development option). Keep `https://<project-ref>.supabase.co/auth/v1/callback` as the X **Callback URL**. Add `http://127.0.0.1:55330/auth/callback` to the hosted project's Authentication → URL Configuration → Redirect URLs. In `web/.env.local`, set `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`, `VITE_SUPABASE_ANON_KEY` to that project's publishable/anon key, and `VITE_X_AUTH_PROVIDER=twitter`. Run `npm run dev` and open `http://127.0.0.1:55330/entrar` (use this exact host so it matches the redirect URL). X returns to hosted Supabase, which then returns to the local web app. This route does not require local Supabase or a second X callback; test sign-ins and profile changes use the hosted project's real data.

The local X OAuth setup is described in [Run with a local Supabase](#run-with-a-local-supabase). Do not switch existing users between `twitter` and `x` without checking account identity linking; the provider identifier changes.

## Environment variables

| File | Variable | Description |
|---|---|---|
| `web/.env.local` | `VITE_SUPABASE_URL` | Supabase API URL. Local: `http://127.0.0.1:55321`. |
| `web/.env.local` | `VITE_SUPABASE_ANON_KEY` | Public anon key. If this or the URL is missing, the app runs in demo mode. |
| `web/.env.local` | `VITE_X_AUTH_PROVIDER` | `twitter` (default, OAuth 1.0a). `x` requires separately configuring the OAuth 2.0 provider in Supabase and X. |
| `.env` (repository root) | `SUPABASE_AUTH_EXTERNAL_TWITTER_CLIENT_ID` | X OAuth 1.0a API Key; only for the legacy provider. |
| `.env` (repository root) | `SUPABASE_AUTH_EXTERNAL_TWITTER_SECRET` | X OAuth 1.0a API Secret Key; only for the legacy provider. |
| `.env` (repository root) | `SUPABASE_AUTH_EXTERNAL_X_CLIENT_ID` | X OAuth 2.0 Client ID; unused by the active setup. |
| `.env` (repository root) | `SUPABASE_AUTH_EXTERNAL_X_SECRET` | X OAuth 2.0 Client Secret; unused by the active setup. |

Commit `.env.example` and `web/.env.example`; never commit `.env`, `web/.env.local`, or backups such as `web/.env.hosted.local`. The root `.gitignore` excludes local env files while allowing the examples. Check with `git status --short` before committing; no real key should appear in a tracked file.

## Scripts

Run these from the repository root.

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server on port 55330. |
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
| `/organizaciones` | Signed in | Organization directory. Admins create and delete organizations; admins and organization managers edit names, logos and managers. |

## Backend

### Data model

| Table | Content | Row level security |
|---|---|---|
| `orgs` | Organizations that run events | Public read. Admins and managers edit the name and logo; only admins create via `create_org` or delete. |
| `app_admins` | Global admin grants, keyed by profile UUID | Each admin reads only their own grant. Writes are reserved for database operators. |
| `org_managers` | Who manages each organization | Public read. Managers add and remove managers; an organization always keeps one. |
| `events` | Events, with dates, city, URL and kind | Public read. Managers create, edit and delete their organization's events. Organizers edit their event. |
| `profiles` | One row per user, created by a trigger on the first sign-in | Public read. Each user updates only their own row. The X handle cannot change once set. |
| `attendances` | Which profile went to which event, as `attendee` or `organizer` | Signed-in read. Each user adds or removes only their own rows, as `attendee`. Managers choose the organizers of their events. |

The app derives contacts from shared attendance. There is no follow table.

### Roles and permissions

| Action | Global admin | Organization manager | Event organizer | Attendee |
|---|---|---|---|---|
| Create an organization and choose its first manager | Yes | No | No | No |
| Edit an organization's name, logo and managers | Any organization | Their organization | No | No |
| Delete an organization, its events and their attendances | Yes | No | No | No |
| Create and delete events | When also its manager | Their organization's events | No | No |
| Edit event details | When also its manager or organizer | Their organization's events | Their event | No |
| Choose event organizers | When also its manager | Their organization's events | No | No |
| Mark their own attendance | Yes | Yes | Yes | Yes |

These are two independent scopes: global `app_admins` and per-organization `org_managers`. An event organizer is an attendance row with role `organizer`. The UI currently covers organization creation and management; event editing remains enforced in the database but has no editor yet.

The first global admin is the account verified by X as `@elashera`. The migration grants that account by its provider identity if it already exists, or on its first X sign-in afterward. An email account that merely chooses `elashera` as its profile handle gets no admin grant. Check `public.app_admins` after deploying the migration to confirm the bootstrap. Additional admins are added only after checking their account UUID:

```sql
insert into public.app_admins (profile_id) values ('<verified-profile-uuid>');
```

Admins create organizations at `/organizaciones`, entering a stable slug, public name and first manager's techxdir handle. Creation and assignment are atomic. Admins and organization managers can change the name and logo and add or remove managers there. The last manager cannot be removed. Only admins can delete an organization; the page shows its event count and requires typing the slug. Deletion cascades to its events, their attendances and manager assignments. Managers create events and designate event organizers according to the existing database policies; an editor for those event operations is future UI work. The badge's `profiles.role` is free-form job text and grants no permissions.

For seeded organizations, a database operator can assign an initial manager:

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
3. In the Supabase dashboard, set the production Site URL and add `https://<your-domain>/auth/callback` to the redirect URLs. Configure **Twitter (Deprecated)** and **Allow users without an email** as above. Do not leave the default `http://localhost:3000` Site URL in a production deployment.
4. Build the frontend with the hosted `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and deploy `web/dist` to any static host. Configure the host to serve `index.html` for all routes (single-page app). For the Vercel project whose root directory is `web`, `web/vercel.json` supplies this rewrite so direct visits to `/entrar` and OAuth returns to `/auth/callback` work.

For automatic deployment when a pull request is merged into `main`, connect this repository in Supabase Dashboard → Project Settings → Integrations → GitHub Integration. Set the working directory to `.` and enable **Deploy to production** for `main`. Supabase applies new migrations and deploys Edge Functions declared in `supabase/config.toml`, including `profile`. This does not require a GitHub Actions workflow or repository secrets. **Auth settings in `config.toml` are ignored for production deployments by this integration**; configure the hosted provider, its email option, Site URL, and redirect URLs in the Supabase Dashboard.

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
