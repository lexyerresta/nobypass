# anti-slop Delivery Gate: NoBypass landing page

Rules: [anti-slop](https://github.com/miqdadbadjuber/anti-slop) by Miqdad Badjuber (MIT). Mode: during. Direction: [DESIGN.md](DESIGN.md) (revision 3). Dial: ENERGY 3 / RHYTHM 3 / MOTION 3.

Verification ran in Microsoft Edge through Playwright against a local static server: light and dark themes, at 1280, 768, 390 and 360px, with reduced motion and with JavaScript off. The latest run (revision 3: drawn building hero, layer colours, motion) made 203 automated checks: 203 PASS, 0 FAIL.

## Block 1: Hard Gate (every answer must be "no")

| Rule | Result | Evidence |
|---|---|---|
| R-02 em dash | PASS | `grep "—"` over `site/` finds nothing. |
| R-03 mobile | PASS | At 360, 390, 768 and 1280px, scrollWidth equals clientWidth in both themes. Every button and nav link is at least 44px tall (checked). |
| R-17 numbers | PASS | The only numbers are real `nobypass check` output from the fixtures and the counts of rules (7) and presets (9) in the source. |
| R-18 testimonials | PASS | There are none. |
| R-23 assets | PASS | The logo stays the text wordmark. The hero scene is drawn for this page and shows the product's own rule; the owner asked for a drawn scene. |
| R-24 navigation | PASS | Nav links go to #demo, #contract, #rules and #start, which exist. GitHub goes to the real repository. |
| R-25 contrast | PASS | Every visible text node was measured in both themes, including hero text against all three sky stops, SVG labels against their floor fill with the floors lit, and the highlighted YAML lines. None is below AA. Layer hues: 5.0 to 7.3:1 (light), 5.8 to 11:1 (dark). |
| R-26 interactive | PASS | Every control has a real action (click-through below). |
| R-27 states | PASS | The page fetches no data. Copy has success and failure states. The demo has FAIL and PASS states, the explorer a default state. |
| R-28 FAQ | PASS | There is no FAQ. |
| R-32 keyboard | PASS | The scene buttons, stack tabs (arrow keys, Home, End), version toggle, findings, explorer and copy buttons all work from the keyboard and show a focus outline. |
| R-33 patch scripts | PASS | All features are written in `index.html`, `styles.css` and `main.js`. No script rewrites source. |
| R-34 themes | PASS | Light (morning) and dark (night) both pass contrast, overflow and screenshot checks; the toggle switches and persists. |
| R-35 verified | PASS | Click-through below. No console errors or failed requests in any run. |
| R-36 claims | PASS | No security, compliance or performance claims. |
| R-37 direction | PASS | Owner direction is recorded in DESIGN.md, revision 3. |
| R-38 real content | PASS | Code samples are the fixture files verbatim; the floor names in the scene are the Laravel valid fixture's classes; explorer verdicts follow `src/core/rules.ts`. |
| R-39 semantics | PASS | `cursor: pointer` on all links and buttons (checked). Controls are native buttons with `aria-pressed` where they toggle. The scene SVG has a title and description; the decorative sky is `aria-hidden`. Status lines use `aria-live`. The hero sequence runs once (about 4.5 s); the only loop is two slow clouds. Under `prefers-reduced-motion` there are zero running animations (checked with `document.getAnimations()`). |
| R-40 performance | PASS | No img, video or iframe; the scene is inline SVG. Fonts are self-hosted and preloaded. `main.js` is deferred. Web Vitals were not measured. |

### Click-through record (both themes, 1280px)

- The hero sequence plays once when the scene is seen: the elevator stops on all four floors, each lights in its hue, then User::where() slides down the chute and the BND002 barrier and stamp appear.
- "Send a request" replays the elevator run and updates the status line; "Try the bypass" replays the chute run. Both work with Enter.
- Demo: each of the 8 stack tabs, in both versions, shows the same number of findings, flagged lines and edge chips as the real check, with the matching FAIL/PASS verdict. Clicking a finding highlights its line. ArrowRight and End move between tabs.
- Explorer: each of the four layers sets `aria-pressed`, the verdict for every other layer (✔ allowed, BND003, BND001) and highlights its two lines in the YAML. Pointing at a YAML line previews that layer.
- Theme toggle switches and persists after a reload.
- All six copy buttons copy their command and show "Copied".
- The setup rail fills and marks all six steps as reached at the end of the list.
- Reduced motion: the scene shows its end state, both buttons switch instantly, the statement stamp is visible and the demo does not scan.
- JavaScript off: the scene shows the chute, barrier and stamp, and the statement stamp is visible.

## Block 2: Purpose-Gate (technique allowed, reason written)

| Rule | Result | Reason |
|---|---|---|
| R-01 gradients/glow | PASS | One gradient: the sky in the hero scene, which is part of the drawing. No glow. |
| R-04 icons | PASS | No icon set. ✖, ✔ and ⚠ are the CLI's own output glyphs. The drawn props (desks, cabinets, database drums) belong to the floor they sit on. |
| R-06 typography | PASS | Plex, chosen for its technical-documentation character. Mono only for code, paths, layer names and rule IDs. No uppercase tracked labels. |
| R-07 background | PASS | No grid or dot pattern. The hero background is the drawn sky and skyline. |
| R-08 arrows | PASS | No button has an arrow. → appears only in dependency paths and finding edges, where it means "depends on". |
| R-09 badges | PASS | No badges. The edge chips in findings carry real data (the two layers of the finding). |
| R-10 glass | PASS | None. |
| R-12 shadow | PASS | One solid offset under the explorer buttons, drawn as the floor slab of each layer, the same as the floors in the scene. |
| R-13 glow | PASS | None. |
| R-14 cards | PASS | No feature-card grid. |
| R-19 animation | PASS | Each motion has a written purpose in DESIGN.md: the hero run shows the rule, the stamp ties the problem to the rule, the scan shows how a check reads a file, the rail shows progress. No fade-up on every element. |
| R-22 illustration | PASS | The scene is drawn for this page and shows the product's own rule (BND002) with real fixture names. |

## Block 3: Liveliness (every answer must be "yes")

| Item | Result | Evidence |
|---|---|---|
| Dials declared | PASS | ENERGY 3 / RHYTHM 3 / MOTION 3 in DESIGN.md. |
| Output matches dials | PASS | Bold colour and a drawn hero (ENERGY 3); split scene hero, full-width statement, dark tabbed demo band, explorer beside a file, two tables, a scroll rail (RHYTHM 3); a choreographed hero sequence, a scan and a scroll-linked rail (MOTION 3). |
| Focal point per screen | PASS | Hero H1 and the building, the statement in red with its stamp, the demo output, the explorer, the rules table, the command rail. |
| Structural whitespace | PASS | Bands with borders separate the statement and contract sections. |
| One deliberate accent | PASS | Orange stays the single brand and action accent; the layer hues are a coded system, not accents. |
| Identity motif | PASS | The four layer hues and the blocked shortcut: the building, the stamp, the finding chips, the explorer, the YAML and the stacks table. |
| Design Read declared | PASS | In DESIGN.md, revision 3. |

## Block 4: Craftsmanship and Quality Locks (every answer must be "no")

| Item | Result | Evidence |
|---|---|---|
| C-1 intentionality | PASS | Every decision has a one-line reason in DESIGN.md. |
| C-2 functional | PASS | See the click-through record. |
| C-3 content-driven | PASS | Every section maps to a real product fact. |
| C-4 resilience | PASS | Both themes, four widths, keyboard only, reduced motion, JavaScript off, copy failure. |
| C-5 evidence | PASS | All output and names shown are real. |
| R-05 template layout | PASS | No 3-step how-it-works, bento, terminal window, logo bar or 4-column footer. |
| R-11 radius | PASS | 4px on controls, 6 to 8px on panes and floors, round only for the step numbers. |
| R-15 CTAs | PASS | "Run it on your repo", "Read the source on GitHub", "Send a request", "Try the bypass". |
| R-16 buzzwords | PASS | None. |
| R-20 identity | PASS | The building and its colours are the layer contract; swapping the name leaves a page about this product. |
| R-21 dark mode | PASS | Follows the system with a working toggle; the scene has a night version. |
| R-29 palette | PASS | Neutrals, one orange accent, red and green for meaning, and four layer hues that form one documented system. |
| R-30 clone | PASS | Not modeled on any product. |
| R-31 reasons | PASS | See DESIGN.md. |
