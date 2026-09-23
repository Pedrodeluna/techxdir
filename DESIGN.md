---
name: techxdir
description: The tech-event badge that is also the menu.
colors:
  signal-orange: "#ff4d00"
  hall-floor: "#ebeae6"
  badge-paper: "#fbfbf9"
  press-ink: "#111113"
  pencil-grey: "#8b8a90"
  hairline: "rgba(17, 17, 19, .1)"
  soft-press: "rgba(17, 17, 19, .045)"
typography:
  display:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "4.4em"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-.06em"
  headline:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-.045em"
  title:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "2.1em"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-.045em"
  body:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: ".15em"
rounded:
  zone: ".9em"
  photo: "12px"
  badge: "20px"
  sheet: "22px"
  pill: "99px"
spacing:
  gutter: "16px"
  badge-pad: "1.5em"
  panel-gap: "clamp(40px, 6vw, 96px)"
components:
  button-primary:
    backgroundColor: "{colors.press-ink}"
    textColor: "{colors.badge-paper}"
    rounded: "{rounded.pill}"
    padding: "12px 22px"
  pill-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.press-ink}"
    rounded: "{rounded.pill}"
    padding: "7px 13px"
  pill-toggle-on:
    backgroundColor: "{colors.press-ink}"
    textColor: "{colors.badge-paper}"
    rounded: "{rounded.pill}"
  badge-card:
    backgroundColor: "{colors.badge-paper}"
    rounded: "{rounded.badge}"
    width: "min(440px, calc((100dvh - 130px) / 1.5), calc(100vw - 32px))"
  input-underline:
    backgroundColor: "transparent"
    textColor: "{colors.press-ink}"
    rounded: "0"
    padding: "10px 0"
  toast:
    backgroundColor: "{colors.press-ink}"
    textColor: "{colors.badge-paper}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
---

# Design System: techxdir

## Overview

**Creative North Star: "The Lanyard Object"**

techxdir is a printed event badge, not a web page that describes one. A single vertical card of warm paper hangs in a grey hall, with a punched lanyard slot at the top. Everything the app does happens by touching that card: it turns on its vertical axis, moves aside, and a panel appears next to it. The world is physical and quiet. There is one colour signal, and it is small.

Density is low on the badge and medium in the panel. The badge carries four facts in big light numerals and a mono label system. The panel is a reading column with underlined inputs, pill toggles, and lists with hairline dividers. Motion is part of navigation: the full turn of the card tells you where the panel will be.

Rejected by the team: generic SaaS pages (gradients, icon feature grids, logo walls, testimonials), long copy, and dark neon "hacker" styling.

**Key Characteristics:**
- One object on one surface: a paper badge on a hall floor.
- Light numerals (300) set big and tight, mono uppercase labels set small and wide.
- Ink and paper. Orange only as a signal dot, an invalid underline, or an accent.
- Depth from a single long soft shadow and a hairline edge, never from colour blocks.
- A full rotateY turn (1.2 s) is the page transition.

## Colors

Warm neutrals with one hot signal.

### Primary
- **Signal Orange** (`signal-orange`): the active-zone dot, invalid field underline, and at most one accent per view. Never a background.

### Neutral
- **Hall Floor** (`hall-floor`): the page background and the lanyard slot. The "room" the badge hangs in.
- **Badge Paper** (`badge-paper`): the card face, the mobile panel sheet, text on ink buttons.
- **Press Ink** (`press-ink`): all primary text, primary buttons, toggled pills, the toast.
- **Pencil Grey** (`pencil-grey`): labels, secondary text, counts, the "dir" in the wordmark.
- **Hairline** (`hairline`): dividers, input underlines, the card edge ring.
- **Soft Press** (`soft-press`): hover and active wash on badge zones.

Avatars use the Hall Floor hue with lightness 70–89 % from a name hash (`hsl(40 6% L%)`). Event colours in the data are not used in the UI yet.

### Named Rules
**The One Signal Rule.** Signal Orange covers less than 2 % of any screen. If two orange things are visible at once, one of them is wrong.

**The Paper-on-Floor Rule.** Surfaces are Badge Paper on Hall Floor. Do not add a third surface colour.

## Typography

**Display / Body Font:** Space Grotesk (with system-ui)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo)

**Character:** A geometric grotesk used light and tight for numbers and names, paired with a small wide mono for every label, date, and handle, like the printed fields of a real badge.

### Hierarchy
- **Display** (300, 4.4em of the card, line-height 1, -.06em): the event count and people count on the badge. Share image uses the same at 172px.
- **Headline** (400, 44px, 34px under 900px, -.045em): panel titles.
- **Title** (500, 2.1em of the card, -.045em): the attendee name. 24px for a person profile.
- **Body** (400, 15px; 13px for meta lines): list rows, bio, form values.
- **Label** (JetBrains Mono 500, 10.5px / .64em of the card, .15em tracking, uppercase): section labels, group titles, dates, tier text, credits.

### Named Rules
**The Printed Field Rule.** Anything a badge printer would stamp (labels, dates, IDs, handles) is mono. Anything a person says (names, bio, event names) is grotesk.

**The Light Numeral Rule.** Big numbers are weight 300 with negative tracking. Never bold a number.

## Layout

The badge is sized by height: `--w` is the largest width that fits the viewport at a 2:3 ratio (max 440px), and all badge type is in `em` of the card (`font-size: w / 27.5`, so 1em is 16px at full size). The badge face is a two-column grid: photo and events on top, identity full width, people full width.

On desktop (≥ 900px) the card and a 480px panel sit side by side with a `clamp(40px, 6vw, 96px)` gap. Bio opens the panel on the left, events and people on the right. Under 900px the card scales to 32 % and moves to the top, and the panel becomes a bottom sheet (22px top corners). Page gutters are 16px. The badge page never scrolls; only the panel body scrolls.

## Elevation & Depth

Depth comes from one lifted object. The badge has a hairline ring, a tiny contact shadow, and one long soft drop shadow. The lanyard slot is an inset. Everything else is flat and separated by hairlines. The mobile sheet has one upward shadow.

### Shadow Vocabulary
- **Badge lift** (`box-shadow: 0 0 0 1px var(--line), 0 2px 4px rgba(0,0,0,.04), 0 40px 80px -40px rgba(0,0,0,.35)`): the badge card only.
- **Lanyard slot** (`box-shadow: inset 0 1px 2px rgba(0,0,0,.22)`): the punched hole.
- **Sheet** (`box-shadow: 0 -10px 40px rgba(0,0,0,.08)`): the mobile panel.

### Named Rules
**The Single Object Rule.** Only the badge (and its share preview) is lifted. Panels, lists and buttons stay flat.

## Shapes

The card has gently rounded corners (20px), the zones inside it rounder in proportion (.9em). Every control that you press is a full pill (99px): primary button, event toggle, share button, toast. Inputs have no box at all, only a hairline underline. Avatars and the close button are circles. Organization logos are monograms in six shapes (circle, square, squircle, hex, diamond, ring) filled with ink.

## Components

### Buttons
- **Shape:** full pill (99px).
- **Primary:** ink background, paper text, 500 weight, 12px 22px padding.
- **Hover / Focus:** opacity .85 on hover, scale .97 on press, 1.5px ink outline with 3px offset on focus.
- **Link:** 13px text with a hairline underline offset 3px. Used for secondary actions (Cancelar, Cambiar foto).

### Chips
- **Pill toggle ("Fui" / "Voy"):** 1px inset ink ring, 12.5px 500. Toggled on: ink fill, paper text, a check mark, and a short stamp animation.
- **Tag ("En común"):** mono 10.5px, ink pill with paper text.

### Cards / Containers
- **Badge card:** Badge Paper, 20px radius, badge-lift shadow, 1.5em padding, lanyard slot at top centre.
- **Badge zones:** transparent buttons with .9em radius, Soft Press wash on hover/active, a ↗ glyph that turns into an orange dot when active.

### Inputs / Fields
- **Style:** transparent, no radius, 1px hairline underline, 16px text, mono uppercase label above.
- **Focus:** underline turns ink.
- **Error:** underline turns Signal Orange with a short shake.

### Navigation
- **Tabs:** 15px grotesk, grey until selected, then ink with an ink underline and a mono count.
- **Segmented filter:** two text buttons split by a hairline.
- **Back links:** "← Eventos" style text links at the top of a detail view.

### The Badge (signature)
The badge is the navigation. Tapping a zone runs a ripple, a full 360° rotateY turn to the side (1.2 s, `cubic-bezier(.65, 0, .25, 1)`), and the panel rises with a staggered list. The flip always runs, even with reduced motion, because it carries meaning. Secondary motion (stagger, ripple, stamp) turns off with reduced motion.

## Do's and Don'ts

### Do:
- **Do** keep the badge as the single lifted object on Hall Floor.
- **Do** set labels, dates, handles and IDs in JetBrains Mono uppercase with .15em tracking.
- **Do** use full pills for everything pressable and underlines for everything typed.
- **Do** keep Signal Orange to one small signal per view.
- **Do** keep copy short and in Spanish.

### Don't:
- **Don't** use gradients, icon feature grids, logo walls, or testimonials.
- **Don't** switch to a dark neon "hacker" look.
- **Don't** add boxed inputs or card-in-card containers.
- **Don't** bold big numbers, or set names in mono.
