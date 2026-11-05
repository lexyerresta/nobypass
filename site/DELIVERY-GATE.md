# anti-slop Delivery Gate: NoBypass landing page

Rules: [anti-slop](https://github.com/miqdadbadjuber/anti-slop) by Miqdad Badjuber (MIT). Mode: during. Direction: [DESIGN.md](DESIGN.md). Dial: ENERGY 1 / RHYTHM 2 / MOTION 1.

Verification ran in Microsoft Edge through Playwright: light and dark themes, at 1280px and 375px. That came to 72 automated checks, with 72 PASS and 0 FAIL.

## Block 1: Hard Gate (every answer must be "no")

| Rule | Result | Evidence |
|---|---|---|
| R-02 em dash | PASS | `grep "—"` over `site/` finds nothing. |
| R-03 mobile | PASS | At 375px, scrollWidth equals clientWidth in both themes and no element extends past the viewport. Every button and nav link is at least 44px tall. |
| R-17 numbers | PASS | The only numbers shown (9 files, 7 errors, 8 files, 5 errors) are real `nobypass check` output from the repository fixtures. |
| R-18 testimonials | PASS | There is no testimonials section. |
| R-23 assets | PASS | The logo is a text wordmark, as the owner chose. The favicon is the wordmark's "N". The earlier invented 3-bar mark was removed. |
| R-24 navigation | PASS | Nav links go to #demo, #contract, #rules and #start, and each section exists (click-through below). GitHub goes to the real repository. |
| R-25 contrast | PASS | Every visible text node was measured against its background in both themes. None is below AA, and the lowest text token is 4.53:1. |
| R-26 interactive | PASS | Every control has a real action (click-through below). |
| R-27 states | PASS | The page fetches no data. The copy control has success and failure states, both tested. |
| R-28 FAQ | PASS | There is no FAQ. |
| R-32 keyboard | PASS | Tab order is skip link, wordmark, nav, theme, CTA, and every stop shows a focus outline. The demo toggles work with Enter. |
| R-33 patch scripts | PASS | The theme, demo and copy features are written in `main.js` and `styles.css`. |
| R-34 themes | PASS | Light and dark both pass the contrast, overflow and screenshot checks. |
| R-35 verified | PASS | Click-through results are listed below. No console errors or failed requests occurred in any of the four runs. |
| R-36 claims | PASS | The page makes no security, compliance or performance claims. |
| R-37 direction | PASS | Direction came from the owner (mood, palette, logo) and is recorded in DESIGN.md. |
| R-38 real content | PASS | Code samples are the fixture files, verbatim. The rules table matches `docs/rule-reference.md`. |
| R-39 semantics | PASS | `cursor: pointer` is set on all links and buttons (checked). Controls are native `<button>`s with `aria-pressed`. The SVG has a title and description. Hover, active and focus states are distinct. Nothing moves. The document has `lang`, a title, landmarks and one h1 with no skipped heading levels. Zoom is not blocked. |
| R-40 performance | PASS | The page has no img, video or iframe. Fonts are self-hosted and preloaded with `font-display: swap`. The only head script is an inline first-party theme read, and `main.js` is deferred. Web Vitals were not measured. |

### Click-through record (light theme, 1280px; repeated in dark)

- Nav "Demo", "Contract", "Rules", "Setup" scroll to the matching existing section.
- "Run it on your repo" goes to #start.
- Demo NestJS/agent, NestJS/fix, Laravel/fix and Laravel/agent each show the matching code and output and update the file label.
- Theme toggle switches between light and dark, updates its label and persists after a reload.
- All five copy buttons copy the exact command, show "Copied" and announce it in the status line.
- With the clipboard blocked, a copy button shows "Failed" and the status line gives instructions.
- The "Read the source on GitHub", footer and limitation links point to real URLs in the repository.
- The "Nodezio" links in the header and footer go to https://nodezio.com, which returns 200. The header link has a 44px tap target and sits second in the Tab order, right after the wordmark.

## Block 2: Purpose-Gate (technique allowed, reason written)

| Rule | Result | Reason |
|---|---|---|
| R-01 gradients/glow | PASS | None are used. |
| R-04 icons | PASS | There are no icons. ✖ and ✔ are the CLI's own output glyphs. |
| R-06 typography | PASS | Plex was chosen for its technical-documentation character (see DESIGN.md). Mono appears only for code, paths and rule IDs. There are no uppercase wide-tracked labels. |
| R-07 background | PASS | Plain paper and ink, with no grid or pattern. |
| R-08 arrows | PASS | No button has an arrow. The → arrows appear only in dependency paths, where they mean "depends on". |
| R-09 badges | PASS | There are no badges. Severity in the rules table is plain colored text that carries real data. |
| R-10 glass | PASS | None. |
| R-12 shadow | PASS | None. Hierarchy comes from borders and surface tone. |
| R-13 glow | PASS | None. |
| R-14 cards | PASS | There are no feature-card grids. |
| R-19 animation | PASS | MOTION 1: hover and focus states only. The old infinite dash animation was removed. |
| R-22 illustration | PASS | The only illustration is the layer diagram, which shows the product's own rule (BND002). |

## Block 3: Liveliness (every answer must be "yes")

| Item | Result | Evidence |
|---|---|---|
| Dials declared | PASS | ENERGY 1 / RHYTHM 2 / MOTION 1 in DESIGN.md. |
| Output matches dials | PASS | Calm type and no motion. Sections vary: split hero, full-width statement, two-pane demo, contract split, table, numbered command rail, unequal two-column blocks. |
| Focal point per screen | PASS | Hero H1, statement H2 in red, demo output, contract YAML, rules table, command rail. |
| Structural whitespace | PASS | Bands with borders separate the statement and contract sections from the open sections. |
| One deliberate accent | PASS | Orange is used only on "No" in the wordmark, "Check.", the primary CTA, step numbers, focus rings and the limitations link. |
| Identity motif | PASS | The layer path (`controller → support → service → repository`) appears in the hero diagram, the demo output and the contract section. |
| Design Read declared | PASS | "Open-source developer-tool landing page for backend engineers and tech leads using AI coding agents, precise documentation-like engineering language." |

## Block 4: Craftsmanship and Quality Locks (every answer must be "no")

| Item | Result | Evidence |
|---|---|---|
| C-1 intentionality | PASS | Every major decision has a one-line reason in DESIGN.md. |
| C-2 functional | PASS | See the click-through record. |
| C-3 content-driven | PASS | Each section maps to a real product fact: problem, demo, contract, rules, setup, limits. There are no pricing, testimonials, FAQ or logo bar. |
| C-4 resilience | PASS | Tested in both themes, at both breakpoints, with keyboard only, and with copy failure. |
| C-5 evidence | PASS | All output shown is real. |
| R-05 template layout | PASS | No 3-step "how it works" (the setup steps are the real five commands), no bento, no terminal window chrome, no 4-column footer. |
| R-11 radius | PASS | 4px on controls, 8px on panes, and no pills. |
| R-15 CTAs | PASS | "Run it on your repo", "Read the source on GitHub". |
| R-16 buzzwords | PASS | None. |
| R-20 identity | PASS | Swapping the name would still leave a layer-contract page, because the content is the product itself. |
| R-21 dark mode | PASS | The page follows the system theme, and a working toggle is shipped. |
| R-29 palette | PASS | One accent (orange), with red and green reserved for meaning. |
| R-30 clone | PASS | Not modeled on any product. |
| R-31 reasons | PASS | See DESIGN.md. |
