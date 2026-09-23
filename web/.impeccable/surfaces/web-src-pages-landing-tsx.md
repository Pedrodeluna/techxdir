---
version: 1
slug: "web-src-pages-landing-tsx"
primary_target: "web/src/pages/Landing.tsx"
related_targets: []
---

# Surface: Landing (`/`)

Mode: Persuade. Audience: developers who go to tech events in Spain. Action: "Recoge tu acreditación" → `/entrar`. Secondary: open the demo badge (`/ejemplo`). Proof: the live badge (sample data, labelled "ejemplo"), real event names as the events the product covers (no partnership claim), maker credits. Avoid: generic SaaS look, long copy, dark neon.

## Direction contract

THESIS: The landing is the printed programme you get with your badge. It refuses the SaaS hero + feature grid: the page is a schedule and a badge, nothing else.

OWN-WORLD: The Lanyard Object. Badge Paper sheet on Hall Floor, ink type, JetBrains Mono schedule rows with hairline rules, Space Grotesk light display, pill actions, one Signal Orange mark (the "today" line in the schedule).

STORY: A visitor sees their future badge, understands the three zones in one glance, sees events they know, and signs in to get their own.

FIRST VIEWPORT: Desktop: a one-line display headline (≤ 7 words, "Tu acreditación es el menú.") across the full grid; below it, left 6/12 columns: a sentence, the ink pill "Recoge tu acreditación" and a text link "Ver una de ejemplo"; below, the programme: a mono table of real events (date, event, city, kind) with a "hoy" orange rule between past and upcoming. Right 5/12: the live badge at full size, zones clickable, marked "ejemplo". Mobile: headline, CTA, badge, then programme.

FORM: The Printed Programme, position 4 on my ordered list, seed key 18660bb1.

SIGNATURE INTERACTION: hovering a programme row highlights the badge zone it feeds (events count / org logos); clicking a badge zone scrolls to its entry in the "Cómo se usa" programme table (foto, eventos, coincidencias as three programme rows, then a last row "Tú · Recoge la tuya" with the CTA). No closing CTA band. Programme dates are labelled as example dates until the calendar is connected.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
