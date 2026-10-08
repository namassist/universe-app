---
name: UNIVERSE
description: Fleet automation console and muster walls, a dark control room lit by one cyan signal.
colors:
  night-navy: "#010416"
  muster-cyan: "#00d4ff"
  cyan-bright: "#7ae6ff"
  deep-signal-blue: "#0054c7"
  console-blue: "#3b82f6"
  cta-navy-ink: "#001239"
  ready-green: "#17ce64"
  hold-amber: "#e99b2a"
  idle-red: "#fc3c3b"
  idle-red-text: "#ff7a79"
  text-primary: "rgba(255, 255, 255, 1)"
  text-secondary: "rgba(255, 255, 255, 0.72)"
  text-tertiary: "rgba(255, 255, 255, 0.58)"
  text-disabled: "rgba(255, 255, 255, 0.38)"
  glass-1-fill: "rgba(255, 255, 255, 0.06)"
  glass-1-border: "rgba(255, 255, 255, 0.14)"
  glass-2-fill: "rgba(255, 255, 255, 0.1)"
  glass-2-border: "rgba(255, 255, 255, 0.18)"
  overlay-fill: "rgba(2, 10, 34, 0.92)"
  fill-input: "rgba(14, 31, 54, 0.6)"
  border-input: "rgba(255, 255, 255, 0.4)"
  divider: "rgba(255, 255, 255, 0.1)"
  scrim: "rgba(1, 4, 22, 0.6)"
  badge-success-text: "#4ade8c"
  badge-warning-text: "#f2b45c"
  badge-danger-text: "#ff7a79"
  badge-info-text: "#7ae6ff"
  badge-accent-text: "#c4b5fd"
  wall-danger-wash: "rgba(252, 60, 59, 0.14)"
  wall-warning-wash: "rgba(233, 155, 42, 0.14)"
  light-paper-blue: "#eaf3ff"
  light-ink: "#0a1b3a"
  light-link: "#005a8c"
  light-danger-text: "#c22525"
typography:
  display:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.25
    fontFeature: "tnum"
  headline:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "0.02em"
  title:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "0.02em"
  body:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "0.02em"
  label:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.05em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    fontFeature: "tnum"
rounded:
  chip: "6px"
  control: "10px"
  icon: "14px"
  card: "20px"
  panel: "28px"
spacing:
  control-x: "16px"
  card: "20px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.muster-cyan}"
    textColor: "{colors.cta-navy-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.glass-2-fill}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-destructive:
    textColor: "{colors.idle-red-text}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  icon-button:
    backgroundColor: "{colors.glass-1-fill}"
    rounded: "{rounded.control}"
    size: "36px"
  input:
    backgroundColor: "{colors.fill-input}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  badge-neutral:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.chip}"
    padding: "3px 10px"
    typography: "{typography.label}"
  panel:
    backgroundColor: "{colors.glass-1-fill}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel}"
  stat-card:
    backgroundColor: "{colors.glass-2-fill}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  dialog:
    backgroundColor: "{colors.overlay-fill}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel}"
    width: "460px"
  segmented-active:
    textColor: "{colors.cyan-bright}"
    rounded: "8px"
    padding: "7px 14px"
---

# Design System: UNIVERSE

This file records the system as it stands in `app/globals.css` and
`components/ui/*`. It invents nothing. The engineering rules for using it
(compound shapes, `cn()`, cva, how to consume tokens) live in
`docs/design.md` and `AGENTS.md`, and those govern how code is written.
Product truth lives in `../../PRODUCT.md`.

## Overview

**Creative North Star: "The Pre-Dawn Control Room"**

UNIVERSE is a control room at four in the morning. The room is dark by default
(Night Navy, `#010416`), and the work happens on layers of glass floating above
it. One color glows: Muster Cyan. It marks what you can press, what has focus,
where you are in the navigation, and what is current. The rest of the time it
stays quiet so that it keeps meaning something.

The character is glowing but disciplined. The primary action is a cyan gradient
that lifts by a pixel and brightens its glow on hover. Everything else is calm,
translucent glass whose corners soften as the surface grows, from a 6px chip to
a 28px panel. Status color is kept for status alone: green ready, amber
holding, red idle. It is always paired with a word, and on the walls it becomes
a thin wash across a whole row rather than a loud fill.

The system has two surfaces. The **console** (app shell, menus, dialogs) comes
in both dark and light themes and is dense enough for fast work at a desk. The
**walls** (`app/display/*`) are dark-only, drawn on a fixed 1920px canvas
scaled to the TV, and read from about six meters away. Where the two pull in
different directions, the wall's legibility wins.

**Key Characteristics:**

- Dark navy by default, with a complete light theme for the console. Walls are
  always dark.
- Three tiers of glass: background gradient, then a 12px-blur panel, then a
  25px-blur floating card.
- One luminous accent (cyan) for action, focus, the current item and info.
- Status colors that always come with words and never stand in for a data
  series.
- Corners that soften as surfaces grow (6 → 10 → 14 → 20 → 28px).
- Instrument Sans with slightly open tracking (0.02em), and Geist Mono with
  tabular figures for codes, NIKs and times.

## Colors

A night-navy field, one cyan signal, and a strict status triad. All of them
are defined twice, for dark (`:root`) and for light (`[data-theme="light"]`).

### Primary

- **Muster Cyan** (`--color-primary`): the signal color. It starts the CTA
  gradient (to `#0091ff`), draws the focus outline, appears in the active nav
  wash, the info badge and links, and tints section-title icons. Its glow
  family `rgba(0, 212, 255, …)` is the only literal color allowed in
  className.
- **Cyan Bright** (`--color-primary-bright`): cyan text that has to read as
  text: the active segment, an icon on hover, info-badge text. In the light
  theme it darkens to `#006c99`.
- **CTA Navy Ink** (`--color-on-cta`): the dark text on the cyan gradient, so
  the primary button reads as lit glass with ink on it, not white on blue.

### Secondary

- **Deep Signal Blue** (`--color-secondary`): the blue end of the logo
  gradient and the second stop of the kiosk and auth backgrounds.
- **Console Blue** (`--color-accent`, plus `rgba(37, 99, 235, …)` in
  `--gradient-thead` and `--gradient-nav-active`): the blue wash behind table
  headers and the active nav item.

### Tertiary

- **Tag Violet** (`--badge-accent-*`, text `#c4b5fd` dark, `#5b21b6` light):
  used only for organisational tags such as department badges. It is violet so
  it can never be read as a status next to green, amber and red.

### Neutral

- **Night Navy** (`--color-bg`): the base. The console sits on
  `--gradient-admin` (`#001239` to `#0740a1`), the walls on `--gradient-kiosk`
  and the login page on `--gradient-auth`.
- **Text ramp** (`--text-primary/secondary/tertiary/disabled`): white at 100,
  72, 58 and 38% in dark, and Light Ink `#0a1b3a` at 100, 75, 58 and 35% in
  light. The source comment names WCAG AA over glass as the target.
- **Glass** (`--glass-1-*`, `--glass-2-*`, `--fill-subtle/hover/hover-strong`,
  `--fill-input`): translucent white over navy in dark, and translucent white
  over Paper Blue `#eaf3ff` in light.
- **Lines** (`--divider`, `--border-input`, `--border-btn-secondary`,
  `--ring-avatar`): hairlines at 10 to 40% opacity.
- **Overlay and scrim** (`--overlay-fill`, `--scrim`): a near-opaque navy for
  dialogs and a 60% navy veil behind them.

### Status

- **Ready Green** (`--color-success`), **Hold Amber** (`--color-warning`) and
  **Idle Red** (`--color-danger`, with readable text in `--color-danger-text`).
  Badges use a 16% fill, a 40% border and a lighter text step of the same hue
  (`--badge-{success,warning,danger,info,neutral}-*`). The light theme darkens
  the text to `#0b7a3b`, `#8a5a0f` and `#c22525`.
- **Wall washes** (`--wall-danger-wash`, `--wall-warning-wash`): much thinner
  than a badge fill because they sweep a whole row.

### Charts

- **Categorical** `--chart-1…8`: identity, not rank. Slot order is fixed so
  that DOZER is the same color on every panel. The palette was validated
  against this app's glass card surface in each theme.
- **Status** `--chart-good/warning/critical`: the same in both themes, and
  deliberately different from the eight categorical slots.

### Named Rules

**The One Signal Rule.** Cyan means _act here_, _you are here_ or _this is
current_. A decorative cyan dilutes the one thing the room is lit for.

**The Two-Theme Rule.** Every console token exists in the dark block and the
light block. A color that exists in only one theme does not exist.

**The Status-Is-Not-a-Series Rule.** Status colors never stand in for a data
category, and categorical slots never carry a status. Green and red are never
placed next to each other; amber sits between them, and every segment carries
its own number.

## Typography

**Body font:** Instrument Sans (`--font-sans`, with system-ui and sans-serif
as fallback)
**Mono font:** Geist Mono (`--font-mono`, weights 400, 500 and 600)

**Character:** a contemporary grotesque with slightly open tracking
(`--tracking-brand`, 0.02em, set on `body`), which keeps dense Bahasa
Indonesia labels from crowding. The mono face is a working tool for codes,
NIKs, times and counters, always with tabular figures.

### Hierarchy

- **Display** (700, 32px, tabular): stat-card numbers.
- **Headline** (700, 24px): page titles (`PageTitle`).
- **Title** (600, 20px): panel toolbar titles and dialog titles. Section
  titles step down to 16px/600 with a cyan icon.
- **Body** (400, 14px; 13px for small buttons and segments): table cells,
  inputs, panel copy. Secondary copy uses `--text-secondary`.
- **Label** (600, 12px, uppercase, wide tracking): table headers. The same
  size in sentence case is used for badges, helper text and metadata.
- **Mono** (500–600, 12px, tabular): codes, NIKs, timestamps, numeric cells.

On walls, type is sized in canvas pixels on the 1920px stage (for example
`text-[44px]`), so a wall's type scale is that canvas's own, not the
console's.

### Named Rules

**The Tabular Figures Rule.** Any number that is compared, counted or ticks
(stats, times, NIKs, unit codes) uses tabular figures, so columns and clocks
do not jitter.

## Layout

The console is a sidebar plus topbar shell (`components/layout/*`) around menu
pages. A menu page is a stack of `PageTitle` then one or more `Panel`s. A
list page is `Panel` → `Toolbar` (title left, controls right, wrapping) →
`Table` → `PanelFoot` (summary left, pagination or actions right). Forms are a
`Panel` of `Field`s. Spacing follows Tailwind's 4px scale: 24px inside a
panel, 20px inside a card, 20px between a toolbar or footer and the table, and
8 to 12px between controls.

Loading states use `skeleton` and `table-skeleton` shimmer. Empty and error
states use `state-box`, and outcomes use `toast`. A screen is never blank
while waiting.

Walls use a fixed 1920px-wide canvas scaled to the screen's width with
`transform: scale()`, and the height follows the screen's ratio with no
letterbox. Long tables scroll themselves (the content is duplicated, with the
header pinned). The whole stage shifts by up to 8px over an 8-minute cycle to
prevent burn-in. Multi-fleet walls rotate with a progress segment and a swipe;
monitor layouts flip each quadrant in place.

### Named Rules

**The Never-Blank Rule.** Every waiting, empty or failed state has a shape:
a skeleton, a state box, or on a wall a sentence saying why there is nothing
to show.

## Elevation & Depth

Depth comes from layered glass: translucent fill, a hairline border and
backdrop blur, with soft shadows that grow with each tier. In dark mode the
higher tiers add a faint cyan halo. There are no hard drop shadows.

### Shadow Vocabulary

- **Panel** (`--shadow-panel`, `0 16px 48px rgba(0,0,0,.35)`): tier-1 glass
  (`glass-panel`, 12px blur), used for panels, the sidebar and table cards.
- **Card glow** (`--shadow-card-glow`, a 20px cyan halo at 15% plus an 80px
  shadow): tier-2 glass (`glass-card`, 25px blur), used for stat cards and
  floating cards.
- **Modal** (`--shadow-modal`, a 24px cyan halo at 12% plus a 96px shadow):
  dialogs on `--overlay-fill`, over a 6px-blurred `--scrim`.
- **CTA glow** (`--glow-cta`, `0 8px 24px rgba(0,212,255,.35)`, rising to
  `0 10px 28px` at 50% on hover): primary buttons only.
- **Pill glow** (`--glow-pill`): an inset cyan glow for pill-shaped
  highlights.
- **Active nav** (`0 0 10px rgba(0,212,255,.4)` with a cyan border at 50%):
  the current sidebar item.

The light theme keeps the same structure, with shadows in Light Ink and much
weaker halos.

### Named Rules

**The Glow-Is-Earned Rule.** Glow belongs to the primary action, the focused
control, the current nav item and the topmost layer. A resting surface gets
glass, not glow.

## Shapes

A soft, nested radius scale that grows with the surface: chip 6px
(`--radius-chip`, badges), control 10px (`--radius-control`, buttons, inputs,
segmented groups, table-header ends), icon 14px (`--radius-icon`, the 44px
icon tiles in cards and dialogs), card 20px (`--radius-card`, stat cards and
notes) and panel 28px (`--radius-panel`, panels and dialogs). Segment buttons
inside a segmented group use 8px, so they sit concentrically within the 10px
group. Dots, avatars and spinners are fully round. Borders are always 1px
hairlines.

## Components

Glowing but disciplined. One component lights up and everything around it
stays quiet glass.

### Buttons

- **Shape:** gently rounded (10px), 40px tall (36px for `sm` and icon
  buttons), 16px horizontal padding, 14px semibold, with 15px lucide icons and
  an 8px gap.
- **Primary:** the cyan gradient `--gradient-cta` (`#00d4ff` → `#0091ff`) with
  CTA Navy Ink bold text and `--glow-cta`. On hover it rises 1px, switches to
  `--gradient-cta-hover` and the glow strengthens. When disabled it goes flat:
  no gradient, no glow, `--fill-hover-strong` with disabled text.
- **Secondary:** glass (`--fill-hover`) with a 25% hairline and backdrop blur.
  On hover the border turns cyan at 45%.
- **Destructive:** the danger badge recipe (red fill at 16%, border at 40%,
  `--color-danger-text`). It deepens on hover.
- **Ghost:** transparent with secondary text, gaining `--fill-hover` and
  primary text on hover.
- **Icon button:** a 36px glass square. On hover it turns cyan, or red with
  the `danger` prop.
- **Focus:** a 2px cyan outline offset by 2px on every button.
- **Transition:** box-shadow, background, border and transform, 150ms.

### Badges (chips)

- **Style:** a 6px radius, 12px semibold, 3px × 10px padding, and a
  translucent fill with a 40% border and lighter text of the same hue.
- **Variants:** success, warning, danger, info (cyan), neutral (the default)
  and accent (violet, organisational only). An optional `dot` adds a 6px dot
  in the current color.

### Panels and cards

- **Panel:** tier-1 glass, 28px radius, 24px padding. It holds `Toolbar`,
  `SectionTitle` (16px with a cyan icon), `PanelFoot` and `FootSum`.
- **Stat card:** tier-2 glass, 20px radius, 20px padding. A 44px icon tile,
  then a 32px bold tabular number, a 14px label and a 12px tertiary footnote.
  When it is a link, a 26px corner arrow turns cyan on hover.
- **Note (`DNote`):** a 20px-radius subtle fill with a hairline, a 13px bold
  title and a 12px relaxed body.
- **Freshness (`Fresh`):** a 7px green dot with a soft green glow beside 12px
  tertiary text.

### Inputs and fields

- **Style:** 40px tall, 10px radius, `--fill-input` glass, a 40% white
  hairline, 16px padding, 14px text and tertiary placeholder.
- **Focus:** the border turns cyan, with a 3px cyan ring at 22% and a soft
  cyan shadow beneath.
- **Disabled:** the subtle fill, a strong-hover border and disabled text.
- **Error:** 12px `--color-danger-text` beneath the field, with an icon.
- **Textarea:** the same recipe, at least 88px tall and vertically resizable.

### Segmented control

A 10px-radius group with an input fill, a hairline border and 4px padding.
Each option is 13px semibold. The active option gets a cyan 12% fill, a 40%
border and Cyan Bright text. Inactive options use secondary text and gain the
hover fill.

### Tables

`Table` is 14px with a divider between rows and a soft hover. The header is a
row of 12px uppercase labels with wide tracking on the Console Blue
`--gradient-thead` wash, with its ends rounded to the control radius. Code and
number cells use mono, and `NameCell` and `IOCell` carry identity and time
pairs.

### Dialogs

A 460px-max floating sheet (it never exceeds the viewport height less 48px)
on `--overlay-fill`, with a 28px radius, a glass-2 hairline and
`--shadow-modal`. A 44px icon tile, a 20px semibold title, a body and actions
right-aligned 24px below. It sits over a 6px-blurred `--scrim`.

### Navigation

The sidebar is a glass panel. The active item gets the `--gradient-nav-active`
wash, a cyan border at 50% and a 10px cyan glow, with semibold primary text.
Inactive items are secondary text with a hover fill. Per-role looks come from
tokens, never from forks of the shell.

### Display walls (signature)

These are dark-only kiosk pages on `--gradient-kiosk`. A fleet wall's unit
card comes in two layouts per screen, Overlay and Identity, sharing one
details component. An idle unit keeps its full red card. Before the board is
built, an empty seat keeps a small red "Kosong" chip but no red frame.
Readiness badges are grey "Belum…" until a gate closes and red "Tidak…" after
it. Rows that need attention get a wall wash, not a badge fill. A running text
marquee scrolls along the bottom. The attendance wall shows the latest scan as
a ticket on `--gradient-ticket`.

### Login scene (signature)

The login page alone runs a 3D depth scene: a perspective grid floor with a
horizon line, cyan and blue aurora bands, a breathing horizon bloom, drifting
motes, shooting stars, and an orbiting 3D logo. Only transform and opacity
animate, it is built entirely from existing tokens, and it holds still under
reduced motion.

## Do's and Don'ts

### Do:

- **Do** take every color from a token in `app/globals.css`, consumed as
  `text-(--text-primary)`, `bg-(--fill-subtle)`, `border-(--divider)`.
- **Do** add a missing color to both the dark and the light block before using
  it.
- **Do** reuse the exact `rgba(0, 212, 255, …)` values when matching the cyan
  glow. It is the one literal color allowed.
- **Do** extend an existing `components/ui/*` component with a cva variant or
  a prop before creating a new one.
- **Do** pair every status color with a word ("Belum…", "Tidak…", "Kosong"),
  and give every chart segment its own number.
- **Do** use tabular figures for anything counted, compared or ticking.
- **Do** honor `prefers-reduced-motion`. Entrance animations stop, the walls'
  pixel shift and flips stop, and scrolling and marquees slow down.
- **Do** use lucide-react for every icon.

### Don't:

- **Don't** write an arbitrary hex value in className (`bg-[#fff]`). ESLint
  rejects it.
- **Don't** add Radix or any other headless UI library. Every primitive here
  is hand-rolled.
- **Don't** use a status color as a chart series, or a chart slot as a status.
- **Don't** use Tag Violet for anything but organisational tags.
- **Don't** fill a whole wall row at badge strength. Use `--wall-*-wash`.
- **Don't** give a resting surface a glow. Glow is for the primary action,
  focus, the current item and the topmost layer.
- **Don't** theme a wall light. `app/display/*` is dark-only.
- **Don't** fork the shell per role. Role looks come from tokens.
