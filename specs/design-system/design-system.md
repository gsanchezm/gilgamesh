# Gilgamesh — Design System Spec (`@gilgamesh/ui`)

> The UI contract for the `@gilgamesh/ui` package (keystone §4): tokens, typography, the component
> inventory, the agent taxonomy, and motion. Dark mode is the default; a light theme is available via
> toggle. **English-only — no i18n** (decisions-log #2: the prototype's ES/EN selector and the
> `T()`/`setLang` machinery are removed; all copy here is the single source of truth and ships in English).
> Tagline: **"Testing · Trusted · Elevated."**
>
> This is a **declarative design contract**, not a shippable stylesheet. CSS fences are illustrative —
> they pin exact values, names, and behavior the React + Tailwind implementation MUST honor verbatim.
> All names that also appear in the keystone (enum values, agent slots, family keys, hex) are quoted
> **exactly**; do not rename them in implementation.
>
> Authority: keystone `specs/_keystone/foundation-vocabulary.md` (verbatim names/enums/roster) >
> decisions-log > prototype-extract. Values explicitly invented here (type scale, spacing scale, the
> light-theme `--accent-soft`/`--shadow`, focus ring, component dimensions not given by the extract) are
> listed under **§13 Deviations & derived values**.

---

## 1. Principles

1. **Dark-first.** `[data-theme="dark"]` is the default applied to `<html>`. Light is opt-in. Every token
   has a value in **both** themes; components reference tokens only — never raw hex.
2. **Accessibility is a first-class discipline.** Target **WCAG 2.2 AA** and **OWASP ASVS L2** UI
   requirements. Color is never the sole carrier of meaning (status always pairs an icon/glyph + text
   label). Every interactive element has a visible `:focus-visible` ring (§11) and a ≥24×24px hit target.
   `prefers-reduced-motion` is respected by every motion token (§12).
3. **Performance is a budget, not an afterthought** (§14). The token layer is pure CSS custom properties
   (no runtime JS theming cost); theme switch is a single attribute flip with no reflow of layout
   geometry; animations touch only `transform`/`opacity`.
4. **Token-driven & themable.** Components are skinned entirely by CSS variables so a future tenant theme
   is a variable override, not a component fork.
5. **Identity through the pantheon.** Agents are mythological deities; the avatar-tile, family colors, and
   the Marcellus display face carry that identity consistently (keystone §3).

---

## 2. Theme tokens — CSS custom properties

Exact hex from prototype-extract §11. `[data-theme="dark"]` is the default; `[data-theme="light"]` is the
toggle target. Status/semantic and family tokens are theme-independent unless noted.

### 2.1 Surface, text & accent (per theme)

```css
/* DEFAULT — dark */
[data-theme="dark"] {
  --bg:            #0A1626;             /* app canvas */
  --surface:       #0E1D33;            /* raised panels, topbar */
  --card:          #112441;            /* cards, tiles, modal body */
  --field:         #0C1B31;            /* input / select / textarea fill */
  --text:          #EAF0FA;            /* primary text */
  --muted:         #8597B4;            /* secondary text, captions, placeholders */
  --border:        rgba(255,255,255,.09);
  --accent:        #E7C877;            /* gold — primary brand/action accent */
  --accent-soft:   rgba(201,161,78,.15); /* accent tint fills (selected, hover wash) */
  --sidebar:       #0A1424;            /* left sidebar surface */
  --shadow:        0 6px 24px rgba(0,0,0,.35);
}

/* LIGHT — toggle */
[data-theme="light"] {
  --bg:            #F4F1E6;            /* warm cream canvas */
  --surface:       #FBFAF4;
  --card:          #FFFFFF;
  --field:         #FFFFFF;
  --text:          #0E1B36;
  --muted:         #6E7892;
  --border:        rgba(14,27,54,.10);
  --accent:        #9A7B2E;            /* darker gold for light bg */
  --accent-soft:   rgba(154,123,46,.12); /* DERIVED (§13) — extract gives no light value */
  --sidebar:       #0B1A37;            /* sidebar stays dark navy in both themes (extract) */
  --shadow:        0 6px 20px rgba(14,27,54,.12); /* DERIVED (§13) */
}
```

> The **sidebar is dark navy in both themes** (extract gives `--sidebar` a near-black navy for light too):
> the left rail is a constant brand surface. Sidebar text/icon tokens therefore always resolve against a
> dark surface — see §10 sidebar.

### 2.2 Status & semantic tokens (theme-independent)

Two distinct families — keep them separate. **Runtime status** styles live agents (`AgentRuntimeStatus`);
**semantic result** styles test outcomes (`TestCaseStatus` / `RunStatus` / `RunNodeState`).

```css
:root {
  /* Agent runtime status (AgentRuntimeStatus: ACTIVE | BUSY | IDLE) */
  --status-active:   #2F8F5B;  /* ACTIVE  — green  (display label "Active") */
  --status-busy:     #C08A2E;  /* BUSY    — amber  (display label "Busy")  */
  --status-idle:     #9AA0AC;  /* IDLE    — gray   (display label "Idle"); tile opacity .6 */

  /* Semantic result palette (test/run outcomes) */
  --pass:            #3FB079;  /* PASS / DONE_PASS / passed segment */
  --fail:            #E5484D;  /* FAIL / DONE_FAIL / FAILED — solid/icon use */
  --fail-soft:       #E0738A;  /* secondary fail — small-text & donut secondary (§9 donut) */
  --skip:            #E7C877;  /* SKIPPED / skip segment (== accent gold) */
  --blocked:         #E0A23C;  /* BLOCKED */
  --idle-node:       #2A3D63;  /* DAG node IDLE fill / NOTRUN neutral fill */

  /* Agent family frame colors (keystone §3 — authoritative) */
  --fam-proceso:     #A07D2C;  /* proceso  (lead, arch, manual) */
  --fam-ui:          #3F6FA3;  /* ui       (web, android, ios, visual) */
  --fam-backend:     #7E63A6;  /* backend  (api, perf) */
  --fam-guardian:    #2F8F78;  /* guardian (sec, a11y) */

  /* Sidebar text — THEME-INDEPENDENT (the sidebar surface stays dark navy in both
     themes, so its text/icon tokens must NOT flip with --text/--muted/--accent). DERIVED §13. */
  --sidebar-text:    #EAF0FA;  /* on #0A1424/#0B1A37 ≈ 15:1 */
  --sidebar-muted:   #8597B4;  /* ≈ 5.7:1 on the navy rail */
  --sidebar-accent:  #E7C877;  /* bright gold in both themes (light --accent #9A7B2E is too dim on navy) */
}
```

### 2.3 Enum → token map (full coverage)

Every frozen enum value that the UI renders maps to exactly one visual token. No value is left implied.

**`AgentRuntimeStatus`** (status dot + label on avatar-tile / agent mini-list):

| value    | token            | dot color | label    | tile treatment            |
|----------|------------------|-----------|----------|---------------------------|
| `ACTIVE` | `--status-active`| green     | "Active" | full opacity, `gxpulse` dot |
| `BUSY`   | `--status-busy`  | amber     | "Busy"   | full opacity, `gxpulse` dot |
| `IDLE`   | `--status-idle`  | gray      | "Idle"   | **tile opacity .6**, static dot |

**`TestCaseStatus`** (case list pills, scenario `lastStatus`):

| value     | token         | fill / text                      |
|-----------|---------------|----------------------------------|
| `NOTRUN`  | `--idle-node` text on `--field` | neutral chip + dash icon "—" |
| `PASS`    | `--pass`      | check icon ✓                     |
| `FAIL`    | `--fail`      | cross icon ✕ (see §11 contrast guardrail) |
| `BLOCKED` | `--blocked`   | block icon ⊘                     |
| `SKIPPED` | `--skip`      | skip icon ⤼                      |

**`RunStatus`** (run header badge):

| value      | token            | label      |
|------------|------------------|------------|
| `QUEUED`   | `--muted`        | "Queued"   |
| `RUNNING`  | `--accent`       | "Running" + `gxpulse` |
| `DONE`     | `--pass`         | "Done"     |
| `FAILED`   | `--fail`         | "Failed"   |
| `CANCELED` | `--muted`        | "Canceled" |

**`RunNodeState`** (DAG node — §9 DAG node):

| value       | token        | node treatment                                  |
|-------------|--------------|-------------------------------------------------|
| `IDLE`      | `--idle-node`| flat fill, muted border                          |
| `QUEUED`    | `--muted`    | dashed border, no animation                      |
| `RUNNING`   | `--accent`   | `gxpulse` glow; incoming edges animate `gxdash`  |
| `DONE_PASS` | `--pass`     | ✓ badge, solid pass border                       |
| `DONE_FAIL` | `--fail`     | ✕ badge, solid fail border                       |

**Run log line levels** (`RunEvent.LOG.level` from keystone §5: `sys | run | pass | fail | log`):

| level  | token         | use                          |
|--------|---------------|------------------------------|
| `sys`  | `--accent`    | dispatcher/system lines      |
| `run`  | `--text`      | normal run output            |
| `pass` | `--pass`      | passing assertions           |
| `fail` | `--fail`      | failing assertions           |
| `log`  | `--muted`     | verbose/debug                |

---

## 3. Typography

Three families (extract §11). Self-host WOFF2; `font-display: swap`; preload only the two faces above the
fold (Marcellus 400, IBM Plex Sans 400/600). Subset to Latin (English-only → no extended ranges needed).

| role            | family          | weights      | usage                                                        |
|-----------------|-----------------|--------------|-------------------------------------------------------------|
| **Display**     | Marcellus       | 400          | page heroes, section titles, **deity names**, pricing numbers |
| **Body / UI**   | IBM Plex Sans   | 400, 500, 600, 700 | all UI text, body, buttons, form labels               |
| **Mono / code** | IBM Plex Mono   | 400, 500, 600 | IDs, labels (uppercase), Gherkin/code, glyphs, run log       |

```css
:root {
  --font-display: "Marcellus", Georgia, "Times New Roman", serif;
  --font-body:    "IBM Plex Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --font-mono:    "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Type scale (DERIVED §13 — extract gives no scale). rem on 16px root; UI base 14px. */
  --fs-display: 2.00rem;   /* 32px  Marcellus — hero / deity name large */
  --fs-h1:      1.50rem;   /* 24px  Marcellus */
  --fs-h2:      1.25rem;   /* 20px  Marcellus */
  --fs-h3:      1.0625rem; /* 17px  Marcellus or Plex Sans 600 */
  --fs-body:    0.875rem;  /* 14px  Plex Sans 400 — base */
  --fs-sm:      0.8125rem; /* 13px */
  --fs-xs:      0.75rem;   /* 12px  captions */
  --fs-mono:    0.6875rem; /* 11px  mono labels/IDs (uppercase) */

  --lh-tight: 1.15;  /* display/headings */
  --lh-snug:  1.35;  /* UI / labels */
  --lh-body:  1.55;  /* paragraphs, chat, log */

  --ls-display:  0.005em;
  --ls-mono:     0.10em;   /* heavy letter-spacing on mono labels (extract: "heavy letter-spacing") */
  --ls-mono-id:  0.04em;   /* IDs/code, lighter */
}
```

**Mono label convention:** mono labels (KPI captions, field labels, tool codes, IDs like `TC_CHK_001`)
render **UPPERCASE** with `letter-spacing: var(--ls-mono)` at `--fs-mono`, color `--muted`. The keystone
`TestCase.key` (`TC_CHK_001`), tool codes (PW/CY/AP/MW/…, extract §3), and run labels all use this style.

Deity names always render in `--font-display`; never substitute the body face for an agent's name.

---

## 4. Spacing, radii, shadow, z-index

```css
:root {
  /* Spacing — 4px base (DERIVED §13). Tailwind spacing maps to these. */
  --sp-0: 0; --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px; --sp-16: 64px;

  /* Radii — extract §11: 5 / 9 / 12 / 16 / 50% / 24%(glyph) */
  --r-xs:    5px;   /* chips, pills, inputs (small) */
  --r-sm:    9px;   /* buttons, fields, badges */
  --r-md:    12px;  /* cards, KPI cards, modal */
  --r-lg:    16px;  /* large panels, hero cards */
  --r-pill:  50%;   /* status dot, circular avatars, donut */
  --r-glyph: 24%;   /* agent glyph tile (squircle-ish rounded square) */

  /* Elevation */
  --shadow:       /* defined per theme (§2.1) */;
  --shadow-sm:    0 2px 8px rgba(0,0,0,.25);   /* DERIVED §13 — hover lift, dropdowns */
  --shadow-modal: 0 12px 48px rgba(0,0,0,.45); /* DERIVED §13 — modal overlay */

  /* Z-index ladder */
  --z-base: 0; --z-sticky: 100; --z-sidebar: 200; --z-topbar: 300;
  --z-dropdown: 400; --z-modal: 500; --z-toast: 600; --z-tooltip: 700;
}
```

---

## 5. Buttons

| variant     | fill                 | text            | border            | use                              |
|-------------|----------------------|-----------------|-------------------|----------------------------------|
| `primary`   | `--accent` (gold)    | `--bg` (dark navy) | none            | primary action ("Run", "Start free", "Awaken team") |
| `secondary` | transparent          | `--text`        | 1px `--border`    | secondary action                 |
| `ghost`     | transparent          | `--muted`→`--text` on hover | none  | toolbar / inline action          |
| `danger`    | transparent          | `--fail`        | 1px `--fail`      | destructive (cancel run, delete) |
| `accent-soft` | `--accent-soft`    | `--accent`      | none              | selected/toggled state           |

```
sizes:  sm  = 28px h, padding 0 12px, --fs-sm,  --r-sm
        md  = 36px h, padding 0 16px, --fs-body, --r-sm   (default)
        lg  = 44px h, padding 0 24px, --fs-body 600, --r-sm
states: default | hover (lift --shadow-sm, +6% lightness) | active (translateY 1px)
        | focus-visible (§11 ring) | disabled (opacity .45, no pointer) | loading (gxspin spinner, label dim)
```

`primary` label on gold computes **11.18:1** (navy `--bg` on `--accent`) — well above AA. Icon-only buttons
require `aria-label`. Minimum hit target 36×36 (md); `sm` reserves an invisible 4px pad to reach 36.

---

## 6. Inputs & form controls

```
text / email / password / textarea / select:
  fill --field · 1px --border · radius --r-sm · height 38px (textarea auto) · padding 0 12px
  text --text · placeholder --muted · label above in mono caption (§3) · --fs-body
  focus: border --accent + focus ring (§11); invalid: border --fail + helper text --fail, aria-invalid
  disabled: opacity .5
password: trailing show/hide eye toggle button (ghost, aria-pressed, toggles input type)
  — keystone auth uses local email/password; "remember me" checkbox + Google/SSO buttons on login
checkbox / radio: 18px box, --field fill, checked = --accent fill + --bg checkmark, focus ring
select: native-styled with custom chevron (--muted); options panel uses --surface + --shadow
search (topbar): field with leading magnifier glyph, 32px h, --r-pill optional
```

All fields associate a visible `<label>` (never placeholder-as-label). Error text is programmatically
linked via `aria-describedby`. Required fields marked with text "(required)" — not color alone.

---

## 7. Cards, KPI cards, badges/chips, toggles

### 7.1 Card
`--card` fill · 1px `--border` · `--r-md` · `--shadow` · padding `--sp-5`. Header row: title (`--font-display`
or Plex 600) + optional action slot. Hover (interactive cards): `--shadow-sm` lift + border → `--accent` at
.4 alpha.

### 7.2 KPI card
Compact metric card (dashboard "Agent room" KPIs). Layout: mono uppercase caption (`--muted`, `--fs-mono`)
→ big value (`--font-display`, `--fs-display`, `--text`) → optional delta/trend chip. Optional leading icon
in an `--accent-soft` circle. Fixed min-height for grid alignment. Value never wraps; truncate with tooltip.

### 7.3 Badge / chip
`--r-sm` (badge) or `--r-pill` (chip), `--fs-mono` uppercase or `--fs-xs`, padding `0 8px`, 20–22px h.
Color-coded via the enum→token map (§2.3) but **always** carries a text label and/or icon — color is never
the only signal. Tool-binding chips show the short tool code (extract §3, e.g. HX, ST, QA, PW, CY, PM,
RA, KR, AP, MW, K6, GT, JM, PX, AT, ZAP, BP, AX, PA) in mono uppercase.

### 7.4 Toggle (switch)
Track 36×20, knob 16px. Off: `--field` track, `--muted` knob. On: `--accent` track, `--bg` knob. Slides via
`transform` (200ms). `role="switch"` + `aria-checked`; focus ring on track. Two product uses:
- **Theme toggle** (topbar ☾/☀): switches `data-theme`; icon swaps moon/sun; `aria-label="Toggle theme"`.
- **Agent wake/sleep** & **DAG stage selection**: enable/disable maps to `ToolBinding.enabled` (awake) and
  drives `AgentRuntimeStatus` IDLE when off (keystone §1 derivation).

---

## 8. Agent avatar-tile, status dot, donut, progress bar

### 8.1 Agent avatar-tile  *(signature component)*
A deity identity tile = **family-color frame + portrait/glyph + status dot**.

```
structure (z-stacked):
  [outer frame]  border 2px solid var(--fam-*)   ·  radius --r-glyph (24%)  ·  padding 2px
  [content]      portrait image (object-fit cover)  OR  fallback glyph tile:
                   fallback = --card fill + 2-letter mono glyph (keystone §3: ZE AT AN QC IR FR IS TH XO OD RA)
                   centered, --font-mono 600, --fs-h2, color var(--fam-*), letter-spacing --ls-mono-id
  [status dot]   §8.2 — absolute bottom-right, overlapping frame, ring of --card to separate
sizes:  sm 36 · md 48 · lg 64 · xl 96 (profile)
states: IDLE → whole tile opacity .6 (extract); ACTIVE/BUSY → full; hover → gxbreathe glow in --fam-*
label:  deity name (--font-display) + role label (--muted, --fs-xs) beneath, e.g. "Zeus · QA Lead"
```

The frame color encodes `AgentFamily`; the glyph + name reinforce identity so meaning never rests on the
frame color alone (a11y). The frame is **family color, not gold** — the gods.png concept art uses uniform
gold frames, but the component contract is per-family (keystone §3 family colors).

> **Frame contrast note:** `--fam-ui #3F6FA3` on the lightest `--card #112441` measures **2.97:1**
> (marginally below the 3:1 UI threshold). Mitigations are mandatory: frame ≥2px, render avatar tiles on
> `--bg`/`--sidebar` where possible (ui→bg = 3.47:1), and never rely on the frame alone for family identity
> (glyph color + label carry it too). See §11.

### 8.2 Status dot
Circle, `--r-pill`. Sizes 6/8/10px. Fill per `AgentRuntimeStatus` (§2.3): ACTIVE `--status-active`, BUSY
`--status-busy`, IDLE `--status-idle`. ACTIVE/BUSY animate `gxpulse`; IDLE static. A 2px ring in the parent
surface color separates the dot from the avatar. Always accompanied by the text status label for a11y
(`title`/visually-hidden text "Active"/"Busy"/"Idle"). As a graphical UI element the 3:1 bar applies —
ACTIVE on `--card` = 3.85:1 (passes).

### 8.3 Donut (pass / fail / skip)
SVG ring, segments in order pass→fail→skip. Stroke 10–14px, radius drives size (sm 64 / md 120 / lg 160).
Segment colors: `--pass`, `--fail`, `--skip`. Center: big count (`--font-display`) + mono caption
("PASSED" / rate). Render a **1–2px gap stroke in `--card`** between segments so adjacent segments are
separable without relying on color contrast (critical for light theme where `--pass` on white = 2.73:1).
Always paired with a text legend ("125 of 152 passed" — extract §7). `role="img"` + `aria-label` summarizing
counts. Used in Reports summary and per-tool cards.

### 8.4 Progress bar
Track `--field` (or `--idle-node`), fill `--accent` (or `--pass` when complete). Height 6–8px, `--r-pill`.
Maps `Run.progress` (0..100). Determinate: `role="progressbar"` + `aria-valuenow/min/max`. Indeterminate
(queued/starting): sliding sheen via `gxdash`-style keyframe. Optional inline % label in mono.

---

## 9. Tabs, sidebar, topbar, modal, chat bubble, Gherkin block, DAG node + edge

### 9.1 Tabs
Underline style. Inactive: `--muted` label. Active: `--text` label + 2px `--accent` underline (animated
slide via `transform`). `role="tablist"`/`tab`/`tabpanel`; arrow-key roving tabindex; focus ring on tab.
Product uses: Test Lab BDD/Traditional tabs (extract §6), Reports drill-down, settings.

### 9.2 Sidebar
Left rail, **`--sidebar` (dark navy in both themes)**. Width **236px expanded / 68px collapsed** (extract
§4). Sections: brand mark → nav `[Dashboard, Orchestration, Test Lab, Reports, Docs, Integrations]` →
agent mini-list (avatar-tile sm + name + status dot). Nav item: icon + label (label hidden when collapsed,
shown as tooltip).
Active item: `--accent-soft` wash + **`--sidebar-accent`** left indicator bar + `--sidebar-text` label.
Hover: `--sidebar-text`. Collapse toggle persists. **Critical:** because the rail is dark navy in *both*
themes, sidebar text/icons MUST use the theme-independent `--sidebar-text` / `--sidebar-muted` /
`--sidebar-accent` tokens (§2.2) — **not** `--text`/`--muted`/`--accent`, which flip to near-black in light
theme and would render dark-on-dark (≈1.1:1, unreadable). The sidebar tokens give ≈15:1 / ≈5.7:1 on the
navy surface in both themes.

### 9.3 Topbar
Height ~56px, `--surface`, bottom 1px `--border`, `--z-topbar`, sticky. Left: project dropdown showing
project name + repo + branch + commit (keystone `Project.repoProvider/repoFullName/repoBranch/repoCommit`).
Right: search, theme toggle (§7.4), notifications bell (badge count), user menu (avatar). All actionable
items keyboard-reachable; dropdowns are `--surface` + `--shadow`, `--z-dropdown`, dismiss on Esc/outside.

### 9.4 Modal
Centered dialog, `--card` body, `--r-md`, `--shadow-modal`, max-width per use (sm 420 / md 560 / lg 720).
Scrim: `rgba(0,0,0,.55)` over content, `--z-modal`. Header (title + close ✕) / body / footer (actions
right-aligned, primary last). `role="dialog"` `aria-modal="true"`, labelled by title; **focus trap**, focus
returns to invoker on close, Esc closes. Entry animates `gxin`. Uses: create test-case, media viewer
(extract §7), connect repo, confirm destructive actions.

### 9.5 Chat bubble  *(per-agent chat — later slice; tokens defined now)*
Agent bubble: left-aligned, `--card` fill, `--r-md` (tail corner squared), avatar-tile sm + deity name
header. User bubble: right-aligned, `--accent-soft` fill, `--text`. Timestamp `--muted` `--fs-xs`. Streaming
reply shows a blinking cursor (`gxblink`). Voice/push-to-talk input renders animated bars (`gxwave`).
Body text `--lh-body`. Markdown/code inside uses the Gherkin/code block (§9.6). RAG grounding is **not**
surfaced in chat (extract §0: "not shown in chat").

### 9.6 Gherkin / code block
`--font-mono`, `--fs-sm`, `--lh-body`, fill `--field`, 1px `--border`, `--r-sm`, padding `--sp-3`,
horizontal scroll (no wrap). Gherkin keyword syntax tint (decorative, with a non-color cue — keywords are
bold):

| keyword                                   | token        |
|-------------------------------------------|--------------|
| `Feature` / `Scenario` / `Scenario Outline` | `--accent` (bold) |
| `Given` / `When` / `Then` / `And` / `But` | `--fam-ui` (bold) |
| `Examples` / tables / tags `@…`           | `--muted`    |
| strings / data                            | `--pass`     |
| comments `#…`                             | `--muted` italic |

Optional copy button (ghost, top-right). Used by Test Lab BDD editor (keystone `Feature.content`) and report
detail. Line numbers in `--muted` mono optional.

### 9.7 DAG node + animated edge  *(orchestration canvas — keystone §5 RunNode / RunPlan)*
**Node card: 190 × 58px** (extract §5). Layout: leading agent avatar-tile sm (or kind icon for
`__dispatch`/`__consolidate`) + title (feature/stage key, `--fs-sm` 600, truncate) + state badge. Border &
glow driven by `RunNodeState` (§2.3).

> **Agent display fields are resolved from the client-cached catalog, not per node (perf).** `RunNodeView`
> exposes only `agentId` (keystone §2 `RunNode` carries no display fields). The node's `deityName` / `glyph`
> / `family`-color are looked up from the **ETag-cached agent catalog** (`GET /orgs/{orgId}/agents`, cached
> client-side — see the API conventions), so rendering an N-node DAG is **O(1) catalog reads, not N
> `agentId → Agent` fetches**. Do not add display fields to `RunNodeView`.

```
IDLE       → fill --idle-node, 1px --border, no animation
QUEUED     → dashed --muted border
RUNNING    → --accent border + gxpulse glow; node lifts --shadow-sm
DONE_PASS  → --pass border + ✓ badge
DONE_FAIL  → --fail border + ✕ badge
node kinds (RunNodeKind): DISPATCH (Zeus "resolve & dispatch", level 0) · STAGE · CONSOLIDATE
            (Zeus "consolidate & report", final level)
```

**Edges:** bezier curves, 1.5px, `--border` when idle. When the **source** node is `RUNNING`/active, the
edge animates a **dashed flow** via **`gxdash`** in `--accent`. Edges route dispatch→stages (by `deps`,
level = 1 + max(dep levels)) → leaves→consolidate (keystone §5 waves). Same-level nodes = a **wave**
(parallel lanes; Team 3 / Pro 10 / Ent ∞ — extract §5). Canvas pan/zoom; nodes keyboard-focusable with
`--accent` ring; an accessible run summary (counts, per-node state list) mirrors the canvas for non-visual
users. Live log panel beside the canvas colors lines per `RunEvent.LOG.level` (§2.3).

---

## 10. Agent taxonomy (canonical roster + families)

Canonical **desktop** roster (keystone §3; decisions-log #1 — the doc/mobile alternates
Odín/Obatala/Indra/Pangu/Izanagi/Perún/Marduk/Viracocha are superseded). Slot keys are the frozen
`AgentSlot` lowercase keys; family keys are the frozen `AgentFamily` keys.

| slot      | deityName      | role (label)    | family     | glyph | culture       | frame token      | default tool |
|-----------|----------------|-----------------|------------|-------|---------------|------------------|--------------|
| `lead`    | Zeus           | QA Lead         | `proceso`  | `ZE`  | Grecia        | `--fam-proceso`  | Helix Core   |
| `arch`    | Athena         | QA Architect    | `proceso`  | `AT`  | Grecia        | `--fam-proceso`  | Strategy     |
| `manual`  | Anubis         | QA Manual       | `proceso`  | `AN`  | Egipto        | `--fam-proceso`  | Suites · Steps |
| `web`     | Quetzalcóatl   | Web             | `ui`       | `QC`  | Azteca        | `--fam-ui`       | Playwright   |
| `api`     | Iris           | API             | `backend`  | `IR`  | Grecia        | `--fam-backend`  | Postman      |
| `android` | Freya          | Android         | `ui`       | `FR`  | Escandinavia  | `--fam-ui`       | Appium       |
| `ios`     | Isis           | iOS             | `ui`       | `IS`  | Egipto        | `--fam-ui`       | Appium       |
| `perf`    | Thor           | Performance     | `backend`  | `TH`  | Escandinavia  | `--fam-backend`  | k6           |
| `visual`  | Xochiquetzal   | Visual          | `ui`       | `XO`  | Azteca        | `--fam-ui`       | Pixelmatch   |
| `sec`     | Odin           | Security        | `guardian` | `OD`  | Escandinavia  | `--fam-guardian` | OWASP ZAP    |
| `a11y`    | Ra             | Accessibility   | `guardian` | `RA`  | Egipto        | `--fam-guardian` | axe-core     |

**Family legend:** `proceso #A07D2C` (gold) · `ui #3F6FA3` (blue) · `backend #7E63A6` (purple) ·
`guardian #2F8F78` (teal). Tool options per slot (Strategy pattern) come from keystone §3 / extract §3 and
render as tool-binding chips (§7.3); `ToolBinding.enabled` = awake (drives status). The 11 are seeded
per-Org (keystone §2 `Agent`), so the UI always renders exactly this set.

---

## 11. Accessibility

**Targets:** WCAG 2.2 AA + OWASP ASVS L2 UI controls. Non-color cues on every status. Visible focus on
every interactive element. Reduced-motion honored (§12). Min hit target 24×24 (controls aim for 36×36).

**Focus ring (one token, applied everywhere):**

```css
:root { --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent); }
:where(button,a,input,select,textarea,[role="switch"],[role="tab"],[tabindex]):focus-visible {
  outline: none; box-shadow: var(--focus-ring); border-radius: inherit;
}
```

The double-layer ring (inner `--bg` gap + outer `--accent`) guarantees a visible boundary on any surface.
Never remove focus styling; `:focus-visible` keeps it pointer-quiet but keyboard-loud.

**Verified contrast (computed against the frozen palette).** PASS = meets the stated WCAG minimum.

| pair                                            | ratio   | bar (use)            | result |
|-------------------------------------------------|---------|----------------------|--------|
| dark `--text` on `--card`                       | 13.56:1 | 4.5 (body)           | PASS   |
| dark `--muted` on `--card`                      | 5.24:1  | 4.5 (body)           | PASS   |
| dark `--muted` on `--bg`                        | 6.13:1  | 4.5 (body)           | PASS   |
| dark `--accent` on `--bg`                       | 11.18:1 | 4.5 (text)           | PASS   |
| navy `--bg` text on `--accent` (primary button) | 11.18:1 | 4.5 (text)           | PASS   |
| dark `--pass` on `--card`                       | 5.69:1  | 4.5 (text)           | PASS   |
| dark `--status-active` dot on `--card`          | 3.85:1  | 3.0 (UI graphic)     | PASS   |
| dark `--blocked` / `--skip` on `--card`         | 6.95 / 9.56:1 | 4.5            | PASS   |
| light `--text` on `--bg`                        | 15.11:1 | 4.5 (body)           | PASS   |

**Known frozen-palette risks (do NOT assert AA; apply the guardrail):**

| pair                                       | ratio  | issue                              | mandatory guardrail |
|--------------------------------------------|--------|------------------------------------|---------------------|
| dark `--fail #E5484D` on `--card`          | 3.97:1 | below 4.5 for small body text      | use `--fail` only for ≥18.66px-bold/≥24px, or as icon/fill (3:1 OK); use **`--fail-soft #E0738A` (5.17:1)** for small fail text |
| `--fam-ui #3F6FA3` frame on `--card`       | 2.97:1 | below 3:1 UI threshold             | frame ≥2px; prefer tiles on `--bg`/`--sidebar` (3.47:1); identity also via glyph color + label |
| `--fam-ui/backend/guardian` on `--card`    | 2.97–3.93:1 | tight on lightest surface     | same as above; never sole identity carrier |
| light `--muted #6E7892` on `--bg`          | 3.90:1 | below 4.5 for body                 | light `--muted` for large text (≥18.66px-bold/≥24px) / secondary UI only; body text uses `--text` |
| light `--accent #9A7B2E` on `--card`       | 4.00:1 | below 4.5 for small text           | accent-as-text in light only ≥large; otherwise UI fills/borders only |
| light `--pass #3FB079` on `--card`/white   | 2.73:1 | below 3:1 as graphic               | donut/segments separated by `--card` gap stroke (§8.3) + text legend; pass never used as text on white |

These are properties of the **frozen** palette; they are recorded so implementers do not paper over them.
If the owner later wants AA-clean small text in all positions, the fix is a palette amendment in the
keystone (e.g. a darker light-theme `--muted`), not a local component override.

**Other a11y rules:** semantic landmarks (`header`/`nav`/`main`); skip-to-content link; modal focus trap
(§9.4); DAG canvas has a non-visual run summary (§9.7); donut/progress expose `aria` values (§8.3/§8.4);
all icon-only controls carry `aria-label`; status pills carry visually-hidden text labels; forms link
errors via `aria-describedby` and never signal validity by color alone.

---

## 12. Motion tokens

Seven named animations (extract §11). Animate **only `transform`/`opacity`** (compositor-friendly).

| token       | meaning / where                                              | sketch |
|-------------|-------------------------------------------------------------|--------|
| `gxpulse`   | active status dot · `RUNNING` DAG node · `RUNNING` run badge — "alive/working" | opacity+scale pulse |
| `gxbreathe` | soft glow on hover/active agent tiles & accent surfaces — ambient breathing | box-shadow/opacity ease in-out |
| `gxwave`    | voice / push-to-talk audio bars (chat) — speaking            | bar `scaleY` stagger |
| `gxblink`   | text/streaming caret (chat reply, code editor) — typing      | opacity step blink |
| `gxin`      | fade-up entrance (cards, modal, list items appearing)        | translateY+opacity in |
| `gxdash`    | animated dashed DAG edge flow when source node is active     | `stroke-dashoffset` march |
| `gxspin`    | spinner (button loading, indexing, queued)                   | 360° rotate |

```css
:root {
  --motion-fast: 120ms; --motion-base: 220ms; --motion-slow: 400ms;
  --ease-standard: cubic-bezier(.2,.0,.2,1);
  --ease-emphasis: cubic-bezier(.2,.7,.2,1);
}

@keyframes gxpulse   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.55;transform:scale(.82)} }
@keyframes gxbreathe { 0%,100%{box-shadow:0 0 0 0 var(--accent-soft)} 50%{box-shadow:0 0 18px 2px var(--accent-soft)} }
@keyframes gxwave    { 0%,100%{transform:scaleY(.35)} 50%{transform:scaleY(1)} }
@keyframes gxblink   { 0%,49%{opacity:1} 50%,100%{opacity:0} }
@keyframes gxin      { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes gxdash    { to{stroke-dashoffset:-24} }
@keyframes gxspin    { to{transform:rotate(360deg)} }

/* Mandatory reduced-motion fallback for EVERY token */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; animation-iteration-count: 1 !important;
      transition-duration: .001ms !important; }
  /* Functional states convey via static cue instead of motion:
     gxpulse → solid dot/border · gxdash → static dashed edge · gxspin → static spinner glyph
     · gxwave → static bars · gxblink → solid caret · gxin → instant · gxbreathe → static glow */
}
```

Looping animations tied to state (`gxpulse`, `gxdash`, `gxwave`, `gxblink`) run only while the state holds
(running/speaking/streaming) to avoid idle CPU. `gxin` runs once on mount.

---

## 13. Deviations & derived values

Values **not** present in the keystone or extract that this spec introduces (flagged so they are never
mistaken for frozen vocabulary). The extract DID specify: all theme hex, status/semantic hex, family hex,
fonts, radii (5/9/12/16/50%/24%), the seven animation names, dark `--accent-soft`/`--shadow`, sidebar 236/68,
DAG node 190×58. Everything below is designed here:

- **Type scale** (`--fs-*`, line-heights, letter-spacing) — extract names the three faces but gives no scale.
- **Spacing scale** (`--sp-*`, 4px base) and **z-index ladder** — not in inputs.
- **Light-theme `--accent-soft` and `--shadow`** — extract gives only the dark values; light derived.
- **Sidebar text tokens** (`--sidebar-text`, `--sidebar-muted`, `--sidebar-accent`) — theme-independent
  set so the constant dark-navy rail stays legible in light theme; the extract gives `--sidebar` only.
- **`--shadow-sm` / `--shadow-modal`** — additional elevation steps.
- **`--fail-soft` role split** — extract lists `fail #E5484D/#E0738A` as two hex; this spec assigns
  `--fail` (solid/icon) vs `--fail-soft` (small text & donut secondary). Both hex are from the extract.
- **`--focus-ring` token & values** — a11y requirement; ring composition designed here.
- **Component dimensions not in inputs** — button/input/toggle/topbar/modal/donut/avatar sizes, tab/badge
  metrics. (Sidebar 236/68 and DAG node 190×58 are from the extract, not deviations.)
- **English-only** — removal of the prototype's i18n (`T()`/`setLang`, ES/EN selector) per decisions-log #2.
- **Avatar frame = family color** (not the uniform gold of gods.png concept art) — follows the
  task/extract component contract and keystone §3 family colors.

No keystone entity names, field names, enum values, agent slot keys, family keys, glyphs, or port
signatures were renamed or added.

---

## 14. Performance budgets (UI-scoped)

| budget                                         | target |
|------------------------------------------------|--------|
| `@gilgamesh/ui` CSS (tokens + base, gzip)      | ≤ 14 KB |
| Critical web font payload (above-fold, WOFF2)  | ≤ 90 KB (Marcellus 400 + Plex Sans 400/600, Latin subset) |
| Font loading                                   | `font-display: swap`; `preload` only above-fold faces; rest lazy |
| Theme switch                                   | single `data-theme` attribute flip; **no layout reflow** (color/shadow only) |
| Animation                                      | `transform`/`opacity` only; no animated `width`/`top`/`box-shadow`-driven layout; honor reduced-motion |
| DAG canvas                                      | virtualize off-screen nodes; ≥50 nodes interactive at 60fps; edges drawn on one SVG/canvas layer |
| Live run log                                   | windowed/virtualized list; cap retained DOM lines; stream-append, never full re-render |
| Long lists (cases, features, agents)           | virtualized beyond ~50 rows; skeletons via `gxin` while loading |
| Images / artifacts                             | avatar portraits responsive + lazy; **report returns `artifactId` only** — the viewer mints the signed URL **on demand** when a media item opens (`GET /artifacts/{id}`), never pre-signed per case during report assembly (avoids an N+1 signing path against the `≤100 ms` SAS budget). Report media lazy-loads in the viewer modal (keystone §2 Artifact) |
| Interaction readiness                          | controls keyboard-focusable on first paint; no layout shift from late-loading fonts (metric-matched fallbacks in `--font-*` stacks) |

These are **UI** budgets; API latency / runner concurrency budgets live in their own foundation artifacts
(decisions-log cross-cutting mandates), not here.
