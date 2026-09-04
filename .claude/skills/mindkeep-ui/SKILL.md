---
name: mindkeep-ui
description: Skin-agnostic behavior contract AND a working, themeable skeleton for a multi-window desktop app shell — windows, taskbar, launcher, mobile split-view — extracted from MindKeep's production window manager. Ships assets/skeleton/ (index.html, skeleton.css, wm.js) plus 10 ready CSS themes (Win95, neumorphism, glassmorphism, macOS, Win11, Material 3, neubrutalism, cyberpunk, minimal flat, aero glass), swappable via a data-theme attribute, no JS changes. Use for a "gestionale"/management app, internal tool, admin dashboard, or any app with multiple resizable/draggable windows, a taskbar-style switcher, or a Start-menu-style launcher, desktop AND mobile. Activate on "multi-window", "window manager", "desktop shell", "taskbar", "start menu", "launcher", "gestionale", "draggable resizable windows", "split view on mobile", "theme switcher". NOT for single-panel apps, NOT for color/font picking outside this shell, NOT for generic responsive-grid advice.
allowed-tools: Read,Write,Edit,Glob,Grep
metadata:
  category: Design & Creative
  tags:
  - desktop-shell
  - window-manager
  - ux-behavior
  - gestionale
  - multi-window
  - mobile-ux
  pairs-with:
  - skill: windows-95-web-designer
    reason: Ready-made visual skin (gradients, bevels, Start menu chrome) that already satisfies this contract — MindKeep itself is built on this exact pairing
  - skill: windows-3-1-web-designer
    reason: Alternate flatter retro skin compatible with the same window/taskbar/launcher behavior contract
  - skill: design
    reason: Use its multi-artboard canvas to explore new visual skins (modern, non-retro) for this same behavior contract before committing to one
---

# MindKeep UI — Multi-Window Desktop Shell (Behavior Contract)

This skill is **not an aesthetic**. It captures how MindKeep's window manager
*behaves* — proven in a real, daily-used "gestionale" app — deliberately
separated from how it *looks*. Windows 95 is one skin that satisfies this
contract; it is not the contract itself. Use this skill to build or reason
about the interaction model, then pick or design a skin separately.

**Why separate them:** a management app lives or dies on whether people can
keep several things open and glance between them without losing state. That
behavior is hard to get right and easy to copy once specified precisely.
The visual dressing is comparatively cheap to swap — and you'll likely want
to, over the life of a product. Coupling the two forces a redesign every
time you touch either.

## When to Use

**Use for:**
- Any app organized around multiple overlapping/floating panels the user
  opens, moves, resizes, and switches between (dossiers, records, tools)
- Admin panels, internal tools, "gestionali" — anything closer to an
  operating system than a marketing site
- Apps that need a coherent mobile story for a desktop-shaped interaction
  model, not just a squeezed-down layout
- A taskbar-like switcher, a Start-menu-like launcher, or a floating
  always-available quick-action panel

**Do NOT use for:**
- Single-view apps, content sites, or anything with no concept of "multiple
  things open at once" — there's no window model to contract here
- Choosing a visual style → pick a skin skill (`windows-95-web-designer`,
  `windows-3-1-web-designer`) or design one with the `design` skill instead
- Generic responsive breakpoints for a normal scrolling page — this is
  specifically about windows, focus, and an app switcher

---

## The Split: Behavior vs. Skin

| This skill owns | A skin skill owns |
|---|---|
| Window states, focus/z-index rules | Colors, gradients, bevels |
| Drag/resize mechanics and limits | Border/corner treatment, shadows |
| What happens when you minimize/close | Fonts, iconography |
| The mobile single-app + split-view model | Animation style, motion easing |
| Where a new window appears (cascade) | Title bar / taskbar / launcher chrome |

A skin is compatible with this contract if it can render every state this
document defines (see the **Skin Compatibility Checklist** at the end).
Nothing here should ever leak a hex code, a font name, or a border-radius.

---

## 1. Window State Machine

Every window is one of exactly two `state` values plus one independent
CSS-level flag:

- **`normal`** — visible, participates in focus/z-index, draggable/resizable
- **`minimized`** — hidden but alive; all content/scroll-position/form state
  persists in memory, nothing is torn down
- **`maximized`** — a modifier on `normal`, not a third state: a maximized
  window still has `state: normal`, it just fills the viewport and
  remembers its pre-maximize rect (`rectBeforeMax`) to restore exactly,
  not recompute, on un-maximize

Windows are **singletons by identity**: opening a window whose id is already
open must restore + focus the existing instance, never spawn a duplicate.
This is what lets a launcher item or a taskbar icon behave predictably no
matter how many times it's activated.

Closing a window destroys it (state + DOM gone); minimizing never does.
Don't blur this line — a common bug is treating minimize as a cheap close.

## 2. Focus and Z-Index

- Exactly **one** window is focused at any time. There is no "no window
  focused" state once at least one window is open.
- A pointer-down **anywhere inside a window** (not just its title bar)
  brings it to focus and to the front. Restricting focus-grab to the title
  bar alone feels broken to anyone who has used a real desktop.
- Maintain a single monotonically-increasing z-index counter; focusing a
  window sets its z-index to `++counter`. Don't reshuffle every window's
  z-index on every focus change — only touch the one being focused.
- The focused window's chrome must be visually distinguishable from all
  others (this skill doesn't say how — that's the skin's job — only that a
  "focused vs. not" visual state must exist and be driven by this rule).
- When a window closes, refocus the **remaining `normal`-state window with
  the highest z-index** — never a minimized one. Focusing a hidden window
  leaves its taskbar/switcher entry looking "active" while nothing is
  visible, which reads as a bug even though technically nothing crashed.

## 3. Drag and Resize

Implement with pointer capture, not a drag-and-drop library — it's a
handful of lines and avoids a dependency for something this contained:

1. `pointerdown` on the drag handle (title bar) → `setPointerCapture`,
   record the starting pointer position and the window's starting rect
2. `pointermove` → compute delta from the start, clamp, apply directly to
   `left/top` (or `width/height` for resize handles)
3. `pointerup`/`pointercancel` → release, persist the final geometry

**Clamp, always:**
- Minimum size (e.g. 280×200) so a window can never be resized into
  uselessness
- Keep at least a meaningful strip of the window (e.g. ~80px) inside the
  viewport horizontally even when dragged toward an edge — never let a
  window become fully unreachable off-screen
- Never let a window's top go above the viewport or its bottom go under
  the taskbar/switcher bar — measure that bar's real height at drag time,
  don't hardcode it, since a skin may change it
- Resize the same way: clamp against both the minimum size and the space
  actually available between the window's position and the viewport edge

**Disable drag/resize entirely on mobile.** Don't try to make free-form
window dragging work on touch at small viewports — section 6 covers what
mobile does instead. Gate all of the above behind a viewport check (a
`matchMedia` listener that reacts live to viewport changes, not a one-time
check at load) so rotating a device or resizing a browser window
transitions cleanly between the two models.

## 4. Geometry Persistence

Treat window position/size as a **local device preference**, not
application data: store it client-side only (e.g. `localStorage`), save it
when a drag or resize ends (never mid-drag, and never while maximized —
you'd be persisting the maximized rect instead of the real one), and when
reapplying saved geometry on a later visit, **clamp it against the current
viewport** rather than trusting the stored numbers blindly — the window
may have been saved on a much larger screen.

This is deliberately not synced or backed up: it's convenience, not data
the user would ever expect to survive an "export my data."

## 5. Placement of New Windows — Cascade

A newly opened window must never land exactly on top of an existing one.
Cycle through a small set of offset positions (e.g. 6–8 steps of roughly
20–30px in both axes, wrapping back to the start) so repeatedly opening
windows fans them out visibly instead of stacking invisibly. Only cascade
when there's no saved geometry for that window id — a returning window
should reopen where the user last put it, not where the cascade counter
happens to be.

## 6. Mobile: Deliberate Split View

This is the pattern most worth stealing wholesale. A generic "shrink the
desktop metaphor to fit a phone" approach (icon grid + one modal window)
throws away the multi-window value proposition entirely. MindKeep's answer
keeps it, on the user's terms:

**Default: one window fills the screen.** Opening any window on mobile
minimizes every other `normal` window automatically (never closes them —
they keep their state). Switching apps means tapping the app switcher,
which minimizes the currently-visible window and restores the tapped one.
This is instant and loses nothing, because minimized ≠ destroyed.

**Two windows side-by-side is opt-in, never automatic.** Give each window
a control (visible *only* when exactly one `normal` window is open and the
device isn't already split) that opens the launcher so the user can
actively choose a second window to bring in. Only once that second window
opens does the layout switch to a split (e.g. two panes stacked vertically,
each roughly half the screen, no dragging/resizing inside the split).

**A third window collapses the split back to one.** If a third window
opens while already split, minimize both of the split windows (not close)
and let the new one take the full screen. Don't try to support three-up on
a phone — it's not worth the complexity or the tap targets it would need.

Implementing this needs three pieces of state beyond the desktop model: how
many `normal` windows exist, whether the layer is currently in split mode,
and a "user just asked to split, waiting on their next pick" flag set by
the split control and cleared once the second window opens (or abandoned
if the user backs out without picking one).

## 7. The App Switcher (Taskbar Equivalent)

One entry per open window (any state), in the order windows were opened.
Overflow should scroll horizontally rather than wrap to a second row —
a switcher bar has a fixed height in most skins.

**The toggle rule**, easy to get backwards: tapping the entry for the
**currently focused, `normal`** window minimizes it. Tapping the entry for
any **other** window (unfocused, or already minimized) restores it and
focuses it. This single rule is what makes the switcher double as a
minimize button without a separate control.

## 8. The Launcher (Start-Menu Equivalent)

A floating panel, not a bar embedded in the switcher — it should visually
sit *above* the desktop/canvas, opened by a persistent, always-reachable
control (never a gesture-only affordance — see §9). Close it on an outside
click/tap (a document-level listener that checks whether the click target
is inside the panel or its trigger button; don't rely on blur, it breaks
on touch).

Build its contents from the app's own list of sections/routes rather than
hardcoding entries — a launcher that has to be manually kept in sync with
navigation is a launcher that will drift out of sync.

## 9. Gestures Are Additive, Never Exclusive

If you add a swipe gesture to open the launcher on mobile (e.g. swipe up
from near the bottom edge), it must be a shortcut layered on top of an
always-visible, always-tappable button — never the only way in. Reasonable
thresholds: trigger zone within the last ~60–80px of the viewport height,
minimum vertical travel ~40–50px, horizontal drift under ~60px (otherwise
it's a scroll, not a swipe), and a max duration around 500–600ms (a slow
drag isn't a gesture). Tune per app, but keep all four checks — any one
missing makes the gesture either too twitchy or too unreliable.

## 10. Progressive Disclosure for Chrome That Isn't Always Needed

Not everything belongs permanently on screen. Two patterns worth reusing:

- **Hide-until-summoned bars**: a search bar (or similar utility strip)
  can stay collapsed/hidden and only render when its trigger (an icon in
  the switcher, say) is tapped — one bar, no separate mobile variant,
  toggled by a single class/state flag.
- **Expand-in-place cards**: small pieces of content (notes, reminders)
  that would otherwise require opening a full window to read can instead
  expand on tap into a larger version of *themselves*, in place, and
  collapse on the next tap anywhere else. This avoids the overhead of a
  full window for something meant to be glanced at, on both desktop and
  mobile — don't build a separate "quick view modal" component for this,
  the same expand/collapse behavior serves both.

## 11. Always-Available Quick Action Panel

A small floating, draggable panel (same pointer-capture technique as §3,
but moving the panel itself, not a managed window) reachable from a fixed
control regardless of what else is open. If it supports typed shortcuts
(slash-style commands, `@`-references, etc.), give it a lightweight
suggestion list navigable with `ArrowUp`/`ArrowDown` + `Enter`/`Tab` — don't
require a mouse for something meant to be the fast path.

## 12. Mobile Technical Baseline

Non-negotiable regardless of skin:

- Use `100dvh` for full-height containers with a `100vh` fallback, so
  mobile browser chrome (address bar show/hide) doesn't cause layout jumps
- Respect `prefers-reduced-motion: reduce` — window open/close/minimize
  transitions and any decorative animation should degrade to instant or
  near-instant for users who've asked for it
- Account for safe-area insets (`env(safe-area-inset-bottom)` etc.) on the
  switcher bar and any other edge-anchored chrome, for notched devices

---

## Skin Compatibility Checklist

Before treating a visual skin as compatible with this contract, confirm it
provides:

- [ ] A visually distinct **focused vs. unfocused** window chrome state
- [ ] A **window container** that can render at arbitrary width/height
      within the clamps in §3, including a maximized (100%/100%) state
- [ ] A **switcher element** (taskbar-equivalent) that can show N entries,
      an active/pressed state, and horizontal overflow
- [ ] A **launcher element** (start-menu-equivalent) that can float above
      the canvas and list an arbitrary number of sections
- [ ] A **mobile full-screen window treatment** distinct from its desktop
      floating treatment (no drag/resize affordances shown on mobile)
- [ ] Support for a **split-mode** layout (two window containers stacked
      or side-by-side) that doesn't depend on desktop-only chrome
- [ ] Minimize/close controls that read clearly as *different* actions —
      a skin that makes them visually interchangeable will produce support
      tickets

None of this dictates color, shape, or motion style — only that the states
this contract defines have *some* visual representation.

---

## Ready-Made Skeleton + Themes

The checklist above isn't just a spec to satisfy by hand — `assets/skeleton/`
is a working implementation of it, built to the point where the skin is a
drop-in: every visual value is a `--mk-*` CSS custom property, so swapping
`data-theme` on `<html>` re-skins the whole app live, with zero JS changes.

```
assets/skeleton/
├── index.html        demo shell: desktop, taskbar, launcher, theme switcher,
│                      two demo windows (Dossiers, Nota) — replace these
├── skeleton.css       the structural CSS from §1–11, entirely token-driven;
│                      never edit this to change how something *looks*
├── wm.js              the window manager itself — openWindow/closeWindow/
│                      focusWindow/minimizeWindow/restoreWindow, drag/resize,
│                      the launcher, and Deliberate Split View, implemented
└── themes/            one CSS file per skin, each just a --mk-* token set
    ├── windows-95.css        + a handful of theme-scoped structural tweaks
    ├── neumorphism.css       where a skin needs more than tokens (macOS's
    ├── glassmorphism.css     traffic-light controls, Windows 11's floating
    ├── macos-modern.css      centered dock) — see the comment at the top
    ├── windows-11-fluent.css of each theme file for its specific overrides.
    ├── material-3.css
    ├── neubrutalism.css
    ├── cyberpunk.css
    ├── minimal-flat.css
    └── aero-glass.css
```

**To scaffold a new app**: copy `assets/skeleton/` into the new project,
replace the two demo windows in `index.html` with real ones (call
`MkWM.openWindow({ id, title, icon, html, defaultSize })` with your own
content — `wm.js` never needs to know what's inside), delete the theme
files you don't want, and keep (or strip) the `<select id="mk-theme-select">`
switcher depending on whether the app should let users pick a theme at
runtime or just ship with one baked in via `data-theme` on `<html>`.

**To design a new theme**: write a new `themes/<name>.css` file scoped
under `:root[data-theme="<name>"]`, define every token skeleton.css
declares a default for (see its own `:root` block for the full list —
colors, window chrome, titlebar, controls, taskbar, launcher, radii, tags),
and add it to `index.html`'s theme `<link>` list and `<select>` options.
Every mockup style explored in the design canvas earlier in this project
maps directly to one of these token sets — that's deliberate: the canvas
was the sketch, this is the implementation.

Touch targets for window controls are enforced at ≥44px in a mobile media
query inside skeleton.css regardless of what a theme's desktop sizing is
(minimize/maximize/close/split all stay tappable on mobile even though
drag/resize don't apply there) — don't fight this override per-theme.

---

## References

- `references/window-mechanics.md` — full detail + concrete numbers for
  the desktop window model (§1–5): state machine, focus/z-index, drag/
  resize clamps, geometry persistence, cascade
- `references/mobile-behavior.md` — full detail on the Deliberate Split
  View model (§6), gesture thresholds (§9), and the mobile technical
  baseline (§12)
- `references/patterns-library.md` — the app switcher and launcher (§7–8),
  progressive disclosure (§10), and the quick action panel (§11)
- `assets/skeleton/` — the working, themeable implementation of this whole
  contract (see "Ready-Made Skeleton + Themes" above)

Read the relevant reference file when implementing that piece precisely —
this document is the contract summary, the references carry the worked
example (MindKeep's actual implementation) each rule was extracted from.

## Pairs With

- **windows-95-web-designer** — drop-in compatible skin; this is the skin
  MindKeep itself uses today
- **windows-3-1-web-designer** — alternate flatter retro skin, same
  compatibility rules apply
- **design** — use its multi-artboard canvas to explore new, non-retro
  skins against this same behavior contract before picking one
