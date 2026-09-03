# Supporting Patterns — Worked Examples

## App Switcher (Taskbar Equivalent)

One button per open window, built when the window opens and removed when
it closes — not re-rendered from scratch on every state change. Each
button carries an icon + label (label truncated with ellipsis, never
wrapped) and a "pressed" visual state.

**The toggle click handler**, the one rule worth memorizing:

```js
button.addEventListener('click', () => {
  if (win.state === 'normal' && isFocused(win.id)) {
    minimizeWindow(win.id);
  } else {
    // On mobile outside split mode, activating a different app minimizes
    // whichever one is currently visible first, so you're never rendering
    // two full-screen windows at once outside of an explicit split.
    if (isMobile && !inSplitMode) {
      otherNormalWindows.forEach(w => minimizeWindow(w.id));
    }
    restoreWindow(win.id);
    focusWindow(win.id);
  }
});
```

Container: flex row, `flex: 1` to fill available space between the
launcher trigger and any trailing status area, horizontal scroll with the
scrollbar hidden (`scrollbar-width: none` + the WebKit pseudo-element) so
many open windows degrade to a swipeable strip instead of wrapping.

## Launcher (Start-Menu Equivalent)

- `position: fixed`, rendered above the canvas — not inline in the
  switcher bar, so it can be taller than the bar and float over content.
- Built from the app's own section/route list at panel-construction time,
  not hand-maintained — iterate the same array the app's router already
  uses so the two can never drift apart.
- Close on outside interaction via a single `document`-level click
  listener: `if (launcher.contains(target) || trigger.contains(target)) return;`
  then close. This is what makes it work identically for mouse and touch,
  where `blur`/`focusout` are unreliable.
- The trigger control also needs a `mindkeep:request-*`-style custom event
  it listens for, so the mobile split control (§6 in the main contract)
  can open it programmatically without the two modules needing to import
  each other directly.

## Progressive Disclosure

**Hidden-until-summoned bar** (e.g. search): `display: none` by default, a
single class toggled by its trigger button flips it to visible. One
implementation, no separate mobile variant — the same collapse/expand
logic and the same markup serve both.

**Expand-in-place cards** (e.g. sticky-note-style previews of small
records): tapping swaps the card's compact content for an expanded
version *in the same element* — title, body, progress/metadata, tags —
rather than opening a modal or a full window. A second tap, or a tap
anywhere else on the page (global listener, checking
`!card.contains(target)`), collapses it back to the compact form.
Only one card should be expanded at a time — expanding a second one should
collapse whichever was already open first.

## Quick Action Panel (Command-Palette-Lite)

- A small floating panel, made draggable by its own drag handle using the
  *same* pointer-capture technique as window dragging — but moving the
  panel's own position state, entirely separate from the window manager
  (it isn't a managed window, it shouldn't appear in the switcher).
- Reachable via one fixed, always-visible trigger control regardless of
  what windows are currently open.
- If it supports typed trigger tokens (e.g. `/note`, `/doc`, `@project`),
  render a small suggestion list under the input as the user types, and
  support pure-keyboard selection:

```js
if (e.key === 'ArrowDown') { activeIndex = (activeIndex + 1) % items.length; }
else if (e.key === 'ArrowUp') { activeIndex = (activeIndex - 1 + items.length) % items.length; }
else if (e.key === 'Enter' || e.key === 'Tab') { selectItem(activeIndex); }
```

`stopPropagation()` on clicks inside this panel's own action buttons if it
lives near other global "click outside to close" listeners (the launcher's,
for instance) — otherwise a single click can trigger two unrelated
close/open handlers in the same event cycle.
