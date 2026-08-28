# Design system

Shadcn philosophy, vendored: owned code in `components/ui/`, not an npm
library. Compound components, cva variants, `cn()` merging, design tokens.
**No Radix or any headless UI library** — every primitive is hand-rolled.

## The 24 components (`components/ui/`)

async-select, avatar, badge, button, checkbox, dialog, drawer, drop-menu,
dropzone, field, input, logo, pagination, panel, progress, search-input,
segmented, select, skeleton, stat-card, state-box, table, table-skeleton,
toast.

Compound shapes to imitate:

- `Dialog / DialogIcon / DialogTitle / DialogBody / DialogActions`
- `Panel / Toolbar / ToolbarTitle / ToolbarGroup / PanelFoot / SectionTitle / PageTitle`
- `Table / TableHeader / TableHead / TableBody / TableRow / TableCell / NameCell / IOCell`
- `Drawer / DrawerClose / Timeline / TimelineItem`
- `DropMenuWrap / DropMenu / DropMenuItem / DropMenuRadio / DropMenuHeading`

One file per component, sub-components together, a single named-export
statement at the bottom. Variants via cva (see `button.tsx`, `badge.tsx`).

## Tokens (`app/globals.css`, dark + light blocks — always both)

| Group     | Tokens (prefix)                                                            | Use for                        |
| --------- | -------------------------------------------------------------------------- | ------------------------------ |
| Core      | `--color-bg/-primary/-accent/-secondary/-success/-warning/-danger/-link`   | Base palette                   |
| Text      | `--text-*`, `--color-on-cta`, `--color-danger-text`                        | Foreground                     |
| Surfaces  | `--fill-subtle/-input/-hover/-hover-strong`, `--overlay-fill`, `--glass-*` | Backgrounds, inputs, overlays  |
| Lines     | `--divider`, `--border-input`, `--border-btn-secondary`                    | Borders                        |
| Badges    | `--badge-{success,warning,danger,info,neutral}-{fill,text,border}`         | Status badges                  |
| Gradients | `--gradient-{cta,cta-hover,nav-active,thead,auth,admin,kiosk,logo}`        | CTAs, nav, table heads, shells |
| Effects   | `--glow-cta`, `--glow-pill`, `--inset-glow`, `--blob-blue`, `--blob-cyan`  | Accents                        |
| Radius    | `--radius-{card,chip,control,icon}`                                        | The whole radius scale         |
| Motion    | `--animate-{pop-in,rise-in,rot,shimmer,toast-in}`                          | Keyframed animation            |
| Fonts     | `--font-sans`, `--font-mono`                                               | Typography                     |

Consumption in className: `text-(--text-primary)`, `bg-(--fill-subtle)`,
`border-(--divider)`. Arbitrary hex is an ESLint error. The only literal
color allowed anywhere is the cyan brand-glow `rgba(0,212,255,…)` family —
reuse those exact values when matching that accent.

Missing a color? Add a token to **both** dark and light blocks in
`globals.css`, then consume it. Never inline.

## Layout patterns

- Menu pages compose `Panel`/`Toolbar`/`Table` (list pages) or
  `Panel`+`Field` forms; skeletons (`skeleton`, `table-skeleton`) during
  query loading, `state-box` for empty/error states, `toast` for outcomes.
- Icons: lucide-react only.
- The shell (sidebar/topbar) is themed via the gradient tokens — per-role
  looks come from tokens, not per-role component forks.
