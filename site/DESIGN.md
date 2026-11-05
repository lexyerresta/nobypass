# NoBypass landing page: design direction

This file records the owner's design direction for `site/` and the reason behind each major visual decision. The page is filtered with the [anti-slop](https://github.com/miqdadbadjuber/anti-slop) rules by Miqdad Badjuber (MIT).

## Owner direction (answers from the project owner)

- **Mood:** precise and calm. It should read like a serious engineering tool.
- **Palette:** warm neutrals with one safety-orange accent. Red appears only for violations and green only for a passing check.
- **Logo:** a text wordmark only. No invented mark.

Dial: ENERGY 1 / RHYTHM 2 / MOTION 1

Design Read: an open-source developer-tool landing page for backend engineers and tech leads who use AI coding agents, in a precise, documentation-like engineering language.

## Decisions and reasons

| Decision | Reason |
|---|---|
| Warm paper and ink neutrals | A calm, printed-document feel that fits a tool whose output is a report. They also keep it from reading as a generic dark "tech" page. |
| One orange accent | Used on the primary action, the wordmark's "No" and the active state of controls. It is never used for decoration. |
| Red and green reserved | Red means a blocked violation and green means PASS, the same meaning they carry in the CLI. |
| IBM Plex Sans + IBM Plex Mono, self-hosted | Plex was drawn for technical documentation: neutral and readable, with mechanical details that give character without noise. Mono appears only where the content is code, paths or rule IDs. Fonts are self-hosted, so there are no third-party requests. |
| Identity motif: the layer path | `controller → support → service → repository` set in mono, with the bypass drawn as a red line that skips layers. It recurs in the hero diagram, the demo and the contract section. |
| Light and dark themes with a toggle | It is a developer tool, so some readers want dark. Neither theme is forced: the page follows the system setting and a toggle overrides it. |
| No window chrome on output | The CLI output shown is real output from the repository fixtures, presented as a report rather than an imitation terminal window. |
| Motion: hover and focus states only | MOTION 1. Nothing on the page animates on its own. |
| Small radius (4 to 8px) everywhere | Precise, not soft. Pills are not used. |
| Sections vary in composition | RHYTHM 2: a split hero, a full-width statement, a two-pane demo, a table, and an asymmetric command list. |
