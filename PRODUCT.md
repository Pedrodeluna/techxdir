# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript (React Router) for the frontend. Supabase (Auth, Postgres, Edge Functions on Deno) for the backend. Node 24 LTS, npm workspaces.

## Users

Developers who go to tech events in Spain: conferences, hackathons, community meetups. After and between events, they want one place that shows who they are, which events they went to, and which people they met there.

## Product Purpose

techxdir gives each attendee a digital event badge. The badge is the whole menu of the app:

- Tap the photo to edit your bio.
- Tap the events area to see the events you went to, and other events.
- Tap the contacts area to see the people you met at the same events, and other people.

Success: an attendee keeps the badge up to date after each event, finds people again, and shares the badge on social networks.

## Positioning

The badge is not a picture of a profile. It is the navigation. The physical object every attendee already wears at an event (vertical badge, photo top-left, events, contacts below) becomes the interface. The people list is built from shared attendance, not from follows.

## Operating Context

- Used on the phone at or after an event, and on desktop to curate the profile.
- Sharing: a 1080×1350 PNG of the badge for X, LinkedIn, WhatsApp, or the native share sheet.
- Organizations (HackSpain, Commit Conf, T3chFest, and others) run one or more events.

## Capabilities and Constraints

- Sign-in: Supabase Auth with X (Twitter) OAuth and email magic link. No passwords. Register is the first sign-in.
- The badge prototype works on sample data and localStorage. Real data will come from Supabase.
- UI language: Spanish.
- Undecided: how attendance is verified (self-declared today), organizer tools, public profile URLs.

## Brand Commitments

- Name: techxdir (wordmark "techx**dir**").
- Reference object: the HackSpain event badge, vertical format.

## Evidence on Hand

- Sample data in `web/src/data/sample.ts`: real event and organization names, invented people. People are examples, not users.
- No testimonials, user counts, partners, or press. Do not invent them.

## Product Principles

1. The badge is the menu. New features enter through the badge, not through a sidebar.
2. Real attendance before social graph. People appear because you shared an event.
3. Fast on a phone in a crowded hall.
4. Shareable by default. The badge must look good as an image.

## Accessibility & Inclusion

Keyboard access to every badge zone and panel (Esc goes back one step). Respect reduced motion except for the badge flip, which carries meaning.
