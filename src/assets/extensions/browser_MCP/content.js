(() => {
  // src/content/fx.ts
  var FX = "__hs_mouse_fx__";
  var HAND_HOTSPOT = { x: 1, y: 1 };
  var HAND_SIZE = 32;
  var HAND_URL = () => chrome.runtime.getURL("cursors/hand.png");
  function handImg(className, ghost = false) {
    const opacity = ghost ? "opacity:.22;" : "";
    return `<img class="${className}" src="${HAND_URL()}" width="${HAND_SIZE}" height="${HAND_SIZE}" alt="" draggable="false" style="${opacity}"/>`;
  }
  var fxEnabled = true;
  var fxCursor = null;
  var fxTrail = null;
  var fxX = 0;
  var fxY = 0;
  var fxHideTimer = null;
  var moveAnim = null;
  var screenshotOverlay = null;
  var screenshotFlash = null;
  var overflowLockDepth = 0;
  var savedOverflow = { html: "", body: "" };
  var fxSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var isFxEnabled = () => fxEnabled && !document.hidden;
  try {
    chrome.storage?.local?.get("mouseFx").then((r) => {
      if (r && typeof r.mouseFx === "boolean")
        fxEnabled = r.mouseFx;
    }).catch(() => {
    });
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes.mouseFx)
        fxEnabled = changes.mouseFx.newValue !== false;
    });
  } catch {
  }
  function fxEnsureStyles() {
    let style = document.getElementById(FX + "_style");
    if (!style) {
      style = document.createElement("style");
      style.id = FX + "_style";
      document.documentElement.appendChild(style);
    }
    style.textContent = `
    .${FX}-cur,.${FX}-trail,.${FX}-ring,.${FX}-spark,.${FX}-trail-line,.${FX}-scroll-hint,
    .${FX}-shot-frame,.${FX}-shot-flash,.${FX}-shot-scan,.${FX}-hover-glow{position:fixed;left:0;top:0;pointer-events:none;}
    .${FX}-cur{z-index:2147483647;opacity:0;will-change:transform;}
    .${FX}-cur.show{opacity:1;}
    .${FX}-cur.noanim{transition:none!important;}
    .${FX}-cur-in{
      display:block;transform:translate(-${HAND_HOTSPOT.x}px,-${HAND_HOTSPOT.y}px) scale(1);
      transform-origin:0 0;transition:transform .12s cubic-bezier(.34,1.4,.64,1);}
    .${FX}-cur-in.pulse{animation:${FX}-press .28s cubic-bezier(.34,1.4,.64,1);}
    .${FX}-cur-in.hold{transform:translate(-${HAND_HOTSPOT.x}px,-${HAND_HOTSPOT.y}px) scale(.84);}
    @keyframes ${FX}-press{
      0%{transform:translate(-${HAND_HOTSPOT.x}px,-${HAND_HOTSPOT.y}px) scale(1);}
      38%{transform:translate(-${HAND_HOTSPOT.x}px,-${HAND_HOTSPOT.y}px) scale(.76);}
      62%{transform:translate(-${HAND_HOTSPOT.x}px,-${HAND_HOTSPOT.y}px) scale(.76);}
      100%{transform:translate(-${HAND_HOTSPOT.x}px,-${HAND_HOTSPOT.y}px) scale(1);}}
    .${FX}-cur-pointer,.${FX}-trail-pointer{
      display:block;width:${HAND_SIZE}px;height:${HAND_SIZE}px;user-select:none;-webkit-user-drag:none;
      background:transparent;}
    .${FX}-cur-in{background:transparent;}
    .${FX}-cur-pointer{filter:drop-shadow(0 1px 2px rgba(15,23,42,.28));}
    .${FX}-trail{z-index:2147483646;opacity:0;will-change:transform;}
    .${FX}-trail.show{opacity:1;}
    .${FX}-trail-in{display:block;transform:translate(-${HAND_HOTSPOT.x}px,-${HAND_HOTSPOT.y}px);filter:blur(.4px);}
    .${FX}-ring,.${FX}-spark{z-index:2147483645;}
    .${FX}-ring{
      width:12px;height:12px;border-radius:50%;
      border:2px solid rgba(129,140,248,.85);
      transform:translate(-50%,-50%) scale(.35);
      opacity:.95;animation:${FX}-ring .72s cubic-bezier(.22,1,.36,1) forwards;}
    .${FX}-ring.alt{border-color:rgba(251,191,36,.9);box-shadow:0 0 10px rgba(251,191,36,.35);}
    @keyframes ${FX}-ring{70%{opacity:.45;}100%{transform:translate(-50%,-50%) scale(3.8);opacity:0;}}
    .${FX}-spark{
      width:5px;height:5px;border-radius:50%;
      background:rgba(165,180,252,.9);
      transform:translate(-50%,-50%) scale(1);
      animation:${FX}-spark .55s ease-out forwards;}
    @keyframes ${FX}-spark{100%{transform:translate(-50%,-50%) scale(2.4);opacity:0;}}
    .${FX}-trail-line{
      height:2px;border-radius:2px;transform-origin:0 50%;opacity:0;z-index:2147483645;
      background:linear-gradient(90deg,rgba(99,102,241,0),rgba(129,140,248,.75),rgba(99,102,241,0));
      animation:${FX}-trail-line .75s ease-out forwards;}
    @keyframes ${FX}-trail-line{0%{opacity:.75;}100%{opacity:0;}}
    .${FX}-scroll-hint{
      width:3px;border-radius:3px;transform:translateX(-50%);opacity:0;z-index:2147483645;
      background:linear-gradient(180deg,rgba(99,102,241,0),rgba(129,140,248,.7),rgba(99,102,241,0));
      animation:${FX}-scroll-hint .62s ease-out forwards;}
    @keyframes ${FX}-scroll-hint{0%{opacity:.7;}100%{opacity:0;}}
    .${FX}-shot-wrap{position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483644;pointer-events:none;overflow:hidden;}
    .${FX}-shot-dim{position:fixed;background:rgba(2,6,23,.54);}
    .${FX}-shot-frame{z-index:1;box-sizing:border-box;border:2px solid rgba(56,189,248,.95);
      border-radius:6px;box-shadow:inset 0 0 28px rgba(56,189,248,.2);
      animation:${FX}-shot-frame .5s ease-out;}
    .${FX}-shot-frame::before,.${FX}-shot-frame::after{
      content:'';position:absolute;width:14px;height:14px;border:2px solid rgba(56,189,248,.95);}
    .${FX}-shot-frame::before{left:-2px;top:-2px;border-right:none;border-bottom:none;border-radius:4px 0 0 0;}
    .${FX}-shot-frame::after{right:-2px;bottom:-2px;border-left:none;border-top:none;border-radius:0 0 4px 0;}
    @keyframes ${FX}-shot-frame{from{opacity:0;transform:scale(.985);}to{opacity:1;transform:scale(1);}}
    .${FX}-shot-badge{
      position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2;
      padding:5px 14px;border-radius:999px;font:600 11px/1.4 system-ui,sans-serif;
      color:#e0f2fe;background:rgba(14,116,144,.88);border:1px solid rgba(56,189,248,.6);
      box-shadow:0 4px 18px rgba(2,6,23,.4);letter-spacing:.3px;
      animation:${FX}-shot-badge .45s ease-out;}
    @keyframes ${FX}-shot-badge{from{opacity:0;transform:translateX(-50%) translateY(-6px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}
    .${FX}-shot-scan{
      position:absolute;height:2px;width:100%;left:0;top:0;z-index:2;
      background:linear-gradient(90deg,transparent,rgba(56,189,248,.95),transparent);
      box-shadow:0 0 14px rgba(56,189,248,.65);
      animation:${FX}-shot-scan 1.1s ease-in-out infinite;}
    @keyframes ${FX}-shot-scan{0%{top:0;opacity:.25;}50%{opacity:1;}100%{top:calc(100% - 2px);opacity:.25;}}
    .${FX}-shot-flash{
      inset:0;width:100vw;height:100vh;z-index:2147483645;
      background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.95) 0%,rgba(255,255,255,.55) 38%,rgba(186,230,253,.2) 100%);
      opacity:0;animation:${FX}-shot-flash .9s ease-out forwards;}
    .${FX}-shot-ring{
      position:fixed;inset:12px;border:3px solid rgba(56,189,248,.9);border-radius:10px;z-index:2147483644;
      opacity:0;animation:${FX}-shot-ring .9s ease-out forwards;}
    @keyframes ${FX}-shot-flash{0%{opacity:0;}14%{opacity:.9;}100%{opacity:0;}}
    @keyframes ${FX}-shot-ring{0%{opacity:0;transform:scale(1.03);}18%{opacity:1;}100%{opacity:0;transform:scale(1);}}
    .${FX}-hover-glow{z-index:2147483644;border-radius:6px;
      box-shadow:0 0 0 2px rgba(129,140,248,.55),0 0 20px rgba(99,102,241,.35);
      animation:${FX}-hover-glow .35s ease-out;}
    @keyframes ${FX}-hover-glow{from{opacity:0;transform:scale(.98);}to{opacity:1;transform:scale(1);}}`;
  }
  function fxEnsure() {
    if (!isFxEnabled() || !document.body)
      return null;
    fxEnsureStyles();
    if (fxCursor && document.documentElement.contains(fxCursor))
      return fxCursor;
    const cur = document.createElement("div");
    cur.className = `${FX}-cur noanim`;
    cur.innerHTML = `<span class="${FX}-cur-in">${handImg(`${FX}-cur-pointer`)}</span>`;
    document.body.appendChild(cur);
    fxCursor = cur;
    if (!fxTrail || !document.documentElement.contains(fxTrail)) {
      const trail = document.createElement("div");
      trail.className = `${FX}-trail`;
      trail.innerHTML = `<span class="${FX}-trail-in">${handImg(`${FX}-trail-pointer`, true)}</span>`;
      document.body.appendChild(trail);
      fxTrail = trail;
    }
    if (!fxX && !fxY) {
      fxX = window.innerWidth / 2;
      fxY = window.innerHeight / 2;
    }
    fxPlace(fxX, fxY, false);
    if (fxTrail) {
      fxTrail.style.transform = `translate(${fxX}px, ${fxY}px)`;
      fxTrail.classList.remove("show");
    }
    return cur;
  }
  function fxPlace(x, y, animate) {
    const cur = fxCursor;
    if (!cur)
      return;
    fxX = x;
    fxY = y;
    cur.classList.toggle("noanim", !animate);
    cur.style.transform = `translate(${x}px, ${y}px)`;
  }
  function fxScheduleHide() {
    if (fxHideTimer)
      clearTimeout(fxHideTimer);
    fxHideTimer = setTimeout(() => {
      fxCursor?.classList.remove("show");
      fxTrail?.classList.remove("show");
    }, 1800);
  }
  function fxShowCursor() {
    fxCursor?.classList.add("show");
    fxTrail?.classList.add("show");
  }
  function fxSpawn(cls, x, y, life = 700, extra) {
    if (!document.body)
      return;
    const el = document.createElement("div");
    el.className = `${FX}-${cls}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    extra?.(el);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), life);
  }
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function fxCursorInner() {
    return fxCursor?.querySelector(`.${FX}-cur-in`);
  }
  async function fxPressPulse() {
    const inner = fxCursorInner();
    if (!inner)
      return;
    inner.classList.remove("hold");
    void inner.offsetWidth;
    inner.classList.add("pulse");
    await fxSleep(280);
    inner.classList.remove("pulse");
  }
  async function fxPressHold() {
    const inner = fxCursorInner();
    if (!inner)
      return;
    inner.classList.remove("pulse");
    inner.classList.add("hold");
    await fxSleep(90);
  }
  async function fxPressRelease() {
    const inner = fxCursorInner();
    if (!inner)
      return;
    inner.classList.remove("hold");
    await fxSleep(130);
  }
  function fxClickRipples(x, y, variant = "left") {
    const ringClass = variant === "right" ? "ring alt" : "ring";
    for (const d of [0, 55, 110])
      setTimeout(() => fxSpawn(ringClass, x, y, 760), d);
    for (let i = 0; i < 6; i++) {
      const ang = Math.PI * 2 * i / 6;
      const r = 10 + Math.random() * 6;
      setTimeout(() => fxSpawn("spark", x + Math.cos(ang) * r, y + Math.sin(ang) * r, 560), 20);
    }
  }
  async function fxMoveTo(x, y) {
    const cur = fxEnsure();
    if (!cur)
      return;
    fxShowCursor();
    const startX = fxX;
    const startY = fxY;
    const dx = x - startX;
    const dy = y - startY;
    const dist = Math.hypot(dx, dy);
    const duration = Math.min(Math.max(dist * 0.55, 180), 520);
    if (moveAnim)
      cancelAnimationFrame(moveAnim);
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done)
          return;
        done = true;
        if (moveAnim) {
          cancelAnimationFrame(moveAnim);
          moveAnim = null;
        }
        clearTimeout(backstop);
        fxPlace(x, y, false);
        resolve();
      };
      const backstop = setTimeout(finish, duration + 400);
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        const e = easeOutCubic(t);
        const cx = startX + dx * e;
        const cy = startY + dy * e;
        fxPlace(cx, cy, false);
        if (fxTrail) {
          const lag = 0.28;
          const tx = startX + dx * Math.max(0, e - lag);
          const ty = startY + dy * Math.max(0, e - lag);
          fxTrail.style.transform = `translate(${tx}px, ${ty}px)`;
        }
        if (t < 1)
          moveAnim = requestAnimationFrame(step);
        else
          finish();
      };
      moveAnim = requestAnimationFrame(step);
    });
  }
  async function fxClickAt(x, y, variant = "left") {
    if (!isFxEnabled())
      return;
    fxEnsure();
    fxShowCursor();
    fxPlace(x, y, false);
    const rippleVariant = variant === "right" ? "right" : "left";
    if (variant === "double") {
      await fxPressPulse();
      fxClickRipples(x, y, rippleVariant);
      await fxSleep(100);
      await fxPressPulse();
      fxClickRipples(x, y, rippleVariant);
    } else {
      await fxPressPulse();
      fxClickRipples(x, y, rippleVariant);
    }
    fxScheduleHide();
  }
  async function fxDragPath(sx, sy, ex, ey) {
    if (!isFxEnabled())
      return;
    fxEnsure();
    fxShowCursor();
    fxPlace(sx, sy, false);
    if (fxTrail)
      fxTrail.style.transform = `translate(${sx}px, ${sy}px)`;
    await fxPressHold();
    fxSpawn("ring", sx, sy, 640);
    const dx = ex - sx, dy = ey - sy;
    const dist = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    fxSpawn("trail-line", sx, sy, 780, (el) => {
      el.style.width = `${dist}px`;
      el.style.transform = `rotate(${ang}deg)`;
    });
    await fxMoveTo(ex, ey);
    fxSpawn("ring", ex, ey, 640);
    await fxPressRelease();
    fxScheduleHide();
  }
  async function fxToElement(el, at) {
    if (!isFxEnabled())
      return;
    const r = el.getBoundingClientRect();
    const cx = at ? at.x : r.left + r.width / 2;
    const cy = at ? at.y : r.top + r.height / 2;
    const x = Math.min(Math.max(cx, 4), window.innerWidth - 4);
    const y = Math.min(Math.max(cy, 4), window.innerHeight - 4);
    await fxMoveTo(x, y);
  }
  function fxHoverOn(el) {
    if (!isFxEnabled() || !document.body)
      return;
    fxEnsureStyles();
    const r = el.getBoundingClientRect();
    const glow = document.createElement("div");
    glow.className = `${FX}-hover-glow`;
    glow.style.left = `${r.left - 4}px`;
    glow.style.top = `${r.top - 4}px`;
    glow.style.width = `${r.width + 8}px`;
    glow.style.height = `${r.height + 8}px`;
    document.body.appendChild(glow);
    setTimeout(() => glow.remove(), 900);
  }
  async function fxScrollDrag(direction, amount) {
    if (!isFxEnabled())
      return;
    fxEnsure();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const len = Math.min(Math.max(amount || 0, 80), 220);
    let startY = cy, endY = cy;
    if (direction === "down") {
      startY = cy + len / 2;
      endY = cy - len / 2;
    } else if (direction === "up") {
      startY = cy - len / 2;
      endY = cy + len / 2;
    } else if (direction === "bottom") {
      startY = cy + 110;
      endY = cy - 110;
    } else if (direction === "top") {
      startY = cy - 110;
      endY = cy + 110;
    }
    fxShowCursor();
    fxPlace(cx, startY, false);
    if (fxTrail)
      fxTrail.style.transform = `translate(${cx}px, ${startY}px)`;
    await fxPressHold();
    fxSpawn("scroll-hint", cx, Math.min(startY, endY), 620, (el) => {
      el.style.height = `${Math.abs(endY - startY)}px`;
    });
    fxPlace(cx, endY, true);
    if (fxTrail)
      fxTrail.style.transform = `translate(${cx}px, ${endY}px)`;
    await fxSleep(280);
    await fxPressRelease();
    fxScheduleHide();
  }
  function fxOverlayRoot() {
    const id = FX + "_overlay";
    let root = document.getElementById(id);
    if (!root) {
      root = document.createElement("div");
      root.id = id;
      root.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483640;pointer-events:none;overflow:hidden;";
      document.documentElement.appendChild(root);
    }
    return root;
  }
  function lockViewportScroll() {
    if (overflowLockDepth++ > 0)
      return;
    savedOverflow.html = document.documentElement.style.overflow;
    savedOverflow.body = document.body?.style.overflow || "";
    document.documentElement.style.overflow = "hidden";
    if (document.body)
      document.body.style.overflow = "hidden";
  }
  function unlockViewportScroll() {
    if (overflowLockDepth === 0)
      return;
    if (--overflowLockDepth > 0)
      return;
    document.documentElement.style.overflow = savedOverflow.html;
    if (document.body)
      document.body.style.overflow = savedOverflow.body;
  }
  function clearScreenshotFx() {
    screenshotOverlay?.remove();
    screenshotOverlay = null;
    screenshotFlash?.remove();
    screenshotFlash = null;
    document.querySelectorAll(`.${FX}-shot-ring`).forEach((el) => el.remove());
    unlockViewportScroll();
  }
  function appendDimPanel(wrap, left, top, width, height) {
    if (width <= 0 || height <= 0)
      return;
    const dim = document.createElement("div");
    dim.className = `${FX}-shot-dim`;
    dim.style.left = `${left}px`;
    dim.style.top = `${top}px`;
    dim.style.width = `${width}px`;
    dim.style.height = `${height}px`;
    wrap.appendChild(dim);
  }
  function drawScreenshotFrame(rect) {
    clearScreenshotFx();
    lockViewportScroll();
    fxEnsureStyles();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const w = Math.max(0, rect.width);
    const h = Math.max(0, rect.height);
    const wrap = document.createElement("div");
    wrap.className = `${FX}-shot-wrap`;
    appendDimPanel(wrap, 0, 0, vw, y);
    appendDimPanel(wrap, 0, y, x, h);
    appendDimPanel(wrap, x + w, y, vw - x - w, h);
    appendDimPanel(wrap, 0, y + h, vw, vh - y - h);
    const frame = document.createElement("div");
    frame.className = `${FX}-shot-frame`;
    frame.style.left = `${x}px`;
    frame.style.top = `${y}px`;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    const scan = document.createElement("div");
    scan.className = `${FX}-shot-scan`;
    frame.appendChild(scan);
    wrap.appendChild(frame);
    const badge = document.createElement("div");
    badge.className = `${FX}-shot-badge`;
    badge.textContent = "\u622A\u56FE\u4E2D\u2026";
    wrap.appendChild(badge);
    fxOverlayRoot().appendChild(wrap);
    screenshotOverlay = wrap;
  }
  async function fxScreenshotBefore(rect) {
    if (!isFxEnabled())
      return;
    const frameRect = rect && rect.width > 0 && rect.height > 0 ? rect : { x: 10, y: 10, width: window.innerWidth - 20, height: window.innerHeight - 20 };
    drawScreenshotFrame(frameRect);
    await fxSleep(580);
    clearScreenshotFx();
  }
  async function fxScreenshotAfter() {
    if (!isFxEnabled())
      return;
    fxEnsureStyles();
    clearScreenshotFx();
    const root = fxOverlayRoot();
    const ring = document.createElement("div");
    ring.className = `${FX}-shot-ring`;
    const flash = document.createElement("div");
    flash.className = `${FX}-shot-flash`;
    root.appendChild(ring);
    root.appendChild(flash);
    screenshotFlash = flash;
    setTimeout(() => {
      ring.remove();
      flash.remove();
      if (screenshotFlash === flash)
        screenshotFlash = null;
    }, 950);
    await fxSleep(760);
  }
  function fxScreenshotClear() {
    clearScreenshotFx();
  }
  var getFxPos = () => ({ x: fxX, y: fxY });

  // src/content/iframe.ts
  function clampX(x, win) {
    return Math.min(Math.max(x, 1), win.innerWidth - 1);
  }
  function clampY(y, win) {
    return Math.min(Math.max(y, 1), win.innerHeight - 1);
  }
  function isElement(el) {
    return !!el && typeof el === "object" && el.nodeType === 1;
  }
  function isHTMLElement(el) {
    if (el instanceof HTMLElement)
      return true;
    if (!isElement(el))
      return false;
    const win = el.ownerDocument?.defaultView;
    return !!win && typeof win.HTMLElement === "function" && el instanceof win.HTMLElement;
  }
  function isFrameElement(el) {
    if (!isElement(el))
      return false;
    const tag = el.tagName;
    return tag === "IFRAME" || tag === "FRAME";
  }
  function isVisibleInOwnerViewport(el) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0)
      return false;
    const r = el.getBoundingClientRect();
    const win = el.ownerDocument?.defaultView || window;
    return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= win.innerHeight && r.left <= win.innerWidth;
  }
  function listIframeElementsIn(doc) {
    return Array.from(doc.querySelectorAll("iframe,frame")).filter((el) => isFrameElement(el) && isVisibleInOwnerViewport(el));
  }
  function tryFrameContext(frameEl) {
    try {
      const doc = frameEl.contentDocument;
      if (!doc?.documentElement)
        return null;
      return { frameEl, doc };
    } catch {
      return null;
    }
  }
  function scanRoot(doc) {
    return doc.body || doc.documentElement;
  }
  function buildFramePath(frame) {
    const path = [];
    let cur = frame;
    while (cur) {
      path.unshift(cur.frameSelector);
      cur = cur.parent;
    }
    return path;
  }
  function resolveFrameByPath(path) {
    if (!path.length)
      return null;
    let doc = document;
    let parent;
    let resolved = null;
    for (const frameSelector of path) {
      const frameEl = doc.querySelector(frameSelector);
      if (!isFrameElement(frameEl))
        return null;
      const base = tryFrameContext(frameEl);
      if (!base)
        return null;
      resolved = { ...base, frameSelector, parent };
      parent = resolved;
      doc = base.doc;
    }
    return resolved;
  }
  function visitAccessibleFrames(onFrame, attachSelector, doc = document, parent) {
    for (const frameEl of listIframeElementsIn(doc)) {
      const base = tryFrameContext(frameEl);
      if (!base)
        continue;
      const ctx = {
        ...base,
        frameSelector: attachSelector(frameEl),
        parent
      };
      onFrame(ctx);
      visitAccessibleFrames(onFrame, attachSelector, base.doc, ctx);
    }
  }
  function getAccessibleFrames(attachSelector) {
    const out = [];
    visitAccessibleFrames((ctx) => out.push(ctx), attachSelector);
    return out;
  }
  function toTopViewportPoint(localX, localY, frame) {
    let x = localX;
    let y = localY;
    let cur = frame;
    while (cur) {
      const fr = cur.frameEl.getBoundingClientRect();
      x += fr.left;
      y += fr.top;
      cur = cur.parent;
    }
    return { x: Math.round(x), y: Math.round(y) };
  }
  function toTopViewportRect(local, frame) {
    const topLeft = toTopViewportPoint(local.left, local.top, frame);
    return {
      x: topLeft.x,
      y: topLeft.y,
      w: Math.round(local.width),
      h: Math.round(local.height)
    };
  }
  function toTopViewportCenter(local, frame) {
    return toTopViewportPoint(local.left + local.width / 2, local.top + local.height / 2, frame);
  }
  function ownerWindow(el) {
    return el.ownerDocument?.defaultView || window;
  }
  function elementViewportRect(el, frame) {
    return toTopViewportRect(el.getBoundingClientRect(), frame);
  }
  function elementViewportCenter(el, frame) {
    return toTopViewportCenter(el.getBoundingClientRect(), frame);
  }
  function hitAtPoint(doc, win, x, y, topViewportX, topViewportY, frame) {
    const lx = clampX(x, win);
    const ly = clampY(y, win);
    let hit = doc.elementFromPoint(lx, ly);
    if (!hit)
      return null;
    while (hit.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(lx, ly);
      if (!inner || inner === hit)
        break;
      hit = inner;
    }
    if (hit.tagName === "IFRAME" || hit.tagName === "FRAME") {
      const frameEl = hit;
      const base = tryFrameContext(frameEl);
      const fr = frameEl.getBoundingClientRect();
      const childX = lx - fr.left;
      const childY = ly - fr.top;
      if (!base) {
        return { el: frameEl, frame, viewportX: topViewportX, viewportY: topViewportY, localX: lx, localY: ly };
      }
      const childWin = base.doc.defaultView || win;
      const childCtx = {
        ...base,
        frameSelector: "",
        parent: frame
      };
      const deeper = hitAtPoint(base.doc, childWin, childX, childY, topViewportX, topViewportY, childCtx);
      if (deeper)
        return deeper;
      return { el: frameEl, frame: childCtx, viewportX: topViewportX, viewportY: topViewportY, localX: childX, localY: childY };
    }
    return { el: hit, frame, viewportX: topViewportX, viewportY: topViewportY, localX: lx, localY: ly };
  }
  function hitTargetAtViewport(x, y) {
    const vx = clampX(x, window);
    const vy = clampY(y, window);
    return hitAtPoint(document, window, vx, vy, vx, vy);
  }
  function isTopmostAtViewport(el, viewportX, viewportY) {
    const hit = hitTargetAtViewport(viewportX, viewportY);
    if (!hit)
      return false;
    const target = hit.el;
    if (target === el)
      return true;
    const doc = el.ownerDocument;
    if (target.ownerDocument === doc) {
      return el.contains(target) || target.contains(el);
    }
    return false;
  }
  function isFrameChainVisible(frame) {
    let cur = frame;
    while (cur) {
      if (!isVisibleInOwnerViewport(cur.frameEl))
        return false;
      cur = cur.parent;
    }
    return true;
  }
  function isCenterOnMainViewport(frame, el) {
    const center = elementViewportCenter(el, frame);
    return center.x >= 0 && center.y >= 0 && center.x <= window.innerWidth && center.y <= window.innerHeight;
  }
  function isLikelyInteractableInFrame(el, frame) {
    if (!isVisibleInOwnerViewport(el))
      return false;
    if (!isFrameChainVisible(frame))
      return false;
    if (getComputedStyle(el).pointerEvents === "none")
      return false;
    if (!isCenterOnMainViewport(frame, el))
      return false;
    if (isHittableInViewport(el, frame))
      return true;
    const center = elementViewportCenter(el, frame);
    const hit = hitTargetAtViewport(center.x, center.y);
    if (!hit)
      return false;
    if (hit.el.ownerDocument === el.ownerDocument) {
      return hit.el === el || el.contains(hit.el) || hit.el.contains(el);
    }
    return true;
  }
  function isHittableInViewport(el, frame) {
    if (!isVisibleInOwnerViewport(el))
      return false;
    if (frame && !isFrameChainVisible(frame))
      return false;
    if (getComputedStyle(el).pointerEvents === "none")
      return false;
    const local = el.getBoundingClientRect();
    const sampleLocal = [
      [local.left + local.width / 2, local.top + local.height / 2],
      [local.left + local.width / 2, local.top + Math.min(local.height * 0.2, 6)],
      [local.left + local.width * 0.2, local.top + local.height / 2],
      [local.left + local.width * 0.8, local.top + local.height / 2]
    ];
    const pts = frame ? sampleLocal.map(([lx, ly]) => {
      const p = toTopViewportPoint(lx, ly, frame);
      return [p.x, p.y];
    }) : sampleLocal;
    return pts.some(([px, py]) => isTopmostAtViewport(el, px, py));
  }
  function occluderAtViewport(el, frame) {
    const center = elementViewportCenter(el, frame);
    const hit = hitTargetAtViewport(center.x, center.y);
    if (!hit)
      return null;
    const cover = hit.el;
    if (cover === el)
      return null;
    if (cover.ownerDocument === el.ownerDocument && (el.contains(cover) || cover.contains(el)))
      return null;
    return cover;
  }
  function resolveFrameBySelector(frameSelector, framePath) {
    const path = framePath?.length ? framePath : frameSelector ? [frameSelector] : [];
    return resolveFrameByPath(path);
  }

  // src/content/marks.ts
  var marks = [];
  function setMarks(items) {
    marks = items.slice();
  }
  function markAt(ref) {
    const i = Number(ref);
    if (!Number.isFinite(i) || i < 1 || i > marks.length)
      return null;
    return marks[i - 1] || null;
  }
  function getMarkTarget(ref) {
    return markAt(ref);
  }

  // src/content/dom.ts
  function isVisible(el) {
    if (!el || !isHTMLElement(el))
      return false;
    if (el.id?.startsWith(FX))
      return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0)
      return false;
    const r = el.getBoundingClientRect();
    const win = ownerWindow(el);
    return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= win.innerHeight && r.left <= win.innerWidth;
  }
  function isHittable(el, frame) {
    return isHittableInViewport(el, frame);
  }
  function occluderOf(el, frame) {
    return occluderAtViewport(el, frame);
  }
  function textOf(el, max = 200) {
    const h = el;
    const parts = [
      h.innerText,
      h.getAttribute("aria-label"),
      h.getAttribute("title"),
      h.value,
      h.placeholder,
      h.textContent
    ];
    return parts.map((v) => String(v || "").replace(/\s+/g, " ").trim()).find(Boolean)?.slice(0, max) || "";
  }
  function selectorResolvesTo(selector, el) {
    try {
      const hits = el.ownerDocument.querySelectorAll(selector);
      return hits.length === 1 && hits[0] === el;
    } catch {
      return false;
    }
  }
  function stableAttrSelector(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id;
    if (id && selectorResolvesTo(`#${CSS.escape(id)}`, el))
      return `#${CSS.escape(id)}`;
    for (const attr of ["data-testid", "data-test", "data-test-id", "data-qa", "data-cy", "name", "aria-label"]) {
      const v = el.getAttribute(attr);
      if (!v)
        continue;
      const sel = `${tag}[${attr}="${CSS.escape(v)}"]`;
      if (selectorResolvesTo(sel, el))
        return sel;
    }
    return "";
  }
  function cssPath(el) {
    if (!isElement(el))
      return "";
    const attrSel = stableAttrSelector(el);
    if (attrSel)
      return attrSel;
    const segment = (node) => {
      const tag = node.tagName.toLowerCase();
      const id = node.id;
      if (id)
        return `#${CSS.escape(id)}`;
      const cls = String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
      const parent = node.parentElement;
      const same = parent ? Array.from(parent.children).filter((c) => c.tagName === node.tagName) : [];
      const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : "";
      return `${tag}${cls}${nth}`;
    };
    const parts = [];
    let cur = el;
    const root = el.ownerDocument.documentElement;
    while (cur && cur !== root && parts.length < 12) {
      parts.unshift(segment(cur));
      const path = parts.join(" > ");
      if (selectorResolvesTo(path, el))
        return path;
      if (cur.id)
        break;
      cur = cur.parentElement;
    }
    return parts.length ? parts.join(" > ") : el.tagName.toLowerCase();
  }
  function zIndexOf(el) {
    const z = Number.parseInt(getComputedStyle(el).zIndex || "0", 10);
    return Number.isFinite(z) ? z : 0;
  }
  function elementArea(el) {
    const r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  }
  function clickableAncestor(el) {
    return el.closest('button,a,[role="button"],input[type="button"],input[type="submit"],[onclick],[tabindex]') || el;
  }
  function textMatches(el, text, exact = false) {
    const target = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!target)
      return false;
    const haystack = [
      el.innerText,
      el.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.value,
      el.getAttribute("placeholder")
    ].map((v) => String(v || "").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
    return haystack.some((v) => exact ? v === target : v === target || v.includes(target));
  }
  function findElInDocument(doc, selector, text, frame) {
    if (selector) {
      const matches = Array.from(doc.querySelectorAll(selector));
      return matches.find((el) => isHittable(el, frame)) || matches.find(isVisible) || matches[0] || null;
    }
    if (text) {
      const preferred = Array.from(doc.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title]'));
      const byPreferred = (pred, exact) => preferred.find((el) => pred(el) && textMatches(el, text, exact));
      const byWalk = (pred, exact) => {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
          const el = walker.currentNode;
          if (pred(el) && textMatches(el, text, exact))
            return clickableAncestor(el);
        }
        return null;
      };
      for (const pred of [isHittable, isVisible]) {
        const hit = byPreferred(pred, true) || byPreferred(pred, false) || byWalk(pred, true) || byWalk(pred, false);
        if (hit)
          return hit;
      }
    }
    return null;
  }
  function findElInAccessibleFrames(selector, text) {
    let hit = null;
    visitAccessibleFrames((ctx) => {
      if (hit)
        return;
      hit = findElInDocument(ctx.doc, selector, text, ctx);
    }, (el) => cssPath(el));
    return hit;
  }
  function findEl(selector, text, frameSelector, framePath) {
    const frame = resolveFrameBySelector(frameSelector, framePath);
    if (frame)
      return findElInDocument(frame.doc, selector, text, frame);
    const top = findElInDocument(document, selector, text);
    if (top)
      return top;
    return findElInAccessibleFrames(selector, text);
  }
  function elCenter(el) {
    const win = ownerWindow(el);
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(Math.max(r.left + r.width / 2, 1), win.innerWidth - 1),
      y: Math.min(Math.max(r.top + r.height / 2, 1), win.innerHeight - 1)
    };
  }
  function clickLikeUser(el, at) {
    const win = ownerWindow(el);
    const c = at || elCenter(el);
    try {
      el.focus?.();
    } catch {
    }
    const base = { bubbles: true, cancelable: true, view: win, clientX: c.x, clientY: c.y, button: 0 };
    const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerover", pointer));
    el.dispatchEvent(new PointerEvent("pointerenter", pointer));
    el.dispatchEvent(new MouseEvent("mouseover", base));
    el.dispatchEvent(new MouseEvent("mouseenter", base));
    el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", base));
    try {
      el.click?.();
    } catch {
    }
  }
  function resolveTarget(msg) {
    const byEl = (el, frame) => {
      const c = elCenter(el);
      return { el, x: c.x, y: c.y, frame };
    };
    const hasRef = msg.ref !== void 0 && msg.ref !== null && msg.ref !== "";
    if (hasRef) {
      const mark = getMarkTarget(msg.ref);
      if (mark) {
        const frame = resolveFrameBySelector(mark.frameSelector, mark.framePath);
        if (mark.el && mark.el.isConnected)
          return byEl(mark.el, frame || void 0);
        const healed = findEl(mark.selector, mark.text, mark.frameSelector, mark.framePath);
        if (healed)
          return byEl(healed, frame || void 0);
      }
    }
    if (msg.selector || msg.text) {
      const el = findEl(msg.selector, msg.text, msg.frame, msg.frame_path);
      if (el) {
        const frame = resolveFrameBySelector(msg.frame, msg.frame_path);
        return byEl(el, frame || void 0);
      }
    }
    if (msg.x !== void 0 && msg.y !== void 0) {
      const hit = hitTargetAtViewport(Number(msg.x), Number(msg.y));
      if (!hit)
        return { el: null, x: Number(msg.x), y: Number(msg.y) };
      return { el: hit.el, x: hit.localX, y: hit.localY, frame: hit.frame };
    }
    if (hasRef) {
      const mark = getMarkTarget(msg.ref);
      if (mark?.center) {
        const hit = hitTargetAtViewport(mark.center.x, mark.center.y);
        if (hit)
          return { el: hit.el, x: hit.localX, y: hit.localY, frame: hit.frame };
      }
    }
    return { el: null, x: 0, y: 0 };
  }

  // src/content/viewport.ts
  function viewportContext() {
    const doc = document.documentElement;
    const scrollY = Math.round(window.scrollY);
    const scrollX = Math.round(window.scrollX);
    const innerH = window.innerHeight;
    const innerW = window.innerWidth;
    const scrollHeight = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    const maxScroll = Math.max(0, scrollHeight - innerH);
    const scrollPercent = maxScroll > 0 ? Math.round(scrollY / maxScroll * 100) : 100;
    const atTop = scrollY <= 2;
    const atBottom = scrollY >= maxScroll - 2;
    const heads = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
    const visibleHeadings = [];
    let currentSection = "";
    for (const h of heads) {
      const r = h.getBoundingClientRect();
      const txt = (h.innerText || "").trim().slice(0, 120);
      if (!txt)
        continue;
      if (r.top <= 90)
        currentSection = txt;
      if (r.bottom > 0 && r.top < innerH && visibleHeadings.length < 10) {
        visibleHeadings.push({ tag: h.tagName, text: txt, top: Math.round(r.top) });
      }
    }
    return {
      url: location.href,
      title: document.title,
      scrollX,
      scrollY,
      innerWidth: innerW,
      innerHeight: innerH,
      scrollHeight,
      maxScroll,
      scrollPercent,
      atTop,
      atBottom,
      currentSection,
      visibleHeadings,
      counts: {
        links: document.querySelectorAll("a[href]").length,
        buttons: document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]').length,
        inputs: document.querySelectorAll("input, textarea, select").length
      }
    };
  }
  async function waitScrollSettle(timeout = 900) {
    const start = Date.now();
    let last = window.scrollY;
    let stable = 0;
    while (Date.now() - start < timeout) {
      await fxSleep(80);
      if (Math.abs(window.scrollY - last) < 1) {
        if (++stable >= 2)
          break;
      } else
        stable = 0;
      last = window.scrollY;
    }
  }
  function doPageInfo() {
    return { success: true, ...viewportContext() };
  }

  // src/content/actions.ts
  function topViewportPoint(x, y, frame) {
    return frame ? toTopViewportPoint(x, y, frame) : { x, y };
  }
  async function doClick(msg) {
    const viaCoords = msg.x !== void 0 && msg.y !== void 0 && (msg.ref === void 0 || msg.ref === null || msg.ref === "");
    let { el, x, y, frame } = resolveTarget(msg);
    if (!el) {
      if (msg.ref !== void 0 && msg.ref !== null && msg.ref !== "") {
        throw new Error(`Mark #${msg.ref} is stale or gone \u2014 call browser_observe again to refresh the page marks, then retry.`);
      }
      throw new Error(`Element not found: selector=${msg.selector || ""} text=${msg.text || ""} ref=${msg.ref ?? ""} coords=${msg.x},${msg.y}`);
    }
    if (!viaCoords) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
      await waitScrollSettle(450);
      const c = elCenter(el);
      x = c.x;
      y = c.y;
      try {
        el.focus?.();
      } catch {
      }
      if (!isVisible(el)) {
        return {
          success: false,
          not_visible: true,
          message: "\u76EE\u6807\u5143\u7D20\u5B58\u5728\u4E8E DOM \u4E2D\uFF0C\u4F46\u5F53\u524D\u4E0D\u53EF\u89C1\uFF08display:none / \u5C3A\u5BF8\u4E3A 0 / \u5728\u89C6\u53E3\u5916\uFF09\u3002\u5B83\u53EF\u80FD\u662F\u80CC\u666F\u6216\u672A\u5C55\u5F00\u7684\u5185\u5BB9\uFF0C\u7528\u6237\u6B64\u523B\u770B\u4E0D\u5230\uFF0C\u56E0\u6B64\u65E0\u6CD5\u70B9\u51FB\u3002",
          target: { tag: el.tagName, text: textOf(el, 80), selector: cssPath(el) }
        };
      }
      if (msg.force !== true && !isHittable(el, frame)) {
        const cover = occluderOf(el, frame);
        return {
          success: false,
          occluded: true,
          message: "\u76EE\u6807\u88AB\u53E6\u4E00\u4E2A\u5143\u7D20\u906E\u6321\uFF08\u5F88\u53EF\u80FD\u662F\u5F39\u7A97/\u906E\u7F69/\u5E7F\u544A\uFF09\u3002\u8BF7\u5148\u5173\u95ED\u906E\u6321\u5C42\uFF0C\u6216\u6539\u7528 browser_observe \u540E\u6309\u7F16\u53F7\u70B9\u51FB\u6700\u9876\u5C42\u5143\u7D20\uFF1B\u786E\u9700\u7A7F\u900F\u70B9\u51FB\u53EF\u4F20 force:true\u3002",
          target: { tag: el.tagName, text: textOf(el, 80), selector: cssPath(el) },
          occludedBy: cover ? { tag: cover.tagName, text: textOf(cover, 80), selector: cssPath(cover) } : null
        };
      }
    }
    if (msg.resolveOnly) {
      const p = topViewportPoint(x, y, frame);
      return {
        success: true,
        resolved: true,
        x: p.x,
        y: p.y,
        tag: el.tagName,
        text: textOf(el, 100),
        selector: cssPath(el)
      };
    }
    if (isFxEnabled()) {
      if (!viaCoords)
        await fxSleep(220);
      const p = topViewportPoint(x, y, frame);
      await fxToElement(el, frame ? p : void 0);
      await fxClickAt(p.x, p.y);
      await fxSleep(80);
    }
    clickLikeUser(el, { x, y });
    const ctx = viewportContext();
    return {
      success: true,
      tag: el.tagName,
      text: el.innerText?.slice(0, 100) || textOf(el, 100),
      position: { scrollY: ctx.scrollY, scrollPercent: ctx.scrollPercent, currentSection: ctx.currentSection }
    };
  }
  async function doDoubleClick(msg) {
    const { el, frame } = resolveTarget(msg);
    if (!el)
      throw new Error(`Element not found: selector=${msg.selector || ""} text=${msg.text || ""} coords=${msg.x},${msg.y}`);
    el.scrollIntoView({ block: "center", behavior: "auto" });
    try {
      el.focus?.();
    } catch {
    }
    if (isFxEnabled()) {
      await fxSleep(220);
      const c0 = elCenter(el);
      const p = topViewportPoint(c0.x, c0.y, frame);
      await fxToElement(el, frame ? p : void 0);
      await fxClickAt(p.x, p.y, "double");
      await fxSleep(80);
    }
    const win = ownerWindow(el);
    const c = elCenter(el);
    const base = { bubbles: true, cancelable: true, view: win, clientX: c.x, clientY: c.y };
    const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerover", pointer));
    el.dispatchEvent(new PointerEvent("pointerenter", pointer));
    el.dispatchEvent(new MouseEvent("mouseover", base));
    el.dispatchEvent(new MouseEvent("mouseenter", base));
    const opts = { ...base };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", { ...opts, detail: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", { ...opts, detail: 2 }));
    el.dispatchEvent(new MouseEvent("dblclick", { ...opts, detail: 2 }));
    return { success: true, tag: el.tagName, text: el.innerText?.slice(0, 100) };
  }
  async function doRightClick(msg) {
    const { el, frame } = resolveTarget(msg);
    if (!el)
      throw new Error(`Element not found: selector=${msg.selector || ""} text=${msg.text || ""} coords=${msg.x},${msg.y}`);
    el.scrollIntoView({ block: "center", behavior: "auto" });
    try {
      el.focus?.();
    } catch {
    }
    if (isFxEnabled()) {
      await fxSleep(220);
      const c0 = elCenter(el);
      const p = topViewportPoint(c0.x, c0.y, frame);
      await fxToElement(el, frame ? p : void 0);
      await fxClickAt(p.x, p.y, "right");
      await fxSleep(80);
    }
    const win = ownerWindow(el);
    const c = elCenter(el);
    const base = { bubbles: true, cancelable: true, view: win, clientX: c.x, clientY: c.y, button: 2, buttons: 2 };
    const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerover", pointer));
    el.dispatchEvent(new PointerEvent("pointerenter", pointer));
    el.dispatchEvent(new MouseEvent("mouseover", base));
    el.dispatchEvent(new MouseEvent("mouseenter", base));
    const opts = { ...base };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("contextmenu", opts));
    return { success: true, tag: el.tagName, text: el.innerText?.slice(0, 100) };
  }
  function dragDiagnostics(src, dst, msg) {
    const describe = (el) => {
      if (!el)
        return null;
      const html = el;
      const r = html.getBoundingClientRect();
      const style = getComputedStyle(html);
      return {
        selector: cssPath(el),
        tag: el.tagName,
        text: textOf(el, 120),
        draggable: html.draggable || html.getAttribute("draggable") === "true",
        role: html.getAttribute("role") || "",
        visible: isVisible(el),
        cursor: style.cursor,
        rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
      };
    };
    return {
      source: describe(src),
      target: describe(dst),
      requested: {
        selector: msg.selector,
        text: msg.text,
        x: msg.x,
        y: msg.y,
        toSelector: msg.toSelector,
        toText: msg.toText,
        toX: msg.toX,
        toY: msg.toY
      }
    };
  }
  async function doDrag(msg) {
    const src = resolveTarget({ selector: msg.selector, text: msg.text, x: msg.x, y: msg.y });
    const dst = resolveTarget({ selector: msg.toSelector, text: msg.toText, x: msg.toX, y: msg.toY });
    if (!src.el && msg.x === void 0) {
      const diag = dragDiagnostics(src.el, dst.el, msg);
      throw new Error(`Drag source not found. diagnostics=${JSON.stringify(diag)}`);
    }
    if (!dst.el && msg.toX === void 0) {
      const diag = dragDiagnostics(src.el, dst.el, msg);
      throw new Error(`Drag target not found. diagnostics=${JSON.stringify(diag)}`);
    }
    if (src.el)
      src.el.scrollIntoView({ block: "center", behavior: "auto" });
    if (isFxEnabled())
      await fxSleep(200);
    const s = src.el ? elCenter(src.el) : { x: src.x, y: src.y };
    const d = dst.el ? elCenter(dst.el) : { x: dst.x, y: dst.y };
    const before = src.el ? src.el.getBoundingClientRect() : null;
    if (isFxEnabled())
      await fxDragPath(s.x, s.y, d.x, d.y);
    const dt = (() => {
      try {
        return new DataTransfer();
      } catch {
        return null;
      }
    })();
    const mk = (type, x, y, target) => {
      if (!target)
        return;
      const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
      if (dt)
        init.dataTransfer = dt;
      const ev = type.startsWith("drag") || type === "drop" ? new DragEvent(type, init) : new MouseEvent(type, init);
      target.dispatchEvent(ev);
    };
    mk("pointerdown", s.x, s.y, src.el);
    mk("mousedown", s.x, s.y, src.el);
    mk("dragstart", s.x, s.y, src.el);
    mk("drag", s.x, s.y, src.el);
    mk("mousemove", d.x, d.y, dst.el || src.el);
    mk("dragenter", d.x, d.y, dst.el);
    mk("dragover", d.x, d.y, dst.el);
    mk("drop", d.x, d.y, dst.el);
    mk("dragend", d.x, d.y, src.el);
    mk("pointerup", d.x, d.y, dst.el || src.el);
    mk("mouseup", d.x, d.y, dst.el || src.el);
    await fxSleep(80);
    const after = src.el ? src.el.getBoundingClientRect() : null;
    const moved = before && after ? Math.abs(before.left - after.left) > 1 || Math.abs(before.top - after.top) > 1 : false;
    return {
      success: true,
      moved,
      warning: moved ? "" : "Drag events were dispatched, but the source element did not visibly move. The page may require native browser/OS drag support or a framework-specific gesture.",
      from: { x: Math.round(s.x), y: Math.round(s.y) },
      to: { x: Math.round(d.x), y: Math.round(d.y) },
      diagnostics: dragDiagnostics(src.el, dst.el, msg)
    };
  }
  function doPressKey(msg) {
    const key = String(msg.key || "");
    if (!key)
      throw new Error("key is required");
    let el = msg.selector ? document.querySelector(msg.selector) : null;
    if (!el)
      el = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    el.focus?.();
    const init = {
      key,
      code: /^[a-zA-Z]$/.test(key) ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
      ctrlKey: !!msg.ctrl,
      shiftKey: !!msg.shift,
      altKey: !!msg.alt,
      metaKey: !!msg.meta
    };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    return { success: true, key, target: el.tagName };
  }
  function focusTarget(msg) {
    const selector = String(msg.selector || "");
    if (!selector)
      return { success: true, focused: false, reason: "selector is empty" };
    const el = document.querySelector(selector);
    if (!el)
      throw new Error(`Element not found: ${selector}`);
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    el.focus?.();
    return { success: true, focused: document.activeElement === el, target: el.tagName };
  }
  async function doType(msg) {
    const selector = msg.selector || "input:focus, textarea:focus, [contenteditable]:focus";
    const text = String(msg.text ?? "");
    const clearFirst = msg.clearFirst !== false;
    const hasRef = msg.ref !== void 0 && msg.ref !== null && msg.ref !== "";
    let el = hasRef ? resolveTarget(msg).el : null;
    if (!el)
      el = selector ? document.querySelector(selector) : null;
    if (!el)
      el = document.activeElement;
    if (!el)
      throw new Error("No input element found \u2014 try providing a selector");
    if (isFxEnabled()) {
      await fxToElement(el);
      const p = getFxPos();
      await fxClickAt(p.x, p.y);
    }
    el.focus();
    if (el.isContentEditable) {
      if (clearFirst)
        el.textContent = "";
      el.textContent += text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      if (clearFirst) {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      el.value += text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (msg.submit)
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return { success: true, text, length: text.length };
  }
  function getContent(msg) {
    const root = msg.selector ? document.querySelector(String(msg.selector)) : document.body;
    if (!root)
      throw new Error(`Element not found: ${msg.selector}`);
    const maxChars = Math.min(Math.max(Number(msg.max_chars ?? 8e3), 200), 5e4);
    const text = root.innerText?.slice(0, maxChars) || "";
    const links = Array.from(root.querySelectorAll("a[href]")).slice(0, 50).map((a) => ({
      tag: "A",
      selector: cssPath(a),
      text: textOf(a, 100),
      href: a.href,
      attributes: { href: a.href }
    }));
    const result = {
      success: true,
      source: "browser_get_content",
      selector: msg.selector || "body",
      url: location.href,
      title: document.title,
      text,
      content: { text, html: msg.includeHtml ? root.innerHTML?.slice(0, 1e5) : void 0 },
      links,
      items: links,
      meta: {
        description: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
        keywords: document.querySelector('meta[name="keywords"]')?.getAttribute("content") || ""
      }
    };
    if (msg.includeHtml)
      result.html = root.innerHTML?.slice(0, 1e5);
    return result;
  }
  function canScroll(el, direction) {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 2)
      return false;
    if (direction === "up")
      return el.scrollTop > 2;
    if (direction === "down")
      return el.scrollTop < max - 2;
    return true;
  }
  function scrollableElement(direction) {
    const candidates = Array.from(document.querySelectorAll("*")).filter((el) => {
      const style = getComputedStyle(el);
      const overflowY = style.overflowY;
      if (!/(auto|scroll|overlay)/.test(overflowY))
        return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0)
        return false;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight)
        return false;
      return canScroll(el, direction);
    }).sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    return candidates[0] || null;
  }
  function elementLabel(el) {
    if (!el)
      return "window";
    const html = el;
    if (html.id)
      return `#${html.id}`;
    const cls = typeof html.className === "string" ? html.className.trim().split(/\s+/)[0] : "";
    return cls ? `${html.tagName.toLowerCase()}.${cls}` : html.tagName.toLowerCase();
  }
  async function doScroll(msg) {
    const amount = Number(msg.amount || 400);
    const beforeY = Math.round(window.scrollY);
    let target = null;
    let beforeElementY = 0;
    if (msg.selector) {
      const el = document.querySelector(msg.selector);
      if (!el)
        throw new Error(`Element not found: ${msg.selector}`);
      el.scrollIntoView({ block: "center", behavior: "auto" });
    } else {
      switch (msg.direction) {
        case "up":
          window.scrollBy({ top: -amount, behavior: "auto" });
          break;
        case "down":
          window.scrollBy({ top: amount, behavior: "auto" });
          break;
        case "top":
          window.scrollTo({ top: 0, behavior: "auto" });
          break;
        case "bottom":
          window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
          break;
        default:
          throw new Error(`Unknown scroll direction: ${msg.direction}`);
      }
    }
    void fxScrollDrag(msg.direction, amount);
    await waitScrollSettle();
    let ctx = viewportContext();
    let pageScrolledBy = ctx.scrollY - beforeY;
    let elementScrolledBy = 0;
    if (!msg.selector && pageScrolledBy === 0 && !ctx.atTop && !ctx.atBottom) {
      const delta = msg.direction === "up" ? -amount : amount;
      target = scrollableElement(msg.direction);
      if (target) {
        beforeElementY = target.scrollTop;
        target.scrollBy({ top: delta, behavior: "auto" });
        elementScrolledBy = Math.round(target.scrollTop - beforeElementY);
        await waitScrollSettle(250);
        ctx = viewportContext();
        pageScrolledBy = ctx.scrollY - beforeY;
      }
    }
    const scrolledBy = pageScrolledBy || elementScrolledBy;
    return {
      success: true,
      direction: msg.direction,
      requestedAmount: amount,
      scrolledBy,
      // actual pixels moved (0 = nothing happened)
      pageScrolledBy,
      elementScrolledBy,
      scrollTarget: msg.selector ? msg.selector : elementLabel(target),
      reachedEdge: ctx.atTop ? "top" : ctx.atBottom ? "bottom" : null,
      ...ctx
    };
  }
  async function doWait(msg) {
    if (msg.ms) {
      await new Promise((r) => setTimeout(r, Math.min(Number(msg.ms), 1e4)));
      return { success: true, waited_ms: msg.ms };
    }
    if (msg.selector) {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        let observer = null;
        let pollTimer = null;
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Element "${msg.selector}" not found after 10s`));
        }, 1e4);
        function cleanup() {
          clearTimeout(timeout);
          if (pollTimer)
            clearTimeout(pollTimer);
          if (observer)
            observer.disconnect();
        }
        function check() {
          if (document.querySelector(msg.selector)) {
            cleanup();
            resolve();
            return true;
          }
          return false;
        }
        function poll() {
          if (!check())
            pollTimer = setTimeout(poll, 250);
        }
        if (check())
          return;
        observer = new MutationObserver(() => {
          check();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        poll();
      });
      return { success: true, selector: msg.selector, waited_ms: Date.now() - start };
    }
    return { success: true, waited_ms: 0 };
  }
  function doAwaitSettle(msg) {
    const timeout = Math.min(Math.max(Number(msg.timeout ?? 3e3), 200), 8e3);
    const quietFor = Math.min(Math.max(Number(msg.quiet ?? 350), 80), 2e3);
    const idleWindow = Math.min(Math.max(Number(msg.idle_window ?? 600), 150), timeout);
    const startUrl = location.href;
    const startTitle = document.title;
    return new Promise((resolve) => {
      let mutations = 0;
      let lastMutationAt = 0;
      let done = false;
      const start = Date.now();
      const isOurs = (node) => {
        let el = node instanceof Element ? node : node?.parentElement ?? null;
        while (el) {
          const id = el.id;
          if (typeof id === "string" && (id.startsWith("__hs_marks") || id.startsWith("__hs_mouse_fx")))
            return true;
          el = el.parentElement;
        }
        return false;
      };
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          if (isOurs(r.target))
            continue;
          let real = r.type === "attributes";
          r.addedNodes.forEach((n) => {
            if (!isOurs(n))
              real = true;
          });
          r.removedNodes.forEach((n) => {
            if (!isOurs(n))
              real = true;
          });
          if (real) {
            mutations++;
            lastMutationAt = Date.now();
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const onHide = () => finish(true);
      window.addEventListener("pagehide", onHide, { once: true });
      let timer = null;
      const poll = () => {
        const now = Date.now();
        if (location.href !== startUrl)
          return finish(false);
        if (mutations > 0 && now - lastMutationAt >= quietFor)
          return finish(false);
        if (mutations === 0 && now - start >= idleWindow)
          return finish(false);
        if (now - start >= timeout)
          return finish(false);
        timer = setTimeout(poll, 80);
      };
      function finish(navigating) {
        if (done)
          return;
        done = true;
        if (timer)
          clearTimeout(timer);
        observer.disconnect();
        window.removeEventListener("pagehide", onHide);
        resolve({
          success: true,
          changed: navigating || mutations > 0 || location.href !== startUrl || document.title !== startTitle,
          navigating,
          mutations,
          urlChanged: location.href !== startUrl,
          settleMs: Date.now() - start
        });
      }
      timer = setTimeout(poll, 100);
    });
  }
  function doEvaluate(msg) {
    const code = String(msg.code || "");
    if (!code)
      throw new Error("code is required");
    const result = (0, eval)(code);
    return { success: true, result: typeof result === "function" ? "[Function]" : result };
  }
  function doExtract(msg) {
    const { selector, attributes, limit = 50 } = msg;
    if (!selector)
      throw new Error("selector is required");
    const els = Array.from(document.querySelectorAll(selector)).slice(0, limit);
    const items = els.map((el) => {
      const collected = {};
      const attrs = attributes || ["href", "src", "id", "class", "value", "data-id", "name"];
      for (const attr of attrs) {
        const v = el.getAttribute(attr);
        if (v !== null)
          collected[attr] = v;
      }
      const item = {
        tag: el.tagName,
        selector: cssPath(el),
        text: textOf(el, 500),
        attributes: collected
      };
      for (const [k, v] of Object.entries(collected))
        item[k] = v;
      return item;
    });
    return {
      success: true,
      source: "browser_extract",
      url: location.href,
      title: document.title,
      selector,
      count: items.length,
      items
    };
  }
  function attrMap(el, names) {
    const out = {};
    for (const name of names) {
      const v = el.getAttribute(name);
      if (v !== null)
        out[name] = v;
    }
    return out;
  }
  function snapshotNode(el, depth, maxDepth, state) {
    state.count++;
    const html = el;
    const children = depth >= maxDepth || state.count >= state.maxNodes ? [] : Array.from(el.children).filter((child) => isVisible(child) || ["SCRIPT", "STYLE", "META", "LINK"].includes(child.tagName) === false).slice(0, Math.max(0, state.maxNodes - state.count)).map((child) => snapshotNode(child, depth + 1, maxDepth, state)).filter(Boolean);
    return {
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      text: textOf(el, 160),
      visible: isVisible(el),
      role: html.getAttribute("role") || "",
      attrs: attrMap(el, ["id", "class", "name", "type", "href", "src", "alt", "title", "aria-label", "placeholder"]),
      children
    };
  }
  function domSnapshot(msg) {
    const root = msg.selector ? document.querySelector(String(msg.selector)) : document.body;
    if (!root)
      throw new Error(`Element not found: ${msg.selector}`);
    const maxDepth = Math.min(Math.max(Number(msg.max_depth ?? 4), 0), 8);
    const maxNodes = Math.min(Math.max(Number(msg.max_nodes ?? 120), 1), 1e3);
    const state = { count: 0, maxNodes };
    const tree = snapshotNode(root, 0, maxDepth, state);
    return {
      success: true,
      source: "browser_dom_snapshot",
      url: location.href,
      title: document.title,
      selector: msg.selector || "body",
      maxDepth,
      maxNodes,
      truncated: state.count >= maxNodes,
      tree
    };
  }
  function iframeList() {
    const frames = Array.from(document.querySelectorAll("iframe,frame")).map((frame) => {
      const el = frame;
      const r = el.getBoundingClientRect();
      let accessible = false;
      let title = "";
      try {
        accessible = !!el.contentDocument;
        title = el.contentDocument?.title || "";
      } catch {
        accessible = false;
      }
      return {
        selector: cssPath(el),
        src: el.src || el.getAttribute("src") || "",
        name: el.name || el.getAttribute("name") || "",
        title,
        accessible,
        visible: isVisible(el),
        rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
      };
    });
    return { success: true, url: location.href, count: frames.length, frames };
  }
  function performanceInfo() {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const byType = {};
    for (const r of resources)
      byType[r.initiatorType || "other"] = (byType[r.initiatorType || "other"] || 0) + 1;
    return {
      success: true,
      url: location.href,
      title: document.title,
      navigation: nav ? {
        type: nav.type,
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        loadMs: Math.round(nav.loadEventEnd - nav.startTime),
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
        decodedBodySize: nav.decodedBodySize
      } : null,
      resources: {
        count: resources.length,
        byType,
        slowest: resources.slice().sort((a, b) => b.duration - a.duration).slice(0, 20).map((r) => ({
          name: r.name,
          type: r.initiatorType,
          durationMs: Math.round(r.duration),
          transferSize: r.transferSize,
          encodedBodySize: r.encodedBodySize
        }))
      }
    };
  }
  async function screenshotTargetInfo(msg) {
    const margin = Math.max(0, Number(msg.margin ?? msg.padding ?? 0));
    let el = null;
    if (msg.selector || msg.text) {
      el = findEl(msg.selector, msg.text);
      if (!el)
        throw new Error(`Element not found: selector=${msg.selector || ""} text=${msg.text || ""}`);
      if (msg.scroll_into_view !== false) {
        el.scrollIntoView({ block: msg.block || "center", inline: msg.inline || "center", behavior: "auto" });
        await waitScrollSettle(250);
      }
    } else if (msg.x !== void 0 && msg.y !== void 0) {
      const space = String(msg.coordinate_space || "viewport");
      const vx = space === "page" ? Number(msg.x) - window.scrollX : Number(msg.x);
      const vy = space === "page" ? Number(msg.y) - window.scrollY : Number(msg.y);
      el = document.elementFromPoint(vx, vy);
    }
    if (!el)
      throw new Error("selector, text, or x/y is required for screenshot target info");
    const rect = el.getBoundingClientRect();
    const viewportRect = {
      x: Math.max(0, rect.left - margin),
      y: Math.max(0, rect.top - margin),
      width: Math.min(window.innerWidth, rect.right + margin) - Math.max(0, rect.left - margin),
      height: Math.min(window.innerHeight, rect.bottom + margin) - Math.max(0, rect.top - margin)
    };
    const pageRect = {
      x: Math.max(0, rect.left + window.scrollX - margin),
      y: Math.max(0, rect.top + window.scrollY - margin),
      width: Math.min(document.documentElement.scrollWidth, rect.right + window.scrollX + margin) - Math.max(0, rect.left + window.scrollX - margin),
      height: Math.min(document.documentElement.scrollHeight, rect.bottom + window.scrollY + margin) - Math.max(0, rect.top + window.scrollY - margin)
    };
    return {
      success: true,
      selector: cssPath(el),
      tag: el.tagName,
      text: textOf(el, 160),
      visible: isVisible(el),
      devicePixelRatio: window.devicePixelRatio,
      scroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      rect: { viewport: viewportRect, page: pageRect }
    };
  }
  function fileUpload(msg) {
    const input = document.querySelector(String(msg.selector || 'input[type="file"]'));
    if (!input || input.type !== "file")
      throw new Error(`File input not found: ${msg.selector || 'input[type="file"]'}`);
    const files = Array.isArray(msg.files) ? msg.files : [];
    if (!files.length)
      throw new Error("files is required. Use [{name, content, type?, encoding?}]. Local filesystem paths cannot be read by a content script.");
    const dt = new DataTransfer();
    for (const f of files) {
      const name = String(f.name || "upload.txt");
      const type = String(f.type || "application/octet-stream");
      const raw = String(f.content || "");
      const data = f.encoding === "base64" ? Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)) : raw;
      dt.items.add(new File([data], name, { type }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, selector: cssPath(input), count: input.files?.length || 0, files: Array.from(input.files || []).map((f) => ({ name: f.name, size: f.size, type: f.type })) };
  }
  function findText(msg) {
    const target = String(msg.text || "");
    if (!target)
      throw new Error("text is required");
    const exact = !!msg.exact;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const found = [];
    while (walker.nextNode() && found.length < 20) {
      const el = walker.currentNode;
      const inner = el.innerText?.trim() || "";
      const match = exact ? inner === target : inner.includes(target);
      if (match && inner.length > 0 && inner.length < 500) {
        found.push({
          tag: el.tagName,
          text: inner.slice(0, 200),
          selector: el.id ? `#${el.id}` : el.className ? `.${el.className.trim().split(" ")[0]}` : el.tagName.toLowerCase()
        });
      }
    }
    return { success: true, query: target, count: found.length, elements: found };
  }
  function cssEscape(value) {
    const esc = window.CSS?.escape;
    return esc ? esc(value) : value.replace(/["\\]/g, "\\$&");
  }
  function normalizeFields(raw) {
    if (Array.isArray(raw))
      return raw;
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([key, value]) => /^[.#[]|^[a-z]+[.#[:\s>+~]/i.test(key) ? { selector: key, value } : { name: key, value });
    }
    return [];
  }
  function fieldByLabel(text) {
    const target = text.trim().toLowerCase();
    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      const labelText = (label.innerText || label.textContent || "").trim().toLowerCase();
      if (!labelText || !labelText.includes(target))
        continue;
      if (label.htmlFor) {
        const byFor = document.getElementById(label.htmlFor);
        if (byFor)
          return byFor;
      }
      const nested = label.querySelector('input, textarea, select, [contenteditable="true"]');
      if (nested)
        return nested;
    }
    return null;
  }
  function resolveField(field) {
    if (field.selector) {
      const bySelector = document.querySelector(field.selector);
      if (bySelector)
        return bySelector;
    }
    if (field.name) {
      const name = cssEscape(String(field.name));
      const byName = document.querySelector(`[name="${name}"], #${name}`);
      if (byName)
        return byName;
    }
    if (field.placeholder) {
      const target = String(field.placeholder).toLowerCase();
      const byPlaceholder = Array.from(document.querySelectorAll("input[placeholder], textarea[placeholder]")).find((el) => (el.placeholder || "").toLowerCase().includes(target));
      if (byPlaceholder)
        return byPlaceholder;
    }
    if (field.label || field.text)
      return fieldByLabel(String(field.label || field.text));
    return null;
  }
  function setNativeValue(el, field) {
    const value = field.value;
    const action = field.action || "set";
    el.focus?.();
    if (action === "click") {
      el.click();
      return;
    }
    const tag = el.tagName;
    if (tag === "SELECT") {
      const sel = el;
      const wanted = String(value ?? "");
      const opt = Array.from(sel.options).find((o) => o.value === wanted || o.text.trim() === wanted);
      if (!opt)
        throw new Error(`Option not found: ${wanted}`);
      sel.value = opt.value;
    } else if (tag === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const box = el;
      if (action === "uncheck")
        box.checked = false;
      else if (action === "check")
        box.checked = true;
      else
        box.checked = Boolean(value);
    } else if (tag === "INPUT" || tag === "TEXTAREA") {
      el.value = String(value ?? "");
    } else if (el.isContentEditable) {
      el.textContent = String(value ?? "");
    } else {
      throw new Error(`Unsupported form element: ${el.tagName}`);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function fillForm(msg) {
    const fields = normalizeFields(msg.fields);
    const filled = [];
    const errors = [];
    if (!fields.length) {
      return {
        success: false,
        filled,
        errors: ['fields must be an array like [{ selector, value }] or an object map like { "input[name=email]": "a@b.com" }']
      };
    }
    for (const field of fields) {
      try {
        const el = resolveField(field);
        if (!el) {
          errors.push(`Not found: ${field.selector || field.name || field.label || field.placeholder || field.text || "[unknown]"}`);
          continue;
        }
        setNativeValue(el, field);
        filled.push({
          target: field.selector || field.name || field.label || field.placeholder || field.text || elementLabel(el),
          resolved: elementLabel(el),
          tag: el.tagName,
          type: el.type || void 0,
          action: field.action || "set"
        });
      } catch (err) {
        errors.push(`${field.selector || field.name || field.label || field.placeholder || field.text || "[unknown]"}: ${err.message || String(err)}`);
      }
    }
    if (msg.submitSelector) {
      const btn = document.querySelector(msg.submitSelector);
      if (btn)
        btn.click();
      else
        errors.push(`Submit not found: ${msg.submitSelector}`);
    }
    return { success: errors.length === 0, filled, errors };
  }
  function findCustomOption(value, root) {
    const query = [
      '[role="option"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="listitem"]',
      "[data-value]",
      "li",
      "button",
      "a",
      "div",
      "span"
    ].join(",");
    const scope = root || document;
    const candidates = Array.from(scope.querySelectorAll(query));
    return candidates.find((el) => {
      if (!isVisible(el))
        return false;
      const dataValue = el.getAttribute("data-value") || el.getAttribute("value") || "";
      return dataValue === value || textMatches(el, value, true);
    }) || candidates.find((el) => isVisible(el) && textMatches(el, value, false)) || null;
  }
  async function doSelect(msg) {
    const el = document.querySelector(msg.selector);
    if (!el)
      throw new Error(`Select target not found: ${msg.selector}`);
    if (msg.value === void 0 || msg.value === null || String(msg.value) === "")
      throw new Error("value is required");
    const value = String(msg.value);
    if (el.tagName === "SELECT") {
      const sel = el;
      const opt = Array.from(sel.options).find((o) => o.value === value || o.text.trim() === value);
      if (!opt)
        throw new Error(`Option "${value}" not found in ${msg.selector}`);
      sel.value = opt.value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, selector: msg.selector, selected: opt.text, value: opt.value, mode: "native" };
    }
    el.scrollIntoView({ block: "center", behavior: "auto" });
    if (isFxEnabled()) {
      await fxSleep(160);
      await fxToElement(el);
    }
    clickLikeUser(el);
    await fxSleep(250);
    const expanded = el.getAttribute("aria-controls");
    const popup = expanded ? document.getElementById(expanded) : null;
    const option = findCustomOption(value, popup) || findCustomOption(value);
    if (!option) {
      throw new Error(`Custom dropdown option "${value}" not found after opening ${msg.selector}`);
    }
    if (isFxEnabled())
      await fxToElement(option);
    clickLikeUser(option);
    return {
      success: true,
      selector: msg.selector,
      selected: textOf(option, 120) || value,
      value,
      mode: "custom",
      optionSelector: cssPath(option)
    };
  }
  function storageGet(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    const value = store.getItem(msg.key);
    return { success: true, key: msg.key, value, found: value !== null };
  }
  function storageSet(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    if (!msg.key)
      throw new Error("key is required");
    store.setItem(String(msg.key), String(msg.value ?? ""));
    return { success: true, key: String(msg.key), type: msg.storageType === "session" ? "session" : "local" };
  }
  function storageRemove(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    if (!msg.key)
      throw new Error("key is required");
    store.removeItem(String(msg.key));
    return { success: true, key: String(msg.key), type: msg.storageType === "session" ? "session" : "local" };
  }
  function storageList(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    const prefix = String(msg.prefix || "");
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(Boolean);
    const filtered = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    const limit = Math.min(Number(msg.limit || 100), 500);
    return {
      success: true,
      type: msg.storageType === "session" ? "session" : "local",
      count: filtered.length,
      keys: filtered.slice(0, limit),
      items: msg.include_values ? filtered.slice(0, limit).map((key) => ({ key, value: store.getItem(key) })) : void 0
    };
  }
  async function doHover(msg) {
    const resolved = resolveTarget(msg);
    const el = resolved.el;
    if (!el) {
      const sel = msg.selector || msg.text || msg.ref || "unknown";
      throw new Error(`Element not found for hover: ${sel}`);
    }
    if (isFxEnabled()) {
      const c2 = elCenter(el);
      const p = topViewportPoint(c2.x, c2.y, resolved.frame);
      await fxToElement(el, p);
      fxHoverOn(el);
    }
    const win = ownerWindow(el);
    const c = elCenter(el);
    const base = { bubbles: true, cancelable: true, view: win, clientX: c.x, clientY: c.y };
    el.dispatchEvent(new MouseEvent("mouseover", base));
    el.dispatchEvent(new MouseEvent("mouseenter", base));
    el.dispatchEvent(new PointerEvent("pointerover", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    return { success: true, selector: cssPath(el), tag: el.tagName };
  }
  async function doScreenshotFx(msg) {
    if (msg.phase === "clear") {
      fxScreenshotClear();
      return { success: true, phase: "clear" };
    }
    if (msg.phase === "before") {
      let rect = msg.rect;
      if (!rect && (msg.selector || msg.text)) {
        const el = findEl(msg.selector, msg.text);
        if (el) {
          const margin = Math.max(0, Number(msg.margin ?? msg.padding ?? 8));
          const r = el.getBoundingClientRect();
          rect = {
            x: Math.max(0, r.left - margin),
            y: Math.max(0, r.top - margin),
            width: Math.min(window.innerWidth, r.right + margin) - Math.max(0, r.left - margin),
            height: Math.min(window.innerHeight, r.bottom + margin) - Math.max(0, r.top - margin)
          };
        }
      }
      await fxScreenshotBefore(rect);
      return { success: true, phase: "before", rect: rect || null };
    }
    if (msg.phase === "after") {
      await fxScreenshotAfter();
      return { success: true, phase: "after" };
    }
    return { success: true, phase: "noop" };
  }

  // src/content/popups.ts
  var POPUP_SELECTOR = [
    "dialog[open]",
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    '[class*="modal" i]',
    '[class*="dialog" i]',
    '[class*="popup" i]',
    '[class*="popover" i]',
    '[class*="drawer" i]',
    '[class*="toast" i]',
    '[class*="overlay" i]',
    '[class*="ant-modal" i]',
    '[class*="el-dialog" i]',
    '[class*="MuiDialog" i]',
    '[class*="van-popup" i]'
  ].join(",");
  var CLOSE_SELECTOR = [
    'button[aria-label*="close" i]',
    'button[aria-label*="\u5173\u95ED" i]',
    '[role="button"][aria-label*="close" i]',
    '[role="button"][aria-label*="\u5173\u95ED" i]',
    'button[title*="close" i]',
    'button[title*="\u5173\u95ED" i]',
    "[data-dismiss]",
    "[data-bs-dismiss]",
    '[data-testid*="close" i]',
    '[class*="close" i]',
    '[class*="cancel" i]',
    ".ant-modal-close",
    ".el-dialog__headerbtn",
    ".MuiDialog-root button[aria-label]",
    ".btn-close"
  ].join(",");
  var CLOSE_TEXTS = [
    "\u5173\u95ED",
    "\u5173 \u95ED",
    "\u53D6\u6D88",
    "\u7A0D\u540E",
    "\u7A0D\u540E\u518D\u8BF4",
    "\u6211\u77E5\u9053\u4E86",
    "\u77E5\u9053\u4E86",
    "\u786E\u5B9A",
    "\u786E\u8BA4",
    "\u4E0D\u518D\u63D0\u793A",
    "\u8DF3\u8FC7",
    "\u5173\u95ED\u5F39\u7A97",
    "Close",
    "Cancel",
    "OK",
    "Ok",
    "Got it",
    "Dismiss",
    "\xD7",
    "x",
    "X"
  ];
  function isLikelyPopup(el) {
    if (!isVisible(el) || el === document.body || el === document.documentElement)
      return false;
    const h = el;
    const tag = h.tagName.toLowerCase();
    const role = h.getAttribute("role");
    const cls = String(h.className || "").toLowerCase();
    const explicit = tag === "dialog" || role === "dialog" || role === "alertdialog" || h.getAttribute("aria-modal") === "true" || /(modal|dialog|popup|popover|drawer|toast|overlay|ant-modal|el-dialog|muidialog|van-popup)/i.test(cls);
    if (explicit)
      return true;
    const s = getComputedStyle(h);
    if (!["fixed", "sticky"].includes(s.position))
      return false;
    const z = zIndexOf(h);
    const r = h.getBoundingClientRect();
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const areaRatio = r.width * r.height / viewportArea;
    const coversCenter = r.left <= window.innerWidth / 2 && r.right >= window.innerWidth / 2 && r.top <= window.innerHeight / 2 && r.bottom >= window.innerHeight / 2;
    const hasClose = findCloseCandidates(h, 1).length > 0;
    return z >= 10 && (hasClose || coversCenter || areaRatio >= 0.12);
  }
  function findCloseCandidates(root, limit = 12) {
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (el) => {
      if (!el || seen.has(el) || !isVisible(el))
        return;
      const clickable2 = clickableAncestor(el);
      if (!isVisible(clickable2) || seen.has(clickable2))
        return;
      seen.add(clickable2);
      candidates.push(clickable2);
    };
    root.querySelectorAll(CLOSE_SELECTOR).forEach(add);
    const clickable = root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title]');
    clickable.forEach((el) => {
      const txt = textOf(el, 80);
      const cls = String(el.className || "").toLowerCase();
      const labelledClose = /(close|cancel|dismiss)/.test(cls) || /关闭|取消/.test(txt);
      if (labelledClose || CLOSE_TEXTS.some((t) => txt.toLowerCase() === t.toLowerCase()))
        add(el);
    });
    return candidates.sort((a, b) => {
      const ta = textOf(a, 80);
      const tb = textOf(b, 80);
      const score = (t) => {
        if (/^(×|x)$/i.test(t))
          return 0;
        if (/关闭|close/i.test(t))
          return 1;
        if (/取消|cancel|dismiss|稍后|知道了|ok/i.test(t))
          return 2;
        return 3;
      };
      return score(ta) - score(tb);
    }).slice(0, limit);
  }
  function collectPopupElements() {
    const raw = /* @__PURE__ */ new Set();
    document.querySelectorAll(POPUP_SELECTOR).forEach((el) => raw.add(el));
    document.querySelectorAll("body *").forEach((el) => {
      if (isLikelyPopup(el))
        raw.add(el);
    });
    const popups = Array.from(raw).filter(isLikelyPopup).sort((a, b) => {
      const z = zIndexOf(b) - zIndexOf(a);
      if (z !== 0)
        return z;
      return elementArea(a) - elementArea(b);
    });
    const out = [];
    for (const el of popups) {
      if (out.some((existing) => existing === el || existing.contains(el) && findCloseCandidates(existing, 1).length > 0))
        continue;
      out.push(el);
    }
    return out.slice(0, 10);
  }
  function popupInfo(el, index) {
    const r = el.getBoundingClientRect();
    const closes = findCloseCandidates(el, 6);
    return {
      index,
      selector: cssPath(el),
      tag: el.tagName,
      role: el.getAttribute("role") || "",
      ariaModal: el.getAttribute("aria-modal") || "",
      zIndex: zIndexOf(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      text: textOf(el, 260),
      closeCandidates: closes.map((c) => ({ selector: cssPath(c), text: textOf(c, 80), tag: c.tagName }))
    };
  }
  function doFindPopups(msg) {
    const limit = Math.max(1, Math.min(Number(msg.limit || 10), 20));
    const popups = collectPopupElements().slice(0, limit).map(popupInfo);
    return { success: true, count: popups.length, popups };
  }
  async function doClosePopup(msg) {
    const strategy = String(msg.strategy || "auto");
    const before = collectPopupElements();
    let target = null;
    if (msg.selector)
      target = document.querySelector(String(msg.selector));
    if (!target && msg.text) {
      const needle = String(msg.text);
      target = before.find((el) => textOf(el, 1e3).includes(needle)) || null;
    }
    if (!target)
      target = before[Math.max(0, Number(msg.index || 0))] || null;
    if (!target)
      return { success: false, closed: false, reason: "no_popup_found", beforeCount: 0, afterCount: 0 };
    const beforeSelector = cssPath(target);
    const tryCloseButton = async () => {
      const candidates = findCloseCandidates(target, 8);
      const btn = candidates[0];
      if (!btn)
        return false;
      try {
        btn.focus?.();
      } catch {
      }
      if (isFxEnabled()) {
        await fxToElement(btn);
        const c2 = elCenter(btn);
        await fxClickAt(c2.x, c2.y);
        await fxSleep(80);
      }
      const c = elCenter(btn);
      const base = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y };
      const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
      btn.dispatchEvent(new PointerEvent("pointerover", pointer));
      btn.dispatchEvent(new PointerEvent("pointerenter", pointer));
      btn.dispatchEvent(new MouseEvent("mouseover", base));
      btn.dispatchEvent(new MouseEvent("mouseenter", base));
      const opts = { ...base };
      btn.dispatchEvent(new PointerEvent("pointerdown", opts));
      btn.dispatchEvent(new MouseEvent("mousedown", opts));
      btn.dispatchEvent(new PointerEvent("pointerup", opts));
      btn.dispatchEvent(new MouseEvent("mouseup", opts));
      btn.dispatchEvent(new MouseEvent("click", opts));
      btn.click?.();
      return true;
    };
    const pressEscape = () => {
      const init = { key: "Escape", code: "Escape", bubbles: true, cancelable: true };
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", init));
      document.dispatchEvent(new KeyboardEvent("keydown", init));
      document.dispatchEvent(new KeyboardEvent("keyup", init));
    };
    const clickBackdrop = () => {
      const r = target.getBoundingClientRect();
      const points = [
        { x: Math.max(2, r.left + 8), y: Math.max(2, r.top + 8) },
        { x: Math.min(window.innerWidth - 2, r.right - 8), y: Math.max(2, r.top + 8) },
        { x: window.innerWidth / 2, y: Math.min(window.innerHeight - 2, r.bottom - 8) }
      ];
      const pt = points.find((p) => {
        const hit2 = document.elementFromPoint(p.x, p.y);
        return hit2 === target || !!hit2 && target.contains(hit2);
      }) || points[0];
      const hit = document.elementFromPoint(pt.x, pt.y) || target;
      hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }));
      hit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }));
      hit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }));
    };
    const targetGone = () => !document.documentElement.contains(target) || !isVisible(target);
    let method = "";
    if (strategy === "close_button" || strategy === "auto") {
      if (await tryCloseButton())
        method = "close_button";
      else if (strategy === "close_button")
        throw new Error("No close button found in popup");
    }
    if (!method && (strategy === "escape" || strategy === "auto")) {
      pressEscape();
      method = "escape";
    }
    await fxSleep(260);
    if (!targetGone() && (strategy === "backdrop" || strategy === "auto")) {
      clickBackdrop();
      method = method ? `${method}+backdrop` : "backdrop";
      await fxSleep(260);
    }
    if (!targetGone() && msg.force_remove === true) {
      ;
      target.remove();
      method = method ? `${method}+force_remove` : "force_remove";
      await fxSleep(60);
    }
    const after = collectPopupElements();
    return {
      success: targetGone() || after.length < before.length,
      closed: targetGone() || after.length < before.length,
      reason: targetGone() || after.length < before.length ? "" : "popup_still_visible",
      method: method || "none",
      selector: beforeSelector,
      beforeCount: before.length,
      afterCount: after.length,
      remainingPopups: after.map(popupInfo)
    };
  }

  // src/content/observe.ts
  var INTERACTIVE = [
    "a[href]",
    "button",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="switch"]',
    '[role="option"]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    "[onclick]",
    '[tabindex]:not([tabindex="-1"])',
    "summary",
    "label[for]",
    "[aria-expanded]",
    "[aria-haspopup]",
    "[aria-controls]",
    "[aria-pressed]",
    "[aria-selected]",
    '[draggable="true"]'
  ].join(",");
  var MARK_LAYER_ID = "__hs_marks_layer";
  var MARK_STYLE_ID = "__hs_marks_style";
  var MARK_CHANGE_EVENTS = ["scroll", "resize", "hashchange", "popstate", "pagehide"];
  var TEXT_NODE_TAGS_TO_SKIP = /* @__PURE__ */ new Set(["script", "style", "noscript", "template", "svg", "canvas"]);
  var MEDIA_SELECTOR = "img,video,audio";
  var CONTROL = [
    "a[href]",
    "button",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    "summary",
    "label[for]",
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="switch"]',
    '[role="option"]',
    '[contenteditable=""]',
    '[contenteditable="true"]'
  ].join(",");
  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "a")
      return "link";
    if (tag === "button" || tag === "summary")
      return "button";
    if (tag === "select")
      return "combobox";
    if (tag === "textarea")
      return "textbox";
    if (tag === "input") {
      const t = el.type;
      if (t === "checkbox" || t === "radio" || t === "button" || t === "submit")
        return t;
      return "textbox";
    }
    return "";
  }
  var NAME_ROLE_PATTERNS = [
    { re: /(^|[-_])(btn|button)$/i, category: "button" },
    { re: /(^|[-_])link$/i, category: "link" }
  ];
  function nameRole(el) {
    if (!isHTMLElement(el))
      return "";
    const tokens = [...String(el.className || "").split(/\s+/), el.id || ""].filter(Boolean);
    for (const token of tokens) {
      for (const { re, category } of NAME_ROLE_PATTERNS) {
        if (re.test(token))
          return category;
      }
    }
    return "";
  }
  function elementCategory(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (tag === "img" || role === "img")
      return "image";
    if (tag === "video")
      return "video";
    if (tag === "audio")
      return "audio";
    if (tag === "textarea")
      return "input";
    if (tag === "select" || role === "combobox" || role === "listbox")
      return "select";
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      if (t === "button" || t === "submit" || t === "reset" || t === "image")
        return "button";
      if (t === "checkbox")
        return "checkbox";
      if (t === "radio")
        return "radio";
      return "input";
    }
    if (el.matches('[contenteditable=""],[contenteditable="true"]'))
      return "input";
    if (role === "textbox" || role === "searchbox")
      return "input";
    if (role === "button" || tag === "button" || tag === "summary")
      return "button";
    if (role === "link" || tag === "a")
      return "link";
    if (role === "checkbox" || role === "switch")
      return "checkbox";
    if (role === "radio")
      return "radio";
    if (role === "tab")
      return "tab";
    if (role === "menuitem" || role === "menuitemcheckbox" || role === "menuitemradio")
      return "menuitem";
    if (role === "option")
      return "option";
    if (tag === "label")
      return "label";
    return nameRole(el) || "other";
  }
  var FILTER_ALIASES = {
    button: "button",
    buttons: "button",
    btn: "button",
    link: "link",
    links: "link",
    anchor: "link",
    a: "link",
    input: "input",
    inputs: "input",
    textbox: "input",
    textfield: "input",
    textarea: "input",
    editable: "input",
    select: "select",
    selects: "select",
    dropdown: "select",
    combobox: "select",
    combo: "select",
    checkbox: "checkbox",
    checkboxes: "checkbox",
    check: "checkbox",
    toggle: "checkbox",
    switch: "checkbox",
    radio: "radio",
    radios: "radio",
    tab: "tab",
    tabs: "tab",
    menuitem: "menuitem",
    menu: "menuitem",
    menuitems: "menuitem",
    option: "option",
    options: "option",
    label: "label",
    labels: "label",
    image: "image",
    images: "image",
    img: "image",
    imgs: "image",
    picture: "image",
    pictures: "image",
    video: "video",
    videos: "video",
    audio: "audio",
    audios: "audio",
    media: "media",
    text: "text",
    texts: "text",
    "text-element": "text",
    frame: "frame",
    frames: "frame",
    iframe: "frame",
    iframes: "frame",
    interactive: "interactive",
    interactives: "interactive",
    clickable: "interactive",
    control: "interactive",
    controls: "interactive",
    all: "all",
    any: "all",
    "*": "all"
  };
  function normalizeFilterToken(raw) {
    return FILTER_ALIASES[raw.trim().toLowerCase()] ?? "";
  }
  function parseFilter(raw) {
    if (raw == null)
      return null;
    const parts = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,\s]+/);
    const out = /* @__PURE__ */ new Set();
    for (const part of parts) {
      const token = normalizeFilterToken(part);
      if (token === "all")
        return null;
      if (token)
        out.add(token);
    }
    return out.size ? out : null;
  }
  function interactiveCategoryAllowed(category, filter) {
    if (!filter)
      return true;
    return filter.has("interactive") || filter.has(category);
  }
  function mediaCategoryAllowed(category, filter) {
    if (!filter)
      return true;
    return filter.has("media") || filter.has(category);
  }
  function parseStringList(raw) {
    if (raw == null)
      return [];
    const parts = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/);
    return parts.map((p) => String(p || "").trim()).filter(Boolean);
  }
  function parseTagFilter(raw) {
    const tags = parseStringList(raw).map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, "")).filter(Boolean);
    return tags.length ? new Set(tags) : null;
  }
  function parseKeyword(raw) {
    return String(raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function elementSearchText(el, fallback = "") {
    const html = el;
    const parts = [
      fallback,
      textOf(el, 240),
      html.getAttribute("aria-label") || "",
      html.getAttribute("title") || "",
      html.getAttribute("alt") || "",
      html.getAttribute("placeholder") || "",
      html.getAttribute("name") || "",
      html.id || "",
      html.getAttribute("src") || "",
      html.getAttribute("href") || ""
    ];
    return parts.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function matchesElementFilters(el, tagFilter, keyword, fallbackText = "") {
    if (tagFilter && !tagFilter.has(el.tagName.toLowerCase()))
      return false;
    if (keyword && !elementSearchText(el, fallbackText).includes(keyword))
      return false;
    return true;
  }
  function isDisabled(el) {
    const html = el;
    return html.hasAttribute("disabled") || html.getAttribute("aria-disabled") === "true" || html.closest('[disabled],[aria-disabled="true"]') !== null;
  }
  function hasInteractiveSemantics(el) {
    if (!isHTMLElement(el) || isDisabled(el))
      return false;
    if (el.matches(INTERACTIVE))
      return true;
    if (nameRole(el))
      return true;
    const s = getComputedStyle(el);
    return s.cursor === "pointer";
  }
  function isInsideInteractive(el) {
    const stop = el.ownerDocument.body || el.ownerDocument.documentElement;
    let cur = el;
    while (cur && cur !== stop) {
      if (hasInteractiveSemantics(cur))
        return true;
      cur = cur.parentElement;
    }
    return false;
  }
  function enumerateScanRoots(root) {
    const doc = root.ownerDocument || document;
    const roots = [root];
    const seen = /* @__PURE__ */ new Set([root]);
    const add = (node) => {
      if (!node || seen.has(node))
        return;
      seen.add(node);
      roots.push(node);
    };
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      add(el.shadowRoot);
    }
    return roots;
  }
  function collectCandidatesIn(root, frame) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (el) => {
      if (!isHTMLElement(el) || seen.has(el))
        return;
      seen.add(el);
      if (hasInteractiveSemantics(el) && isVisible(el))
        out.push({ el, frame });
    };
    for (const scanRoot3 of enumerateScanRoots(root)) {
      scanRoot3.querySelectorAll(INTERACTIVE).forEach(add);
      const walker = (scanRoot3.ownerDocument || document).createTreeWalker(scanRoot3, NodeFilter.SHOW_ELEMENT);
      let scanned = 0;
      while (walker.nextNode() && scanned < 6e3) {
        scanned += 1;
        add(walker.currentNode);
      }
    }
    return out;
  }
  function scanScopes(scopeFrame) {
    if (!scopeFrame) {
      return [
        { doc: document },
        ...getAccessibleFrames(cssPath).map((ctx) => ({ doc: ctx.doc, frame: ctx }))
      ];
    }
    const scopes = [{ doc: scopeFrame.doc, frame: scopeFrame }];
    visitAccessibleFrames((ctx) => scopes.push({ doc: ctx.doc, frame: ctx }), cssPath, scopeFrame.doc, scopeFrame);
    return scopes;
  }
  function collectCandidates(scopes) {
    const accessibleFrames = new Set(scopes.map((s) => s.frame?.frameEl).filter(Boolean));
    const all = [];
    for (const scope of scopes) {
      all.push(...collectCandidatesIn(scanRoot(scope.doc), scope.frame));
    }
    return all.filter((item) => !(isFrameElement(item.el) && accessibleFrames.has(item.el)));
  }
  function isStrongControl(el) {
    return el.matches('a[href],button,input:not([type="hidden"]),select,textarea,summary,label[for],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="switch"],[contenteditable=""],[contenteditable="true"]');
  }
  function textRole(el) {
    const explicit = el.getAttribute("role");
    if (explicit)
      return explicit;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag))
      return "heading";
    if (tag === "label")
      return "label";
    if (tag === "li")
      return "listitem";
    if (tag === "th" || tag === "td")
      return "cell";
    if (tag === "p")
      return "paragraph";
    return "text";
  }
  function rectInfo(r) {
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height)
    };
  }
  function centerInfo(r) {
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2)
    };
  }
  function isUsableTextRect(parent, r, frame) {
    if (r.width <= 0 || r.height <= 0)
      return false;
    const center = frame ? elementViewportCenter(parent, frame) : {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2
    };
    if (center.y < 0 || center.x < 0 || center.y > window.innerHeight || center.x > window.innerWidth)
      return false;
    if (frame) {
      return isVisibleInOwnerViewport(parent) && isFrameChainVisible(frame) && isCenterOnMainViewport(frame, parent);
    }
    return isTopmostAtViewport(parent, center.x, center.y);
  }
  function collectVisibleTextsIn(root, limit, frame) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const doc = root.ownerDocument || document;
    const walkText = (scanRoot3) => {
      const walker = doc.createTreeWalker(scanRoot3, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
          if (!text)
            return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || TEXT_NODE_TAGS_TO_SKIP.has(parent.tagName.toLowerCase()))
            return NodeFilter.FILTER_REJECT;
          if (!isVisible(parent) || isInsideInteractive(parent))
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let scanned = 0;
      while (walker.nextNode() && out.length < limit && scanned < 8e3) {
        scanned += 1;
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (!parent || !isVisible(parent))
          continue;
        const text = String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
        if (!text)
          continue;
        const range = doc.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        range.detach();
        const rect = rects.find((r) => isUsableTextRect(parent, r, frame));
        if (!rect)
          continue;
        const selector = cssPath(parent);
        const viewportRect = frame ? elementViewportRect(parent, frame) : rectInfo(rect);
        const viewportCenter = frame ? elementViewportCenter(parent, frame) : centerInfo(rect);
        const rectKey = `${Math.round(viewportRect.x / 4)}:${Math.round(viewportRect.y / 4)}:${Math.round(viewportRect.w / 4)}:${Math.round(viewportRect.h / 4)}`;
        const key = `${selector}|${text}|${rectKey}|${frame?.frameSelector || ""}`;
        if (seen.has(key))
          continue;
        seen.add(key);
        const role = textRole(parent);
        const tag = parent.tagName.toLowerCase();
        out.push({
          kind: "text",
          role,
          tag,
          text,
          selector,
          center: viewportCenter,
          rect: viewportRect,
          ...frame ? { inFrame: true, frameSelector: frame.frameSelector, framePath: buildFramePath(frame) } : {}
        });
      }
    };
    for (const scanRoot3 of enumerateScanRoots(root)) {
      walkText(scanRoot3);
      if (out.length >= limit)
        break;
    }
    return out;
  }
  function collectVisibleTexts(limit, scopes) {
    const out = [];
    for (const scope of scopes) {
      for (const item of collectVisibleTextsIn(scanRoot(scope.doc), limit, scope.frame)) {
        out.push(item);
        if (out.length >= limit)
          return out;
      }
    }
    return out;
  }
  function collectBlockedCandidates(all, hittableSet, scopes) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (el) => {
      if (!isHTMLElement(el) || seen.has(el) || hittableSet.has(el))
        return;
      seen.add(el);
      if (isVisible(el) && (isDisabled(el) || el.matches(CONTROL) || el.matches(INTERACTIVE)))
        out.push(el);
    };
    all.forEach((item) => add(item.el));
    for (const scope of scopes) {
      scanRoot(scope.doc).querySelectorAll(CONTROL).forEach(add);
    }
    return out;
  }
  function collectFrameItems(scopeFrame) {
    const items = [];
    const overlay = [];
    const visit = (doc, parentFrame) => {
      for (const el of listIframeElementsIn(doc)) {
        const base = tryFrameContext(el);
        const localR = el.getBoundingClientRect();
        const rect = parentFrame ? elementViewportRect(el, parentFrame) : rectInfo(localR);
        const center = parentFrame ? elementViewportCenter(el, parentFrame) : centerInfo(localR);
        const selector = cssPath(el);
        const ctx = base ? { ...base, frameSelector: selector, parent: parentFrame } : null;
        const src = el.src || el.getAttribute("src") || "";
        const name = el.name || el.getAttribute("name") || "";
        const title = ctx?.doc.title || "";
        const label = title || name || src || "iframe";
        items.push({
          kind: "frame",
          accessible: !!ctx,
          tag: "iframe",
          role: "document",
          text: ctx ? `iframe (same-origin: ${label})` : "iframe (content not directly accessible from parent \u2014 cross-origin or isolated; \u5176\u5185\u5BB9\u82E5\u53EF\u6CE8\u5165\u4F1A\u4EE5 crossOrigin=true \u7684 items \u5408\u5E76\u8FD4\u56DE)",
          name,
          title,
          src,
          selector,
          frameSelector: selector,
          framePath: ctx ? buildFramePath(ctx) : parentFrame ? [...buildFramePath(parentFrame), selector] : [selector],
          center,
          rect,
          ...parentFrame ? { parentFrameSelector: parentFrame.frameSelector } : {}
        });
        overlay.push({ el, frame: parentFrame });
        if (ctx)
          visit(ctx.doc, ctx);
      }
    };
    if (scopeFrame)
      visit(scopeFrame.doc, scopeFrame);
    else
      visit(document);
    return { items, overlay };
  }
  function accessibleFrameDocUrls() {
    const out = [];
    for (const ctx of getAccessibleFrames(cssPath)) {
      try {
        const href = ctx.doc.location?.href;
        if (href && href !== "about:blank")
          out.push(href);
      } catch {
      }
    }
    return out;
  }
  function elementRecord(el, frame) {
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || implicitRole(el);
    const type = el.type || void 0;
    return {
      el,
      frame,
      tag,
      role,
      type,
      text: textOf(el, 80),
      selector: cssPath(el),
      center: frame ? elementViewportCenter(el, frame) : centerInfo(r),
      rect: frame ? elementViewportRect(el, frame) : rectInfo(r),
      category: elementCategory(el)
    };
  }
  function interactiveItemFromRecord(rec, id) {
    const item = {
      kind: "interactive",
      id,
      tag: rec.tag,
      role: rec.role,
      category: rec.category,
      text: rec.text,
      selector: rec.selector,
      center: rec.center,
      rect: rec.rect
    };
    if (rec.frame) {
      item.inFrame = true;
      item.frameSelector = rec.frame.frameSelector;
      item.framePath = buildFramePath(rec.frame);
    }
    if (rec.type)
      item.type = rec.type;
    if (rec.el.value)
      item.value = String(rec.el.value).slice(0, 60);
    return item;
  }
  function mediaRecord(el, frame) {
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const category = elementCategory(el);
    const src = el.currentSrc || el.src || el.getAttribute("src") || "";
    const alt = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || "";
    return {
      el,
      frame,
      kind: "media",
      category,
      tag,
      role: el.getAttribute("role") || (category === "image" ? "img" : category),
      text: (alt || textOf(el, 80) || src.split("/").pop() || category).slice(0, 120),
      selector: cssPath(el),
      center: frame ? elementViewportCenter(el, frame) : centerInfo(r),
      rect: frame ? elementViewportRect(el, frame) : rectInfo(r),
      ...src ? { src: src.slice(0, 240) } : {}
    };
  }
  function mediaItemFromRecord(rec) {
    const item = {
      kind: "media",
      category: rec.category,
      role: rec.role,
      text: rec.text,
      selector: rec.selector,
      center: rec.center,
      rect: rec.rect
    };
    if (rec.frame) {
      item.inFrame = true;
      item.frameSelector = rec.frame.frameSelector;
      item.framePath = buildFramePath(rec.frame);
    }
    if (rec.src)
      item.src = rec.src;
    return item;
  }
  function collectVisibleMediaIn(root, frame) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (el) => {
      if (!isHTMLElement(el) || seen.has(el))
        return;
      seen.add(el);
      if (!isVisible(el) || isInsideInteractive(el))
        return;
      const r = frame ? elementViewportRect(el, frame) : rectInfo(el.getBoundingClientRect());
      if (r.w <= 0 || r.h <= 0)
        return;
      const center = frame ? elementViewportCenter(el, frame) : centerInfo(el.getBoundingClientRect());
      if (center.y < 0 || center.x < 0 || center.y > window.innerHeight || center.x > window.innerWidth)
        return;
      out.push(mediaRecord(el, frame));
    };
    for (const scanRoot3 of enumerateScanRoots(root)) {
      scanRoot3.querySelectorAll(MEDIA_SELECTOR).forEach(add);
    }
    return out;
  }
  function collectVisibleMedia(scopes) {
    const out = [];
    for (const scope of scopes) {
      out.push(...collectVisibleMediaIn(scanRoot(scope.doc), scope.frame));
    }
    return out;
  }
  function shouldDropNested(child, parent) {
    if (isStrongControl(child))
      return false;
    if (isStrongControl(parent))
      return true;
    const childText = textOf(child, 120);
    const parentText = textOf(parent, 120);
    const childArea = elementArea(child);
    const parentArea = elementArea(parent);
    if (childText && parentText && childText !== parentText)
      return false;
    if (parentArea > 0 && childArea / parentArea < 0.65)
      return false;
    return true;
  }
  var markMutationObservers = [];
  var markAutoClearTimer = null;
  function isOwnMarkNode(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!el?.closest?.(`#${MARK_LAYER_ID},#${MARK_STYLE_ID}`);
  }
  function isPageMutation(records) {
    return records.some((record) => {
      if (isOwnMarkNode(record.target))
        return false;
      return [...record.addedNodes, ...record.removedNodes].some((node) => !isOwnMarkNode(node)) || record.type === "characterData" || record.type === "attributes";
    });
  }
  function stopMarksAutoClear() {
    if (markAutoClearTimer !== null) {
      window.clearTimeout(markAutoClearTimer);
      markAutoClearTimer = null;
    }
    markMutationObservers.forEach((observer) => observer.disconnect());
    markMutationObservers = [];
    MARK_CHANGE_EVENTS.forEach((event) => window.removeEventListener(event, clearMarksOverlay, true));
  }
  function clearMarksOverlay() {
    stopMarksAutoClear();
    document.getElementById(MARK_LAYER_ID)?.remove();
  }
  function watchDocumentForMarkChanges(doc) {
    const root = doc.documentElement || doc.body;
    if (!root)
      return;
    const observer = new MutationObserver((records) => {
      if (isPageMutation(records))
        clearMarksOverlay();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
    markMutationObservers.push(observer);
  }
  function startMarksAutoClear(marks2) {
    stopMarksAutoClear();
    markAutoClearTimer = window.setTimeout(() => {
      markAutoClearTimer = null;
      const docs = /* @__PURE__ */ new Set([document]);
      marks2.forEach((mark) => {
        if (mark.frame?.doc)
          docs.add(mark.frame.doc);
      });
      docs.forEach(watchDocumentForMarkChanges);
      MARK_CHANGE_EVENTS.forEach((event) => window.addEventListener(event, clearMarksOverlay, true));
    }, 150);
  }
  var ITEM_DROP_KEYS = /* @__PURE__ */ new Set(["selector", "rect", "tag"]);
  function slimItem(item) {
    const out = {};
    for (const k of Object.keys(item)) {
      if (ITEM_DROP_KEYS.has(k))
        continue;
      out[k] = item[k];
    }
    return out;
  }
  function itemCategory(item) {
    if (item?.kind === "text")
      return "text";
    if (item?.kind === "frame")
      return "frame";
    return String(item?.category || item?.kind || "other");
  }
  function countItemsByCategory(items) {
    const counts = {};
    for (const item of items) {
      const key = itemCategory(item);
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
  }
  function ensureMarkStyles() {
    let style = document.getElementById(MARK_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = MARK_STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = `
    #${MARK_LAYER_ID} .hs-mark-box{
      position:fixed;box-sizing:border-box;pointer-events:none;
      border:2px solid var(--hs-mark-color);border-radius:4px;
      background:transparent;}
    #${MARK_LAYER_ID} .hs-mark-clickable{--hs-mark-color:rgba(34,197,94,.92);}
    #${MARK_LAYER_ID} .hs-mark-blocked{--hs-mark-color:rgba(239,68,68,.92);}
    #${MARK_LAYER_ID} .hs-mark-frame{--hs-mark-color:rgba(168,85,247,.88);border-style:dashed;}`;
  }
  function drawMarksOverlay(marks2) {
    clearMarksOverlay();
    ensureMarkStyles();
    const layer = document.createElement("div");
    layer.id = MARK_LAYER_ID;
    layer.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483646;pointer-events:none;";
    marks2.forEach(({ el, status, frame }) => {
      const rect = frame ? elementViewportRect(el, frame) : rectInfo(el.getBoundingClientRect());
      const box = document.createElement("div");
      box.className = `hs-mark-box hs-mark-${status}`;
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${Math.max(0, rect.w)}px`;
      box.style.height = `${Math.max(0, rect.h)}px`;
      layer.appendChild(box);
    });
    document.documentElement.appendChild(layer);
    startMarksAutoClear(marks2);
  }
  function doObserve(msg) {
    clearMarksOverlay();
    const limit = Math.min(Math.max(Number(msg.limit ?? 120), 1), 200);
    const includeText = msg.include_text !== false;
    const textLimit = Math.min(Math.max(Number(msg.text_limit ?? 200), 0), 500);
    const defaultMaxItems = includeText ? Math.min(500, limit + textLimit + 40) : limit;
    const maxItems = Math.min(Math.max(Number(msg.max_items ?? defaultMaxItems), 1), 500);
    const categoryFilter = parseFilter(msg.filter);
    const tagFilter = parseTagFilter(msg.tag ?? msg.tags);
    const keyword = parseKeyword(msg.keyword ?? msg.query ?? msg.text_filter);
    const wantText = !categoryFilter || categoryFilter.has("text");
    const wantFrame = !categoryFilter || categoryFilter.has("frame");
    const wantsScope = !!(msg.frame || msg.frame_selector || Array.isArray(msg.frame_path) && msg.frame_path.length);
    const scopeFrame = wantsScope ? resolveFrameBySelector(msg.frame ?? msg.frame_selector, msg.frame_path) : null;
    if (wantsScope && !scopeFrame) {
      throw new Error(`Frame not found or not accessible: ${msg.frame || msg.frame_selector || (msg.frame_path || []).join(" > ")} \u2014 \u7528 browser_observe {filter:"frame"} \u67E5\u770B\u53EF\u7528 iframe \u7684 frameSelector/framePath\u3002`);
    }
    const scopes = scanScopes(scopeFrame);
    const all = collectCandidates(scopes);
    const iframeCandidates = all.filter((item) => item.frame);
    const isItemHittable = (item) => item.frame ? isLikelyInteractableInFrame(item.el, item.frame) : isHittable(item.el);
    const hittable = all.filter(isItemHittable);
    const iframeHittable = hittable.filter((item) => item.frame);
    const set = new Set(hittable.map((item) => item.el));
    const blockedForMarks = collectBlockedCandidates(all, set, scopes);
    const frameScan = collectFrameItems(scopeFrame);
    const frameItems = wantFrame ? frameScan.items.filter((frame) => (!tagFilter || tagFilter.has("iframe")) && (!keyword || [frame.text, frame.name, frame.title, frame.src].join(" ").toLowerCase().includes(keyword))) : [];
    const frameOverlay = wantFrame ? frameScan.overlay : [];
    const frameChildCounts = /* @__PURE__ */ new Map();
    for (const item of all) {
      if (!item.frame)
        continue;
      const key = buildFramePath(item.frame).join(">");
      frameChildCounts.set(key, (frameChildCounts.get(key) || 0) + 1);
    }
    const pruned = hittable.filter((item) => {
      let p = item.el.parentElement;
      while (p) {
        if (set.has(p) && shouldDropNested(item.el, p))
          return false;
        p = p.parentElement;
      }
      return true;
    });
    const interactiveRecords = pruned.map((item) => elementRecord(item.el, item.frame)).filter((rec) => interactiveCategoryAllowed(rec.category, categoryFilter)).filter((rec) => matchesElementFilters(rec.el, tagFilter, keyword, rec.text));
    interactiveRecords.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    const slicedRecords = interactiveRecords.slice(0, limit);
    const mediaRecords = !categoryFilter || categoryFilter.has("media") || categoryFilter.has("image") || categoryFilter.has("video") || categoryFilter.has("audio") ? collectVisibleMedia(scopes).filter((rec) => mediaCategoryAllowed(rec.category, categoryFilter)).filter((rec) => matchesElementFilters(rec.el, tagFilter, keyword, rec.text)).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x) : [];
    const overlayMarks = [];
    const markTargets = [];
    let nextId = 1;
    const elements = [];
    const interactiveItems = slicedRecords.map((rec) => {
      const id = nextId;
      nextId += 1;
      markTargets.push({
        el: rec.el,
        selector: rec.selector,
        text: rec.text,
        center: rec.center,
        frameSelector: rec.frame?.frameSelector,
        framePath: rec.frame ? buildFramePath(rec.frame) : void 0
      });
      const item = interactiveItemFromRecord(rec, id);
      elements.push(item);
      overlayMarks.push({ el: rec.el, status: "clickable", frame: rec.frame });
      return item;
    });
    const rawTexts = includeText && wantText ? collectVisibleTexts(textLimit, scopes).filter((t) => (!tagFilter || tagFilter.has(String(t.tag || "").toLowerCase())) && (!keyword || String(t.text || "").toLowerCase().includes(keyword))) : [];
    const iframeTextCount = rawTexts.filter((t) => t.inFrame).length;
    const iframeTexts = rawTexts.filter((t) => t.inFrame);
    for (const frame of frameItems) {
      if (!frame.accessible)
        continue;
      const key = (frame.framePath || [frame.frameSelector]).join(">");
      frame.interactiveCount = frameChildCounts.get(key) || 0;
      const pathKey = (frame.framePath || []).join(">");
      const samples = iframeTexts.filter((t) => (t.framePath || []).join(">") === pathKey || t.frameSelector === frame.frameSelector).slice(0, 5).map((t) => ({ text: t.text, selector: t.selector, center: t.center }));
      if (samples.length)
        frame.textSamples = samples;
      frame.textCount = iframeTexts.filter((t) => (t.framePath || []).join(">") === pathKey || t.frameSelector === frame.frameSelector).length;
      if (!frame.interactiveCount && !samples.length) {
        frame.scanNote = "iframe \u5185\u672A\u626B\u63CF\u5230\u53EF\u4EA4\u4E92\u63A7\u4EF6\u6216\u53EF\u89C1\u6587\u672C\uFF1B\u53EF\u80FD\u4E3A\u7EAF\u6E32\u67D3\u9884\u89C8\u3001\u5D4C\u5957\u8DE8\u57DF iframe\uFF0C\u6216\u5185\u5BB9\u5C1A\u672A\u52A0\u8F7D\u5B8C\u6210";
      } else if (!frame.interactiveCount) {
        frame.scanNote = "iframe \u5185\u4EC5\u6709\u53EF\u89C1\u6587\u672C\uFF0C\u65E0\u53EF\u4EA4\u4E92\u63A7\u4EF6\uFF1B\u53D1\u5E03/\u6295\u7A3F\u6309\u94AE\u901A\u5E38\u5728\u4E3B\u9875\u9762 items \u4E2D\uFF08inFrame=false\uFF09";
      }
    }
    const textItems = rawTexts.map((t) => ({
      kind: "text",
      role: t.role,
      tag: t.tag,
      text: t.text,
      selector: t.selector,
      center: t.center,
      rect: t.rect,
      ...t.inFrame ? { inFrame: true, frameSelector: t.frameSelector, framePath: t.framePath } : {}
    }));
    textItems.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    const mediaItems = mediaRecords.map(mediaItemFromRecord);
    const candidateItems = [...textItems, ...frameItems, ...mediaItems, ...interactiveRecords.map((rec, i) => interactiveItemFromRecord(rec, i + 1))].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || kindSortRank(a.kind) - kindSortRank(b.kind));
    const categoryCounts = countItemsByCategory(candidateItems);
    const tooMany = interactiveRecords.length > limit || candidateItems.length > maxItems;
    if (tooMany && msg.allow_truncate !== true) {
      setMarks([]);
      const ctx2 = viewportContext();
      return {
        success: true,
        source: "browser_observe",
        url: location.href,
        title: document.title,
        count: 0,
        textCount: 0,
        itemCount: candidateItems.length,
        frameCount: frameItems.length,
        tooMany: true,
        overLimit: true,
        maxItems,
        categoryCounts,
        stats: {
          candidates: all.length,
          hittable: hittable.length,
          afterDedupe: pruned.length,
          blocked: blockedForMarks.length,
          limit,
          maxItems,
          textLimit,
          includeText,
          filter: categoryFilter ? Array.from(categoryFilter) : null,
          tag: tagFilter ? Array.from(tagFilter) : null,
          keyword: keyword || null,
          media: mediaRecords.length,
          frames: frameItems.length,
          accessibleFrames: frameItems.filter((f) => f.accessible).length,
          iframeCandidates: iframeCandidates.length,
          iframeHittable: iframeHittable.length
        },
        marked: false,
        scroll: { y: ctx2.scrollY, percent: ctx2.scrollPercent, atTop: ctx2.atTop, atBottom: ctx2.atBottom },
        currentSection: ctx2.currentSection,
        ...scopeFrame ? { scopedToFrame: buildFramePath(scopeFrame) } : {},
        items: [],
        hint: `\u5F53\u524D observe \u5339\u914D\u5230 ${candidateItems.length} \u4E2A\u6761\u76EE\uFF08\u53EF\u4EA4\u4E92 ${interactiveRecords.length} \u4E2A\uFF09\uFF0C\u8D85\u8FC7 limit=${limit} \u6216 max_items=${maxItems}\uFF0C\u4E3A\u907F\u514D\u8FD4\u56DE\u8FC7\u591A\u5185\u5BB9\u5DF2\u4E0D\u8FD4\u56DE items\u3002\u8BF7\u4F7F\u7528 filter\uFF08button/link/input/image/video/text/frame \u7B49\uFF09\u3001tag/tags\u3001keyword\uFF0C\u6216\u63D0\u9AD8 limit/max_items\uFF1B\u4E5F\u53EF\u4F20 frame\uFF08iframe \u7684 frameSelector\uFF09\u6216 frame_path \u53EA\u89C2\u5BDF\u67D0\u4E2A iframe \u5185\u90E8\uFF1BcategoryCounts \u7ED9\u51FA\u4E86\u5404\u7C7B\u522B\u6570\u91CF\u3002`
      };
    }
    const items = [...textItems, ...frameItems, ...mediaItems, ...interactiveItems].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || kindSortRank(a.kind) - kindSortRank(b.kind));
    const texts = textItems;
    setMarks(markTargets);
    const blockedChosen = blockedForMarks.filter((el) => interactiveCategoryAllowed(elementCategory(el), categoryFilter)).slice(0, limit);
    const marked = msg.mark !== false;
    if (marked) {
      drawMarksOverlay([
        ...frameOverlay.map(({ el, frame }) => ({ el, status: "frame", frame })),
        ...overlayMarks,
        ...blockedChosen.map((el) => ({ el, status: "blocked" }))
      ]);
    }
    const ctx = viewportContext();
    const filterHint = categoryFilter ? ` \u5DF2\u6309 filter=[${Array.from(categoryFilter).join(",")}] \u8FC7\u6EE4\uFF1A\u53EA\u8FD4\u56DE\u8FD9\u4E9B\u7C7B\u522B\uFF08interactive \u9879\u7684 category \u5B57\u6BB5\u6807\u660E\u7C7B\u522B\uFF1Abutton/link/input/select/checkbox/radio/tab/menuitem/option/label/other\uFF1Bmedia \u9879 category=image/video/audio\uFF1Btext=\u666E\u901A\u6587\u672C\uFF0Cframe=iframe \u8FB9\u754C\uFF09\u3002` : "";
    const queryHint = [
      tagFilter ? `tag=[${Array.from(tagFilter).join(",")}]` : "",
      keyword ? `keyword="${keyword}"` : ""
    ].filter(Boolean).join(" ");
    const markHint = marked ? " \u9875\u9762\u6807\u8BB0\uFF1A\u7D2B\u8272\u865A\u7EBF=iframe \u8FB9\u754C\uFF0C\u7EFF\u8272=\u53EF\u70B9\u51FB\uFF0C\u7EA2\u8272=\u4E0D\u53EF\u70B9\u51FB/\u88AB\u7981\u7528/\u88AB\u906E\u6321\u3002" : "";
    return {
      success: true,
      source: "browser_observe",
      url: location.href,
      title: document.title,
      count: elements.length,
      textCount: texts.length,
      itemCount: items.length,
      frameCount: frameItems.length,
      accessibleFrameCount: frameItems.filter((f) => f.accessible).length,
      accessibleFrameUrls: accessibleFrameDocUrls(),
      iframeCandidates: iframeCandidates.length,
      iframeHittable: iframeHittable.length,
      iframeTextCount,
      stats: {
        candidates: all.length,
        hittable: hittable.length,
        afterDedupe: pruned.length,
        blocked: blockedForMarks.length,
        limit,
        textLimit,
        includeText,
        filter: categoryFilter ? Array.from(categoryFilter) : null,
        tag: tagFilter ? Array.from(tagFilter) : null,
        keyword: keyword || null,
        media: mediaRecords.length,
        frames: frameItems.length,
        accessibleFrames: frameItems.filter((f) => f.accessible).length,
        iframeCandidates: iframeCandidates.length,
        iframeHittable: iframeHittable.length
      },
      truncated: interactiveRecords.length > slicedRecords.length,
      textTruncated: includeText && rawTexts.length >= textLimit,
      tooMany: false,
      maxItems,
      categoryCounts,
      marked,
      scroll: { y: ctx.scrollY, percent: ctx.scrollPercent, atTop: ctx.atTop, atBottom: ctx.atBottom },
      currentSection: ctx.currentSection,
      ...scopeFrame ? { scopedToFrame: buildFramePath(scopeFrame) } : {},
      items: items.map(slimItem),
      hint: '\u8FD4\u56DE items \u5355\u4E00\u6DF7\u6392\u5217\u8868\uFF08\u6309\u4F4D\u7F6E\u6392\u5E8F\uFF0C\u5DF2\u53BB\u91CD\u2014\u2014\u4E0D\u518D\u5355\u72EC\u8FD4\u56DE texts/elements/frames\uFF0C\u5168\u90E8\u5185\u5BB9\u90FD\u5728 items \u91CC\uFF0C\u7528 kind \u533A\u5206\uFF09\uFF1Akind=text \u53EF\u89C1\u6587\u672C\uFF08\u4E0D\u53EF\u70B9\u51FB\uFF09\uFF0Ckind=media \u56FE\u7247/\u89C6\u9891/\u97F3\u9891\uFF08\u4E0D\u53EF\u70B9\u51FB\uFF1Bcategory=image/video/audio\uFF09\uFF0Ckind=frame \u9875\u9762\u5185 iframe \u8FB9\u754C\uFF08accessible=true \u8868\u793A\u540C\u6E90\u5DF2\u626B\u63CF\uFF0C\u5B50\u5143\u7D20\u89C1 inFrame=true \u7684 interactive\uFF1Baccessible=false \u4E3A\u8DE8\u57DF\u4E0D\u53EF\u7528\u5750\u6807\u70B9\u51FB\uFF09\uFF0Ckind=interactive \u53EF\u70B9\u51FB\u5143\u7D20\uFF08\u6BCF\u4E2A\u5E26\u72EC\u7ACB id\uFF0C\u7528 browser_action {action:"click", ref:id} \u70B9\u51FB\uFF09\u3002 \u4E3A\u8282\u7701\u4E0A\u4E0B\u6587\u6BCF\u6761\u5DF2\u7701\u7565 selector/rect/tag\uFF0C\u4EC5\u4FDD\u7559 role/category/text/center\uFF1BinFrame=true \u8868\u793A\u5143\u7D20\u5728\u540C\u6E90 iframe \u5185\uFF0CframeSelector \u6307\u5411\u6240\u5C5E iframe\u3002 \u52FF\u4F7F\u7528 Playwright \u8BED\u6CD5\uFF08\u5982 :has-text\uFF09\uFF1B\u7528 text \u53C2\u6570\u6216 observe \u8FD4\u56DE\u7684 ref \u5B9A\u4F4D\u3002' + filterHint + (queryHint ? ` \u5DF2\u6309 ${queryHint} \u7B5B\u9009\u3002` : "") + markHint
    };
  }
  function kindSortRank(kind) {
    if (kind === "text")
      return 0;
    if (kind === "media")
      return 1;
    if (kind === "frame")
      return 2;
    return 3;
  }

  // src/content/index.ts
  if (!window.__hsContentLoaded) {
    window.__hsContentLoaded = true;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      handleAction(msg).then(sendResponse).catch((err) => sendResponse({
        success: false,
        error: {
          message: err.message || String(err),
          code: err.code || "CONTENT_ACTION_FAILED",
          suggestion: err.suggestion || "Check the selector, page state, and whether the target element is visible/interactable."
        },
        trace: msg?.trace ? { action: msg.action, args: msg } : void 0
      }));
      return true;
    });
  }
  async function handleAction(msg) {
    switch (msg.action) {
      case "click":
        return doClick(msg);
      case "double_click":
        return doDoubleClick(msg);
      case "right_click":
        return doRightClick(msg);
      case "drag":
        return doDrag(msg);
      case "press_key":
        return doPressKey(msg);
      case "focus_target":
        return focusTarget(msg);
      case "find_popups":
        return doFindPopups(msg);
      case "close_popup":
        return doClosePopup(msg);
      case "page_info":
        return doPageInfo();
      case "observe":
        return doObserve(msg);
      case "clear_marks":
        clearMarksOverlay();
        return { success: true };
      case "type":
        return doType(msg);
      case "get_content":
        return getContent(msg);
      case "scroll":
        return doScroll(msg);
      case "wait":
        return doWait(msg);
      case "await_settle":
        return doAwaitSettle(msg);
      case "evaluate":
        return doEvaluate(msg);
      case "extract":
        return doExtract(msg);
      case "find_text":
        return findText(msg);
      case "fill_form":
        return fillForm(msg);
      case "dom_snapshot":
        return domSnapshot(msg);
      case "iframe_list":
        return iframeList();
      case "performance":
        return performanceInfo();
      case "screenshot_target_info":
        return screenshotTargetInfo(msg);
      case "screenshot_fx":
        return doScreenshotFx(msg);
      case "file_upload":
        return fileUpload(msg);
      case "select":
        return doSelect(msg);
      case "hover":
        return doHover(msg);
      case "storage_get":
        return storageGet(msg);
      case "storage_set":
        return storageSet(msg);
      case "storage_remove":
        return storageRemove(msg);
      case "storage_list":
        return storageList(msg);
      default:
        throw new Error(`Unknown content action: ${msg.action}`);
    }
  }
})();
