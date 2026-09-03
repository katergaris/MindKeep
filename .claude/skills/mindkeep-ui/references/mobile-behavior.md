# Mobile Behavior — Worked Example

## The Deliberate Split View, in Full

Three pieces of state drive this, on top of the normal window map:

- `isMobile` — from a live `matchMedia('(max-width: 760px)')` listener,
  never a one-time check (the shell must react to rotation and resizing)
- `splitMode` (boolean) — is the window layer currently rendering two
  windows side by side
- `splitPending` (boolean) — the user just tapped "split this window",
  the layer is waiting for their next pick from the launcher

**Opening a window on mobile** (`otherNormalIds` = other windows currently
`state: normal`):

```
if splitPending AND otherNormalIds.length === 1:
    → enter splitMode, clear splitPending
    (the just-opened window is the user's chosen second window)
elif splitMode AND otherNormalIds.length >= 2:
    → a third window arrived while split: minimize all of otherNormalIds,
      exit splitMode (the new window takes the full screen alone)
elif NOT splitMode:
    → minimize all of otherNormalIds (normal single-app behavior)
mark this window `.mobile-full`, append it
```

Note what's absent: there's no branch for "splitMode and otherNormalIds
has exactly 1" other than falling through — that's the steady-state two-up
case, and it needs no action beyond appending the window into the split
container.

**The split control** (a button in the window's own title bar, distinct
from minimize/maximize/close): visible only when
`isMobile && normalWindowCount() === 1 && !splitMode`. Tapping it sets
`splitPending = true`, hides itself, and dispatches an event asking the
shell to open the launcher — the split control doesn't pick the second
window itself, it hands off to the launcher so the user picks from the
full list of things they could open.

**Split layout**: the window layer switches to a column flex container;
each `.mobile-full` window becomes `flex: 1 1 50%` instead of absolutely
positioned full-screen. No drag, no resize inside a split pane — the
50/50 split is fixed.

**Switcher entry behavior differs slightly on mobile**: tapping a
different app's entry while *not* in split mode minimizes whichever
window is currently `normal` before restoring the tapped one — you're
never looking at two full-screen windows stacked in the DOM
simultaneously outside of split mode, even briefly.

## Swipe-to-Open-Launcher Gesture

Reasonable, tested thresholds:

```js
const TRIGGER_ZONE_PX = 70;      // touch must start within this many px of the bottom edge
const MIN_SWIPE_DISTANCE = 45;   // minimum upward travel, px
const MAX_SWIPE_DURATION = 600;  // ms — slower than this reads as a scroll, not a swipe
const MAX_HORIZONTAL_DRIFT = 60; // px — too much sideways drift disqualifies it

on touchstart:
  if not mobile viewport, or launcher already open: ignore
  if (viewportHeight - touch.clientY) > TRIGGER_ZONE_PX: ignore (didn't start near the bottom)
  record startY, startX, startTime

on touchend:
  dy = startY - touch.clientY   // positive = moved upward
  dx = abs(touch.clientX - startX)
  dt = now - startTime
  if dy > MIN_SWIPE_DISTANCE and dx < MAX_HORIZONTAL_DRIFT and dt < MAX_SWIPE_DURATION:
    openLauncher()
```

Both listeners `{ passive: true }` — this gesture never needs to block
scrolling elsewhere on the page. And critically: the launcher's own button
in the switcher bar keeps working exactly as before. This is a shortcut
layered on top, discovered by users who happen to try it, never a
required interaction.

## Mobile Technical Baseline, Concretely

```css
#app { height: 100vh; height: 100dvh; overflow: hidden; }

.switcher-bar {
  height: calc(var(--switcher-h) + env(safe-area-inset-bottom, 0px));
  padding: 0 6px calc(env(safe-area-inset-bottom, 0px));
}

@media (prefers-reduced-motion: reduce) {
  /* collapse window open/close/minimize transitions to near-instant */
}
```

`100dvh` after `100vh` (not instead of) — `100vh` is the fallback for
browsers that don't support `dvh`, `100dvh` overrides it where supported
and correctly accounts for a mobile browser's collapsing/expanding
address bar instead of leaving a gap or causing a jump on scroll.
