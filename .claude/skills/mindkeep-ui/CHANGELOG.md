# Changelog

All notable changes to the mindkeep-ui skill.

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
