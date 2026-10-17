---
name: Universe Mobile
description: The operator's, pengawas' and superadmin's shift morning on a phone, as a familiar modern app.
colors:
  ground: "#F2F4F7"
  surface: "#FFFFFF"
  surface-sunken: "#EDF0F4"
  line: "#DCE2EA"
  ink: "#0B1220"
  ink-muted: "#46536A"
  ink-faint: "#5F6B80"
  action-blue: "#0057D9"
  action-ink: "#FFFFFF"
  action-soft: "#E3EDFF"
  hero-navy: "#0A2A63"
  hero-navy-low: "#0F3A86"
  hero-text: "#FFFFFF"
  hero-text-muted: "#C9D6F0"
  brand-cyan: "#00C0FF"
  ok: "#157A3E"
  ok-soft: "#E1F4E8"
  warn: "#9A5B00"
  warn-soft: "#FDF0D9"
  bad: "#B42323"
  bad-soft: "#FBE4E4"
  dark-ground: "#111214"
  dark-surface: "#1B1C1F"
  dark-surface-sunken: "#26282C"
  dark-line: "#34373C"
  dark-ink: "#EEF2F8"
  dark-ink-muted: "#A9B4C8"
  dark-ink-faint: "#8E9AB0"
  dark-action-cyan: "#00C8FF"
  dark-action-ink: "#031020"
  dark-action-soft: "#0D2A45"
  dark-hero-navy: "#0A2257"
  dark-hero-navy-low: "#0E2F72"
  dark-hero-text-muted: "#B7C6E6"
  dark-ok: "#4ADE80"
  dark-ok-soft: "#0E2A1B"
  dark-warn: "#FBBF24"
  dark-warn-soft: "#2E2208"
  dark-bad: "#F87171"
  dark-bad-soft: "#321212"
typography:
  display:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 800
  title:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
  code:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 800
    letterSpacing: "0.01em"
    fontFeature: "tnum"
  body-strong:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  sheet: "22px"
  card: "18px"
  callout: "16px"
  tile: "14px"
  cell: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  gutter: "16px"
  hero-gutter: "18px"
  section: "20px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.action-ink}"
    typography: "{typography.code}"
    rounded: "{rounded.tile}"
    padding: "0 18px"
    height: "52px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "0 18px"
    height: "52px"
  button-danger:
    textColor: "{colors.bad}"
    rounded: "{rounded.tile}"
    padding: "0 18px"
    height: "52px"
  button-disabled:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-faint}"
  menu-tile:
    backgroundColor: "{colors.action-soft}"
    textColor: "{colors.action-blue}"
    rounded: "{rounded.tile}"
    size: "54px"
  badge-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  badge-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  badge-bad:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.bad}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  badge-info:
    backgroundColor: "{colors.action-soft}"
    textColor: "{colors.action-blue}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  list-group:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sheet}"
  list-row:
    padding: "14px 16px"
    height: "64px"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "0 16px"
    height: "54px"
  input-search:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.tile}"
    padding: "0 16px 0 44px"
    height: "50px"
  hero-pill:
    textColor: "{colors.hero-text}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "40px"
  nav-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-faint}"
    height: "88px"
  nav-center:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.pill}"
    size: "62px"
---

# Design System: Universe Mobile

## Overview

**Creative North Star: "The Everyday App, Played Straight"**

Universe Mobile is the category standard of a modern consumer app (wallet or banking class) carried at full craft and with no costume. There is no pit, no slip and no signage metaphor. The unit code and its status carry every home screen: a navy hero band at the top holds the one fact that matters today, and a rounded neutral sheet slides up over it with a four-column menu grid, grouped lists and the bottom bar of five with a raised centre button. Density is that of a phone app you already know: 16px page gutters, 64px list rows, 44px minimum touch targets.

The app follows the phone's theme. Light is a cool grey ground with white surfaces and a blue action; dark is a neutral charcoal ground with a cyan action. Navy belongs to the hero band (and the surfaces that quote it), never to the dark ground. Status reads in green, amber and red, and it always carries a word. All copy is Bahasa Indonesia; domain terms (Kosong, SIMPER, FTW, Pegangan, Spare) stay as the site uses them.

This prototype (`apps/mobile/prototype/index.html`) is the visual reference for stage 3: Compose Multiplatform translates it screen for screen. **Reference status.** The finish review ran three rounds; round 3 resolved every scored item except R1 (the "4 unit kosong" pill opened a Kosong board with two rows). After round 3 a third formation (EX1211 · PIT 2 TIMUR, DT4130 and DT4133 empty) was added to the sample board and the home "Unit kosong" list is now derived from the board, so pill, list and filtered board all show four; that fix was verified by the parent from a capture (`.impeccable/review/phone-pengawas-kosong.png`), not by the reviewer. **Unresolved:** the Laporan and Dashboard screens, iOS specifics, and the real QR (it will encode the NIK; the prototype shows a dashed placeholder).

**Key Characteristics:**

- Navy hero band with the cyan brand mark, then a rounded sheet on a neutral ground.
- One action colour per theme: blue `#0057D9` in light, cyan `#00C8FF` in dark.
- Status is colour plus a word, every time.
- Figtree throughout; tabular numerals for unit codes, NIKs and times.
- One corner family: 22px sheets and groups, 14px tiles and controls, full pills.
- Sample data is labelled as sample; screens not yet designed say so.

## Colors

A quiet cool-neutral app palette with one saturated action per theme, a navy hero band, and three status hues used only with words.

### Primary

- **Action Blue** (light) / **Action Cyan** (dark): primary buttons, the raised nav disc, active nav halo icon, menu-tile glyphs, the time column of the timeline, progress fill, focus ring and text selection. Its soft partner (`action-soft`) fills menu tiles, the active nav halo, info badges, info callouts, unread notification rows and day-shift calendar cells.

### Secondary

- **Hero Navy** (`hero-navy` to `hero-navy-low`, a top-to-bottom gradient): the hero band on every home screen, the top of the ID card, and night-shift (N) calendar cells. Darker variants in dark theme. Hero text is white with a muted lavender-blue second line.

### Tertiary

- **Brand Cyan** (`brand-cyan`): the logo mark, the 50% cyan border of the hero quick-action buttons, and the scanner viewfinder corners and scan line. It is the brand glow, not an action colour in light theme.

### Neutral

- **Cool Paper** (`ground`) / **Charcoal** (`dark-ground`): page ground and the sheet behind the menu.
- **White** (`surface`) / **Graphite** (`dark-surface`): cards, list groups, nav bar, inputs.
- **Sunken** (`surface-sunken`): tab track, neutral badges, row icon discs, disabled buttons, progress track.
- **Line** (`line`): row dividers, input and ghost-button strokes, inactive timeline knots and wires, the sheet grab handle.
- **Ink** (`ink`, `ink-muted`, `ink-faint`): primary text, secondary lines, and inactive nav labels and placeholders.

### Status

- **OK green, Warn amber, Bad red**, each with a soft fill for badges and callouts. Dark theme lifts them to bright tints on deep fills. On the navy hero, status dots and the status line use fixed light tints (dots `#34D17A`, `#F5B33C`, `#FF6A6A`, neutral `#9FB0CC`; status line amber `#FFD38A`, green `#8CF0B4`) because the band is navy in both themes.

### Named Rules

**The Word Beside the Colour Rule.** Status is never colour alone. Every dot sits in a pill with words ("FTW lolos · 04:18"), every badge says Lolos, Kosong, Terlambat or Breakdown, and an empty seat reads "Belum ada operator" in red text, not just a red mark.

**The One Action Rule.** Each theme has exactly one action colour: blue in light, cyan in dark. Status hues never style a button except the outlined red Keluar / Nonaktifkan danger button.

**The Navy Stays Up Top Rule.** Navy is the hero band and the surfaces that quote it (ID card header, night-shift cells). The dark theme ground is neutral charcoal (`#111214`), never navy.

## Typography

**Display Font:** Figtree (with system-ui, sans-serif), self-hosted woff2 in `prototype/fonts/` under the SIL OFL, latin and latin-ext subsets, weights 400 to 800.
**Body Font:** Figtree.

**Character:** One friendly geometric-humanist sans in three working weights (600, 700, 800). Hierarchy comes from size and weight, not from a second family. Codes and times set in tabular numerals with a hair of tracking (0.01em) so DT4084 and 05:26 align in columns.

### Hierarchy

- **Display** (800, 48px, line-height 1, -0.02em, tabular): the hero fact: the unit code, SPARE, 124/128 or 05:28. Drops to 40px for the word SPARE; the Unit saya card uses 52px.
- **Headline** (800, 21px): inner-screen top bar title. Bottom-sheet titles use 20px.
- **Title** (800, 18px): section headings on the sheet ("Pagi ini", "Unit kosong"); formation headings on the board at 16px with the area in 600 muted.
- **Code** (800, 16px, tabular): unit codes in list rows; also the button label size.
- **Body strong** (700, 15px): list row primary line, timeline step name. The hero status line is 600, 15px.
- **Body** (400 to 600, 13 to 14px, line-height 1.45 to 1.5): row second lines, notes, callouts.
- **Label** (600 to 700, 12px): menu labels, nav labels, badges, calendar weekdays.

### Named Rules

**The Code Carries the Screen Rule.** The largest type on any home screen is a code or a count, set at 800 in tabular numerals. Nothing decorative competes with it.

**The Tabular Clock Rule.** Every unit code, NIK, time and count is set with tabular numerals.

## Layout

A 390 x 844 phone frame. Home screens stack: hero band (18px gutters, 20px top, 56px bottom padding), then a sheet pulled up 34px over it with 16px gutters and 20px between blocks. Inner screens use a sticky top bar (44px round back button plus title) and a 16px-gutter body with 16px between blocks. The menu is a 4-column grid of 54px tiles with 14px row gap; facts pair in a 2-column "duo" with 10px gaps; the calendar is a 7-column grid with 6px gaps. Status pills scroll horizontally, bleeding to the band edges. The bottom bar is 88px with five equal columns; screens reserve 104px of bottom padding for it.

Spacing rhythm: 4, 8, 10, 14, 16, 18, 20px. Touch targets are at least 44px (icon buttons, back), 52px for main buttons, 64px for list rows and candidates.

The prototype stage (not part of the app) puts a control panel beside the phone; below 760px the phone fills the viewport and the controls collapse into a 36px amber band at the top labelled "Prototipe · data contoh · kontrol".

## Elevation & Depth

A soft, layered hybrid: tonal layering does most of the work (white surfaces on a grey ground, a sunken tab track), and one ambient two-layer shadow lifts cards, groups, the menu and the selected tab. In dark theme the same shadow deepens to read on charcoal. The raised nav disc has its own heavier drop, a 5px surface-coloured ring, and the "now" timeline knot glows with a 5px action-soft halo.

### Shadow Vocabulary

- **Ambient lift** (`box-shadow: 0 6px 18px rgba(11,18,32,0.08), 0 1px 3px rgba(11,18,32,0.06)`; dark `0 8px 22px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.4)`): cards, list groups, menu, candidates, selected tab, ID card.
- **Raised disc** (`box-shadow: 0 6px 14px rgba(3,6,14,0.28)`): the centre nav button only.
- **Now halo** (`box-shadow: 0 0 0 5px var(--action-soft)`): the current timeline step.

### Named Rules

**The One Lift Rule.** Content surfaces share one ambient shadow; only the raised centre button gets more.

## Shapes

Soft, rounded and consistent. Sheets, list groups and the menu panel share a 22px corner; the bottom sheet opens at 26px and the ID card and viewfinder at 24px. Cards, hero quick actions, avatars and the QR plate use 18px; callouts 16px; tiles, buttons, inputs and the tab track 14px (selected tab 11px inside it); calendar cells 12px. Pills, chips, badges and the hero icon buttons are fully round, and row icons and nav discs are circles. Borders are 1px hairlines in `line`; on the navy band they are translucent white (18 to 22%).

## Components

### Buttons

Full-width, tall and plain.

- **Shape:** gently rounded (14px), 52px tall, 800 weight 16px label, 0 18px padding.
- **Primary:** action fill with action ink. The inline "Isi" variant on the board is 40px tall, 14px label.
- **Ghost:** surface fill, ink text, 1px line stroke.
- **Danger:** transparent, red text and 1px red stroke; only for Keluar and Nonaktifkan akun.
- **Disabled:** sunken fill, faint ink, not-allowed cursor.
- **Focus:** a 3px action outline at 2px offset on every focusable element.

### Hero quick actions

Two stacked 104px-wide buttons right of the hero fact, 74px minimum each, 18px radius, translucent dark fill with a 50% brand-cyan border, icon over a 13px label (Syarat unit / Tiket, Cari / Unit kosong, Papan / Akun).

### Chips and pills

- **Shift chip** (hero top): 13px 600, translucent white fill and stroke, full pill.
- **Status pills** (hero): 40px tall, translucent dark fill, white 22% stroke, a 9px status dot, then words. Each pill navigates.
- **Badges:** 12px 700, 4px 9px, full pill, soft status fill with its status ink; neutral badge on sunken.

### Cards / Containers

- **List group:** surface, 22px corners, ambient lift, rows divided by 1px line; rows 64px minimum, 14px 16px padding, optional 38px round icon disc, a primary 15px line and a 13px muted line, trailing badge or chevron.
- **Fact card:** surface, 18px corners, 14px padding, a 20px 800 action-coloured time, a 15px title and a 13px note.
- **Callout:** 16px corners, 14px padding, icon plus 14px text; info on action-soft with ink text, warn and bad on their soft fills with their ink.
- **ID card:** 24px corners, navy header with an 18px-radius initials avatar, a white QR plate, SIMPER class badges in a footer strip.

### Inputs / Fields

- **Field:** 54px tall, 14px corners, 1px line stroke, surface fill, 17px text, 14px 700 label above.
- **Search:** 50px tall, 14px corners, a faint 18px search icon inset at 14px.
- **Focus:** the global 3px action outline.
- **Checkbox acknowledgement:** a warn callout holding a 22px checkbox tinted warn; the primary button stays disabled until it is ticked.

### Tabs

A sunken track (14px, 4px padding) of equal segments; segments 42px tall, 14px 700 muted text; the selected one becomes a surface pill (11px) with ink text and ambient lift. Used for history types, unit status and board filters (Semua, Kosong, Spare, Manual).

### Navigation

A five-column bottom bar, 88px, surface with a 1px top line. Inactive items are a 21px icon over a 12px 600 faint label. The active item gets an action-soft 56 x 32 halo behind an action-coloured icon and an 800 ink label. The centre item is a 62px action disc raised 34px above the bar, ringed in surface, with the label beneath (Kartu for operators, Scan ID for pengawas and superadmin).

### Timeline steps

A vertical rail: 14px knots with a 3px stroke joined by 2px wires; done knots fill green, the current one fills action with a halo, pending ones stay hollow. Each step has a 15px name, a 13px note and an 800 action-coloured time at the right.

### Bottom sheet and toast

The sheet rises (360ms, `cubic-bezier(0.16, 1, 0.3, 1)`) over a 55% near-black scrim, ground-coloured, 26px top corners, a 40 x 5px grab handle, a 20px title. Toasts are inverted (ink fill, ground text), 14px corners, sitting above the nav bar.

### Motion

The hero fact reveals once (520ms, rise plus blur clearing, same ease). Scrims fade in 220ms. The scanner line sweeps for 2.2s alternating. `prefers-reduced-motion: reduce` removes all animation and transition.

## Do's and Don'ts

### Do:

- **Do** follow the phone's light or dark theme, with blue action `#0057D9` in light and cyan `#00C8FF` in dark.
- **Do** put the day's single fact (unit code, count or time) at display size in the navy hero, with its status line directly under it.
- **Do** pair every status colour with a word: a pill, a badge or text.
- **Do** set unit codes, NIKs, times and counts in Figtree with tabular numerals.
- **Do** keep the corner family: 22px sheets and groups, 14px tiles and controls, full pills.
- **Do** label sample data as sample ("Semua data di sini adalah contoh"), on the amber sample band.
- **Do** show a spare as SPARE, with the reason and the 05:28 time, until finger-second; the seat appears only after it.
- **Do** route any screen not yet designed to the marked "Belum dirancang" placeholder with a way back to Beranda.
- **Do** write all copy in Bahasa Indonesia and keep site terms (Kosong, SIMPER, FTW, Pegangan, Spare) as they are.

### Don't:

- **Don't** use pit, slip or signage metaphors; the owner chose the familiar everyday app.
- **Don't** use colour alone to carry a status.
- **Don't** reveal a spare's seat before finger-second (05:28).
- **Don't** use navy as the dark-theme ground; it belongs to the hero band.
- **Don't** add a second action colour or style buttons with status hues (red outline danger excepted).
- **Don't** leave a dead tap: every menu item, pill and nav button goes somewhere, even if it is "Belum dirancang".
