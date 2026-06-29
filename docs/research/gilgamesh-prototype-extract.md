# Gilgamesh — Canonical Prototype Extract (research reference)

> Source of truth: Claude Design project `ad397295-64f5-40b0-8f60-9ef44b611db1`
> ("Plataforma Gilgamesh de pruebas"). Three files read directly via the design MCP:
> `Gilgamesh - Prototipo.dc.html` (desktop, PRIMARY), `Gilgamesh - Mobile.dc.html` (mobile 1:1),
> `Gilgamesh - Diseño de Plataforma.dc.html` (visual system / design doc).
> Compiled 2026-06-29. This is reference data, not a spec. The spec lives in `/specs`.

## 0. What Gilgamesh is
A web + mobile QA platform where 11 AI agents — each a mythological deity — plan, author and run
software tests across disciplines, collaborate on a visual DAG orchestration canvas, and keep ALL
results inside the app. Dark mode by default. Tagline: **"Testing · Trusted · Elevated."**
Execution runtime = the author's **TOM (Test-Oriented Microkernel)** + **AHM (Atomic-Helix-Model)**.
Agents are grounded by a private RAG (ISTQB + user PDFs) to avoid hallucination; "not shown in chat."

## 1. ⚠️ ROSTER CONFLICT (must be resolved by product owner)
The desktop prototype (declared PRIMARY) uses a DIFFERENT deity roster than the mobile + design-doc.

| slot | id | Desktop `Prototipo` (PRIMARY) | Mobile + Design-doc | family | discipline |
|------|------|------------------------------|---------------------|--------|------------|
| lead | `lead` | **Zeus** (Grecia) | Zeus | proceso | QA Lead · Helix Core |
| arch | `arch` | **Athena** (Grecia) | **Odín** (Escandinavia) | proceso | QA Architect · Strategy |
| manual | `manual` | **Anubis** (Egipto) | **Obatala** (Yoruba) | proceso | QA Manual · Suites·Steps |
| web | `web` | **Quetzalcóatl** (Azteca) | Quetzalcóatl | ui | Web · Playwright |
| api | `api` | **Iris** (Grecia) | **Indra** (India) | backend | API · REST·gRPC |
| android | `android` | **Freya** (Escandinavia) | **Pangu** (China) | ui | Android · Appium |
| ios | `ios` | **Isis** (Egipto) | **Izanagi** (Japón) | ui | iOS · Appium |
| perf | `perf` | **Thor** (Escandinavia) | **Perún** (Eslava) | backend | Performance · k6·Gatling |
| visual | `visual` | **Xochiquetzal** (Azteca) | **Ra** (Egipto) | ui | Visual · Pixelmatch |
| sec | `sec` | **Odin** (Escandinavia) | **Marduk** (Babilonia) | guardian | Security · OWASP ZAP |
| a11y | `a11y` | **Ra** (Egipto) | **Viracocha** (Inca) | guardian | Accessibility · axe-core |

Note: in the design-doc, the deity↔culture mapping is "one culture each" (11 cultures). In the desktop
prototype several deities collapse to fewer cultures (lots of Greek/Norse/Egyptian) and reuse names
across slots (e.g. "Odin" = Security, "Ra" = Accessibility). **Decision needed: which roster is canonical?**

## 2. Family taxonomy & status
```
fam = { proceso:'#A07D2C' (gold), ui:'#3F6FA3' (blue), backend:'#7E63A6' (purple), guardian:'#2F8F78' (teal) }
status: activo (#2F8F5B green) | ocupado (#C08A2E amber) | inactivo (#9AA0AC gray, card opacity .6)
```
Display labels: Active / Busy / Idle. "Awaken team" wakes all idle agents.

## 3. Tool-binding (Strategy pattern) — TOOLS map per role (desktop)
```
lead:        [Helix Core HX]
architect:   [Strategy ST]
manual:      [Suites·Steps QA]
web:         [Playwright PW, Cypress CY]
api:         [Postman PM, REST Assured RA, Karate KR]
android:     [Appium AP, Mobilewright MW]
ios:         [Appium AP, Mobilewright MW]
performance: [k6, Gatling GT, JMeter JM]
visual:      [Pixelmatch PX, Applitools AT]
security:    [OWASP ZAP, Burp Suite BP]
accessibility:[axe-core AX, Pa11y PA]
```
Per-agent selection stored as `toolSel[agentId]` = index into TOOLS[role]. Lead/architect/manual are single-tool.

## 4. Screens & navigation
**Pre-app:** Login (email/pass + show/hide + remember + Google + SSO·SAML; helix canvas bg),
Forgot-password, Create-account, Pricing, Onboarding wizard (3 steps).
**App shell:** left sidebar (236px / 68px collapsed) with nav [Dashboard, Orchestration, Test Lab,
Reports, Docs, Integrations] + agent mini-list; topbar (project dropdown w/ repo+branch+commit, search,
theme toggle ☾/☀, notifications, user menu).
**Views (`view`):** dashboard (Agent room) · orchestrate (DAG canvas) · chat (per-agent + push-to-talk
voice) · reports · editor (Test Lab) · docs (Knowledge base/RAG) · integrations · subscription.

**Onboarding (3 steps):** 1) project name → 2) format (BDD/Gherkin | Traditional) → 3) connect repo
(GitHub | Bitbucket | Azure DevOps; optional). Creates project, sets `authTab` from format.

## 5. Orchestration / DAG
- Pick test types (stage toggles) → Run. Stages have `deps`; kernel builds a DAG:
  `__dispatch` (Zeus "resolve & dispatch", level 0) → stage nodes (level = 1+max(dep levels)) →
  `__consolidate` (Zeus "consolidate & report", final level). Leaves connect to consolidate.
- **Waves** = nodes at same level run in parallel (= "parallel lanes"; tiers: Team 3 / Pro 10 / Ent ∞).
- Node card 190×58, status idle/running(pulse)/done-pass(✓ green)/done-fail(✕ amber). Edges = bezier,
  animated dashed flow (`gxdash`) when active. Live log with per-line agent + pass/fail/run/log colors.
- Sample STAGES (desktop): web `checkout.feature` deps[] · api `payments.api` deps[] ·
  visual `home.visual` deps[web] · perf `load-500vu` deps[api] · mobile `android.smoke` deps[].

## 6. Test Lab (authoring)
Two tabs: **BDD/Gherkin** (feature-file tree by vertical slice: Checkout/Login/Catalog/Payments/Imported;
editor with Given/When/Then; add feature) and **Traditional cases** (id `TC_CHK_001`, scenario, title,
steps, data, expected, priority High/Med/Low, status notrun→pass→fail→blocked→skipped, assigned agent).
Create cases: manual modal · auto-generate (source: document/repo/jira/boards) · import file.
**Capture settings:** video {off|fail|always|demand}, screenshots {off|fail|always|demand} → artifacts in Reports.

## 7. Reports (layered)
Summary (donut pass/fail/skip; runLabel `local · main · 2026-05-25 19:00:02`; commit; "125 of 152 passed")
→ by-tool cards (logo, ran count, donut, rate, "View results") → drill-down:
- **Perf** tool → gauges (throughput, avg, p95, error%) + latency distribution + per-scenario rps/p95/err.
- **Case** tool → donut + case list with per-case ✓/✕, duration, and **media buttons** (VIDEO/SHOT, green=captured, gray=on-demand).
- **Media viewer** modal: video/screenshot frame, duration, "final"/"failure" step, "Captured by Helix runner".
- A tool can be `noData` ("No report ingested").

## 8. Integrations (6 groups, 17 items; `connected` boolean map)
- Source & repos: GitHub, GitLab, Bitbucket, Azure Repos
- Project & tracking: Jira, Azure Boards
- Test management: TestRail, Xray, Zephyr
- Communication: Slack, Microsoft Teams
- CI/CD: GitHub Actions, GitLab CI, Azure Pipelines, Jenkins
- Devices & browsers: Simulators/Emulators, BrowserStack

## 9. Pricing (MOCK billing behind PaymentProvider port)
- **Team** $199/mo ($166 annual, ~16% save): up to 5 agents, 3 parallel lanes, BDD+traditional, GitHub/GitLab/Bitbucket, 1,000 run-min, community support. CTA "Start free".
- **Pro** $499/mo ($416 annual) — "Most popular": all 11 agents, 10 lanes + DAG, AI authoring grounded by private RAG, Jira/Azure/TestRail/Xray/Zephyr, video+screenshots, 10,000 run-min, voice, priority support. CTA "Start free".
- **Enterprise** Custom: unlimited agents/lanes, SSO/SAML + Entra ID, RBAC, audit log, private RAG, on-prem runners, Azure DevOps, BrowserStack, dedicated CSM, 99.9% SLA, DPA. CTA "Talk to sales".

## 10. Sample projects (desktop)
OmniPizza (GitHub `gsanchezm/omnipizza-web` main a1b2c3d) · FinTrust (Azure DevOps `fintrust/checkout-app` develop) · Voyager (Bitbucket `voyager/mobile` release/2.1).

## 11. Design tokens
Fonts: **Marcellus** (display/headings/deity names), **IBM Plex Sans** (UI/body 400-700), **IBM Plex Mono** (labels/code/IDs, uppercase, heavy letter-spacing).
```
[data-theme=dark]  --bg:#0A1626 --surface:#0E1D33 --card:#112441 --field:#0C1B31 --text:#EAF0FA
                   --muted:#8597B4 --border:rgba(255,255,255,.09) --accent:#E7C877
                   --accent-soft:rgba(201,161,78,.15) --sidebar:#0A1424 --shadow:0 6px 24px rgba(0,0,0,.35)
[data-theme=light] --bg:#F4F1E6 --surface:#FBFAF4 --card:#FFFFFF --field:#FFFFFF --text:#0E1B36
                   --muted:#6E7892 --border:rgba(14,27,54,.10) --accent:#9A7B2E --sidebar:#0B1A37
```
Status/semantic: pass #3FB079, fail #E5484D/#E0738A, skip #E7C877, blocked #E0A23C, idle-node #2A3D63.
Radii 5/9/12/16/50%/24%(glyph). Animations: gxpulse (active dot/running node), gxbreathe (glow),
gxwave (voice bars), gxblink (cursor), gxin (fade-up), gxdash (edge flow), gxspin.

## 12. AHM / TOM kernel contract (from github.com/gsanchezm/Test-Oriented-Microkernel-Architecture-TS)
- **Kernel** = `chaos-proxy` gRPC server (:50051): resolves logical locator keys → platform selectors,
  retries transient failures (StaleElement/Timeout, exp. backoff), emits telemetry, routes typed
  **intents** to plugin servers by `DRIVER` env.
- **Plugins** (pure execution engines, long-lived gRPC servers :5005x): playwright, appium, mobilewright,
  gatling, api, pixelmatch. Register via `src/plugins/<name>/server.ts` + plugin class + `actions/` +
  entry in `plugins.config.ts`. "Plugin identity = the tool under the hood" (two plugins can serve one test type).
- **Contract:** input `ExecuteIntent{ intentId, payload, locatorKey, platform, viewport }` → `ActionHandler`
  → response `{ status, payload, metrics }`. Intents catalog in `src/kernel/intents.ts` (single source of truth).
  Client: `src/kernel/client.ts` `sendIntent(INTENT.ID, payload)`.
- **AHM layers:** Atoms (`sendIntent`) → Molecules (cross-platform UI actions) → Organisms (orchestrate
  molecules, pick plugin) → Eco-Systems (`.feature` + step_definitions) → Resonance (Gatling load) →
  Execution Helix (CI workflows).
- **Proposed wrap:** `packages/kernel` exposes a `TestKernel` PORT (enqueue plan, run DAG of agent-plugins,
  stream RunNode events, collect Artifacts) + an adapter that speaks to the real chaos-proxy over gRPC.
  Platform never reaches into kernel internals (LoD); agents register as plugins via a Registry/Factory.
