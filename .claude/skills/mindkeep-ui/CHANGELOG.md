# Changelog

All notable changes to the mindkeep-ui skill.

## [1.1.0] - 2026-09-03

### Added
- `assets/skeleton/` — a working, themeable implementation of the whole
  behavior contract: `index.html` (demo shell), `skeleton.css` (structural,
  100% token-driven), `wm.js` (the real window manager: drag/resize,
  focus/z-index, launcher, Deliberate Split View)
- A `--mk-*` CSS custom-property token contract (colors, window chrome,
  titlebar, controls, taskbar, launcher, radii) that makes a skin a pure
  drop-in — swapping `data-theme` re-skins the whole app with no JS changes
- 10 ready-made themes in `assets/skeleton/themes/`, refined from the design
  canvas exploration into working token sets: `windows-95` (the reference
  skin, matches MindKeep's real chrome), `neumorphism`, `glassmorphism`,
  `macos-modern`, `windows-11-fluent`, `material-3`, `neubrutalism`,
  `cyberpunk`, `minimal-flat`, `aero-glass`
- A "Ready-Made Skeleton + Themes" section in SKILL.md explaining how to
  scaffold a new app from the skeleton and how to author a new theme
- A mobile touch-target override (window controls forced to ≥44px under
  760px regardless of theme) applied uniformly in skeleton.css, per
  mobile-ux-optimizer's guidance — themes stay free to size controls for
  desktop precision pointing without compromising mobile usability

### Design Decisions
- Themes are CSS custom-property sets, not markup variants — the two
  exceptions (macOS's traffic-light controls, Windows 11's centered
  floating dock) are handled as small theme-scoped structural overrides
  rather than forking the skeleton's HTML, keeping one shared DOM/JS for
  every skin
- Dropped the "cancelleria" (skeuomorphic paper) mockup from the theme set
  at the user's request; the other ten survived unchanged in character

## [1.0.0] - 2026-09-03

### Added
- Initial release: skin-agnostic behavior contract for a multi-window
  desktop app shell, extracted from MindKeep's production `wm.js`/`app.js`
- Window state machine (normal/minimized, maximized as a modifier)
- Focus/z-index rules, including click-anywhere-to-focus
- Drag/resize mechanics via pointer capture, with viewport clamping
- Geometry persistence (local-only, clamped on reapply)
- Cascade placement for newly opened windows
- The "Deliberate Split View" mobile pattern: single full-screen app by
  default, explicit two-up split via a per-window control + launcher pick,
  automatic collapse back to one on a third window
- Swipe-to-open-launcher gesture with concrete thresholds, always additive
  to a persistent button
- App switcher (taskbar) toggle rule and launcher (start-menu) pattern
- Progressive disclosure patterns: hide-until-summoned bars, expand-in-
  place cards
- Quick action panel (draggable, keyboard-navigable suggestions)
- Mobile technical baseline: `dvh` fallback, `prefers-reduced-motion`,
  safe-area insets
- Skin Compatibility Checklist for pairing with any visual skin
- Reference documentation:
  - `window-mechanics.md` — desktop window model, concrete numbers/code
  - `mobile-behavior.md` — Deliberate Split View + gesture thresholds
  - `patterns-library.md` — switcher, launcher, progressive disclosure,
    quick action panel

### Design Decisions
- Deliberately excludes all visual specifics (color, shape, motion style)
  — those live in a paired skin skill (`windows-95-web-designer`,
  `windows-3-1-web-designer`, or a custom skin from the `design` skill)
- Source of truth is a real, daily-used app rather than a theoretical
  spec — every rule traces back to working code
