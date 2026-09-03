# Window Mechanics — Worked Example

Concrete numbers and technique, as implemented in MindKeep's `wm.js`
(a standalone module with zero knowledge of the app's views/data — it only
exposes `openWindow / closeWindow / focusWindow / minimizeWindow /
restoreWindow / getWindow`, consumed by the rest of the app). Reuse the
numbers as sane defaults; adjust to your app's actual window sizes.

## State Shape

```
{ id, el, titlebarEl, contentEl, taskbarBtn, state, rectBeforeMax }
state ∈ { 'normal', 'minimized' }
```

`maximized` is a CSS class, not part of `state` — a maximized window is
still `state: 'normal'`.

## Opening a Window

```
openWindow({ id, title, icon, resizable = true, defaultSize = { w: 760, h: 560 } })
```

- If `id` is already open: `restoreWindow(id); focusWindow(id); return` —
  never create a second instance of the same window id.
- Otherwise: clone a `<template>`, wire up its title/icon, remove the
  resize handles entirely if `resizable: false` (don't just disable them
  with CSS — remove the elements so there's nothing to accidentally grab).
- Desktop: apply saved/cascaded geometry, append to the window layer,
  attach drag + (if resizable) resize handlers.
- Mobile: skip geometry/drag/resize entirely, add the mobile full-screen
  class, and run the single-app-vs-split logic (see
  `mobile-behavior.md`).
- Always: build its switcher (taskbar) entry, then focus it.

## Cascade Placement

```js
cascadeIndex = (cascadeIndex + 1) % 8;
x = 40 + cascadeIndex * 26;
y = 36 + cascadeIndex * 24;
```

8 positions, then it wraps and starts overlapping again from the top —
fine, because by the time you've opened 8 windows without moving any of
them, some overlap is expected and the user has bigger problems than
window placement.

## Geometry Persistence and Clamping

Saved to `localStorage` **only** at the end of a drag or resize gesture
(`pointerup`), and **only** when the window isn't maximized — you don't
want to persist "100% × 100%" as the window's real size.

Reapplying saved geometry:

```js
w = clamp(savedWidth,  MIN_W, window.innerWidth)
h = clamp(savedHeight, MIN_H, window.innerHeight - switcherBarHeight())
left = clamp(savedLeft, -w + 80, window.innerWidth - 80)
top  = clamp(savedTop,  0, window.innerHeight - switcherBarHeight() - titlebarHeight)
```

`MIN_W = 280, MIN_H = 200`. The `-w + 80` / `innerWidth - 80` pair is what
guarantees at least an 80px sliver of the window stays reachable even if
it was last saved far off to one side on a wider screen. Measure the
switcher bar's real height at runtime (`el.offsetHeight`) rather than
hardcoding it — a skin can change it.

## Drag (Pointer Capture)

```js
titlebarEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.window-control-button')) return; // let control buttons work
  if (isMobile) return;
  focusWindow(id);
  titlebarEl.setPointerCapture(e.pointerId);
  const startX = e.clientX, startY = e.clientY;
  const startLeft = el.offsetLeft, startTop = el.offsetTop;

  const onMove = (e2) => {
    left = clamp(startLeft + (e2.clientX - startX), -el.offsetWidth + 80, innerWidth - 80);
    top  = clamp(startTop  + (e2.clientY - startY), 0, innerHeight - switcherBarHeight() - titlebarHeight);
    el.style.left = left + 'px'; el.style.top = top + 'px';
  };
  const onUp = () => {
    /* remove listeners */
    if (!el.classList.contains('maximized')) saveGeometry();
  };
  titlebarEl.addEventListener('pointermove', onMove);
  titlebarEl.addEventListener('pointerup', onUp);
  titlebarEl.addEventListener('pointercancel', onUp);
});
```

Key details easy to miss:
- Check for a click on a control button (close/minimize/etc.) *before*
  starting a drag, or the buttons become undraggable-through.
- Bail out entirely on mobile — don't attach these listeners at all on
  small viewports, checked live via a `matchMedia('(max-width: 760px)')`
  listener, not a one-time `window.innerWidth` read at load.
- Focus happens on `pointerdown`, before the drag even starts.

## Resize (Same Technique, Three Handles)

Three handles: east (width only), south (height only), south-east (both).
Compute `maxW = innerWidth - el.offsetLeft` and
`maxH = innerHeight - switcherBarHeight() - el.offsetTop` at drag-start so
the resize can't push the window past the viewport edge it's anchored to.
`stopPropagation()` on the handle's `pointerdown` so it doesn't also
trigger the whole-window focus-grab handler redundantly.

## Focus / Z-Index

```js
function focusWindow(id) {
  windows.forEach(w => { w.el.classList.remove('focused'); /* ...inactive titlebar state... */ });
  el.style.zIndex = String(++zCounter);
  el.classList.add('focused');
  /* ...active titlebar state, pressed switcher entry... */
}
```

Grabbed on `pointerdown` at the window-element level with
`{ capture: true }` — this is what makes clicking *anywhere* in the window
(not just the title bar) bring it forward, matching real desktop behavior.

## Maximize / Restore

```js
function toggleMaximize(win) {
  if (isMobile) return;
  if (el.classList.contains('maximized')) {
    el.classList.remove('maximized');
    Object.assign(el.style, win.rectBeforeMax); // exact snapshot restore
  } else {
    win.rectBeforeMax = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
    el.classList.add('maximized');
  }
}
```

Restore from the snapshot, don't recompute a "reasonable" size — the user
put it exactly where they wanted before maximizing.

## Minimize / Restore

```js
function minimizeWindow(id) { win.state = 'minimized'; /* hide via CSS class */ }
function restoreWindow(id)  { win.state = 'normal';    /* show again */ }
```

No DOM removal, no re-render on restore — everything (scroll position,
form input, in-progress state) is exactly as it was.

## Closing

```js
function closeWindow(id) {
  /* remove element + switcher entry, delete from the windows map */
  if (isMobile && normalWindowCount() <= 1) splitLayer.classList.remove('split-mode');
  let top = null;
  windows.forEach(w => {
    if (w.state !== 'normal') return; // never refocus a minimized window
    if (!top || w.el.style.zIndex > top.el.style.zIndex) top = w;
  });
  if (top) focusWindow(top.id);
}
```
