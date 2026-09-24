---
version: 1
slug: "web-src-pages-admin-tsx"
primary_target: "web/src/pages/Admin.tsx"
related_targets: []
---

# /admin surface brief

Scope: the admin dashboard at /admin. Mode: Operate. Visitor: a techxdir app admin (2–3 people) on desktop, sometimes phone. Job: manage organizations, events, users (ban/unban) and admins. Constraints: Spanish UI, DESIGN.md world unchanged.

## Direction contract

THESIS: A printed index, not a SaaS sidebar. The left column is a mono section index with counts, like the field list of a badge; the right column is a hairline ledger. Refuses the card grid + icon sidebar admin default.

OWN-WORLD: Hall Floor ground, one Badge Paper sheet for the detail column, Press Ink text. Mono uppercase labels and IDs, grotesk names. Pill buttons, underlined inputs, hairline rows. Signal Orange only for the active index dot and invalid fields.

STORY: The admin sees the four counts, picks a section, finds a row, edits it in place in the same column, and gets a toast. Destructive actions ask for the slug.

FIRST VIEWPORT: Wordmark + "Admin" label top-left, account actions top-right. Left: index 01–05 with light numerals. Right: paper sheet, section headline 44px, search underline, "+ Nuevo" ink pill top-right, ledger rows below.

FORM: Index + detail, candidate 2 of 6 in the ranked list (dealt 3, 2, 4), seed key f5a5da79.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
