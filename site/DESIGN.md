# NoBypass landing page: design direction

This file records the owner's design direction for `site/` and the reason behind each major visual decision. The page is filtered with the [anti-slop](https://github.com/miqdadbadjuber/anti-slop) rules by Miqdad Badjuber (MIT).

## Owner direction (answers from the project owner)

- **Mood:** precise and calm. It should read like a serious engineering tool.
- **Palette:** warm neutrals with one safety-orange accent. Red appears only for violations and green only for a passing check.
- **Logo:** a text wordmark only. No invented mark.

Dial: ENERGY 3 / RHYTHM 3 / MOTION 3 (revision 3, 2026-11-09). Earlier: ENERGY 2 / RHYTHM 3 / MOTION 1 (2026-11-06), ENERGY 1 / RHYTHM 2 / MOTION 1 (first version).

Design Read: an open-source developer-tool landing page for backend engineers and tech leads who use AI coding agents, in a precise, documentation-like engineering language.

## Decisions and reasons (revision 2, kept unless revision 3 below replaces them)

| Decision | Reason |
|---|---|
| Warm paper and ink neutrals | A calm, printed-document feel that fits a tool whose output is a report. They also keep it from reading as a generic dark "tech" page. |
| One orange accent | Used on the primary action, the wordmark's "No" and the active state of controls. It is never used for decoration. |
| Red and green reserved | Red means a blocked violation and green means PASS, the same meaning they carry in the CLI. |
| IBM Plex Sans + IBM Plex Mono, self-hosted | Plex was drawn for technical documentation: neutral and readable, with mechanical details that give character without noise. Mono appears only where the content is code, paths or rule IDs. Fonts are self-hosted, so there are no third-party requests. |
| Identity motif: the layer path | `controller → service → repository → model` set in mono, with the bypass drawn as a red line that skips layers. It recurs in the hero diagram, the demo and the contract section. |
| Light and dark themes with a toggle | It is a developer tool, so some readers want dark. Neither theme is forced: the page follows the system setting and a toggle overrides it. |
| No window chrome on output | The CLI output shown is real output from the repository fixtures, presented as a report rather than an imitation terminal window. |
| Motion: hover and focus states only | MOTION 1. Nothing on the page animates on its own. |
| Small radius (4 to 8px) everywhere | Precise, not soft. Pills are not used. |
| Demo as an ink band with stack tabs | The demo is the proof, so it is the focal point: a dark band in both themes, eight stack tabs, real fixture code with line numbers, flagged lines tied to findings, and a small highlighter for readability. Content is generated from fixtures by `scripts/build-site-demo.mjs`. |
| Red line marker on flagged code | Functional: it ties a code line to the finding that names it. Clicking a finding highlights its line. |
| Sections vary in composition | RHYTHM 3: a split hero, a full-width statement, a dark tabbed demo band, a contract split, two tables, and an asymmetric command list. |

## Revision 3 (2026-11-09): colour, a drawn scene and motion

Owner direction, translated from Indonesian: "Fix NoBypass too, I want animation in it as well; even though it is backend-focused, I want this website to be more interactive and have lots of colour." A follow-up asked for the page to feel like a sibling of lexyerresta.nodezio.com, nodezio.com and DomainScope: a drawn SVG scene as the hero, with its own concept.

Design Read: an open-source developer-tool landing page for backend engineers and tech leads who use AI coding agents, drawn and colourful like the other Nodezio sites, with every colour carrying a meaning.

| Decision | Reason |
|---|---|
| Four layer hues: controller blue, service violet, repository teal, model gold | The owner wanted lots of colour; giving each architecture layer its own hue makes the colour explain the product instead of decorating it. |
| The hue follows the role, not the word | Entry layers (controller, route, router, view, UI) are blue, service-like layers (service, selectors, data access layer) violet, repository teal, data layers (model, entity, persistence, database) gold, so all nine presets read with one key. |
| Red stays the only violation colour | A bypass, a BND rule and a FAIL are the one thing the reader must spot, so red is never used for anything else. |
| Green stays PASS and "allowed"; orange stays the brand and primary action; warnings use the orange family | Kept from revision 2 so the CLI's meanings carry over; warnings are rare and always carry the word "warning" and the ⚠ glyph. |
| Each hue has a light and a dark value, all at least 4.5:1 | Light: #2348c0, #7034b5, #006b64, #765300 (5.0 to 7.3:1 on paper, surface and their own tint). Dark: #8fadff, #c9a3ff, #4fd0c0, #efc04f (5.8 to 11:1). The demo band always uses the dark set. |
| Hero: a drawn street scene, the app as a building | Same family as the other Nodezio scenes (flat shapes, warm sky, thick #13202e outlines on key objects), but its own idea: one floor per layer, so the picture is the contract. |
| The elevator carries GET /users down floor by floor | It shows the approved route as something physical: every floor is visited in order, and each floor lights in its hue as the request arrives. |
| The outside chute from controller to model, blocked by a BND002 barrier | It draws the exact violation the product exists for: a shortcut someone built that works but skips two floors. |
| Real names on the floors | UserController::index(), UserService::listActive(), EloquentUserRepository::active() and User are the Laravel valid fixture, so the drawing makes no claim the repository cannot back. |
| Morning sky in light, night sky in dark, with a few lit windows | The scene follows the theme instead of being dimmed, so both themes get a finished picture. |
| "Send a request" and "Try the bypass" buttons | The scene is interactive and keyboard reachable; the status line under them explains each run in words for screen readers. |
| Hero sequence plays once (about 4.5 s), then rests on the blocked bypass | MOTION 3 choreography with a purpose: the reader sees the rule happen once; nothing repeats on its own. |
| Two clouds drift slowly; this is the only loop | It keeps the scene alive at rest without pulling attention; it is off under reduced motion. |
| Statement: a BND002 stamp lands next to "The controller still queries the database" | It ties the problem sentence to the rule that catches it, using the same stamp as the scene. |
| Demo: a scan pass runs down the file, flagged lines turn red as it reaches them, then the report prints finding by finding | It shows what the checker does (read every line, then report) and draws the eye from the flagged line to its finding. It is capped at about 0.7 s. |
| Findings show the edge as two coloured chips (controller → model) and colour every layer name | The reader sees which two layers a finding is about before reading the sentence. |
| Contract: a layer explorer next to the YAML | Picking a layer shows what it may depend on, with the rule ID for each forbidden edge (BND003 when one layer is skipped, BND001 otherwise, BND002 for queries, as in src/core/rules.ts), and highlights its lines in the file. Pointing at a YAML line previews it. |
| Stacks table: every layer name in its role colour | The colour key from the hero carries into all nine presets. |
| Setup: a rail that fills as the reader scrolls | It shows progress through the six commands; reached steps fill in. Under reduced motion the rail is shown full. |
| Reduced motion: every end state at once | The scene shows the blocked bypass, stamps are visible, the scan and rail motion are off, and the buttons switch states instantly. |
| No JavaScript: the static end state | The scene shows the chute, barrier and stamp; the explorer shows its default sentence. |
