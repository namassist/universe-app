---
target: apps/web/app/ops/page-client.tsx
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
target_identity: "file:/home/anamali/Workspaces/apps/universe-app/apps/web/app/ops/page-client.tsx"
target_fingerprint: "sha256:ae04dd3f8ea5bdee5facbc7f59548b1f89a50f7f495e12bf21fe60886f699d08"
target_path: /home/anamali/Workspaces/apps/universe-app/apps/web/app/ops/page-client.tsx
timestamp: 2026-10-02T06-16-02Z
slug: apps-web-app-ops-page-client-tsx
---

Method: dual-agent (A: design review · B: detector + browser evidence). Source-only review; no browser (libnspr4 missing, /ops password-gated).

## Design Health Score: 25/40 (Acceptable)

1 Visibility 2: the Fresh dot stays green and glowing beside the "Gagal memuat ulang" badge (ops-dashboard.tsx:116-129)
2 Real world 3: dates MM-DD / ISO (ops-panels.tsx:85,122)
3 Control 3
4 Consistency 2: "Gagal" red in the stage table (lib/ops.ts:54), amber in the stage log (ops-panels.tsx:491) and alert feed (lib/ops.ts:174)
5 Error prevention 3: login button stays active during a lockout
6 Recognition 2: users table has 9 columns; "Booth listening" appears twice
7 Flexibility 2: no sort/filter/jump links; uncapped lists
8 Minimalist 2: ten equal stat cards, no verdict
9 Error recovery 2: alert reason dropped (n.params ignored, lib/ops.ts:184); no retry button
10 Help 4

## Specificity

The content is written for UNIVERSE; the frame is a generic stat-grid dashboard. PRODUCT principle "The clock is the product" is missing. Detector: 0 findings across 6 files (exit 0); the only literal colors are the allowed cyan rgba.

## Priority issues

- [P1] Stale data looks live (Fresh glow, ages computed against generatedAt) — harden
- [P1] No verdict at the top; muster and alerts come after 10 cards and 2 charts — layout
- [P1] Failure reasons dropped; "Belum ada" doesn't separate expected from failed — clarify
- [P2] "Gagal" in two colors; mixed id-ID number formats; MM-DD dates — polish
- [P2] Refresh icon spins every 15 s and isn't covered by reduced motion; bare first-load spinner — animate

## Personas

Alex: no sort/filter/jump links; slow requests capped at 10. Sam: unnamed spinner; charts with no text alternative; stale state not announced; show-password toggle inside the label with no focus style. On-call 05:20: board state buried; stage not linked to its alert; silent login on session expiry.

## Minor

NIK and IP uncapped on a password-only page; raw HTTP status column; red x/y count with no word; ✓/✕ glyphs; cyan info wells on plain counters.

## Questions

Timeline as the spine? Users list as an audit log behind a disclosure? Only Gagal and Terlewat allowed to be loud?
