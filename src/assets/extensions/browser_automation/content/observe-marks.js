// content/observe-marks.js — browser_observe 原生标记叠加层及自动清理。
'use strict';

var markMutationObservers = [];
var markAutoClearTimer = null;

function isOwnMarkNode(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!(el && el.closest && el.closest(`#${MARK_LAYER_ID},#${MARK_STYLE_ID}`));
}
function isPageMutation(records) {
    return records.some((record) => {
        if (isOwnMarkNode(record.target)) return false;
        return [...record.addedNodes, ...record.removedNodes].some((node) => !isOwnMarkNode(node))
            || record.type === 'characterData' || record.type === 'attributes';
    });
}
function stopMarksAutoClear() {
    if (markAutoClearTimer !== null) { window.clearTimeout(markAutoClearTimer); markAutoClearTimer = null; }
    markMutationObservers.forEach((observer) => observer.disconnect());
    markMutationObservers = [];
    MARK_CHANGE_EVENTS.forEach((event) => window.removeEventListener(event, clearMarksOverlay, true));
}
function clearMarksOverlay() {
    stopMarksAutoClear();
    const existing = document.getElementById(MARK_LAYER_ID);
    if (existing) existing.remove();
}
function watchDocumentForMarkChanges(doc) {
    const root = doc.documentElement || doc.body;
    if (!root) return;
    const observer = new MutationObserver((records) => { if (isPageMutation(records)) clearMarksOverlay(); });
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    markMutationObservers.push(observer);
}
function startMarksAutoClear(marksList) {
    stopMarksAutoClear();
    markAutoClearTimer = window.setTimeout(() => {
        markAutoClearTimer = null;
        const docs = new Set([document]);
        marksList.forEach((mark) => { if (mark.frame && mark.frame.doc) docs.add(mark.frame.doc); });
        docs.forEach(watchDocumentForMarkChanges);
        MARK_CHANGE_EVENTS.forEach((event) => window.addEventListener(event, clearMarksOverlay, true));
    }, 150);
}
function ensureMarkStyles() {
    let style = document.getElementById(MARK_STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = MARK_STYLE_ID;
        document.documentElement.appendChild(style);
    }
    style.textContent = `
        #${MARK_LAYER_ID} .hs-mark-box{position:fixed;box-sizing:border-box;pointer-events:none;
          border:2px solid var(--hs-mark-color);border-radius:4px;background:transparent;}
        #${MARK_LAYER_ID} .hs-mark-clickable{--hs-mark-color:rgba(34,197,94,.92);}
        #${MARK_LAYER_ID} .hs-mark-blocked{--hs-mark-color:rgba(239,68,68,.92);}
        #${MARK_LAYER_ID} .hs-mark-frame{--hs-mark-color:rgba(168,85,247,.88);border-style:dashed;}`;
}
function drawMarksOverlay(marksList) {
    clearMarksOverlay();
    ensureMarkStyles();
    const layer = document.createElement('div');
    layer.id = MARK_LAYER_ID;
    layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483646;pointer-events:none;';
    marksList.forEach(({ el, status, frame }) => {
        const rect = frame ? elementViewportRect(el, frame) : rectInfo(el.getBoundingClientRect());
        const box = document.createElement('div');
        box.className = `hs-mark-box hs-mark-${status}`;
        box.style.left = `${rect.x}px`;
        box.style.top = `${rect.y}px`;
        box.style.width = `${Math.max(0, rect.w)}px`;
        box.style.height = `${Math.max(0, rect.h)}px`;
        layer.appendChild(box);
    });
    document.documentElement.appendChild(layer);
    startMarksAutoClear(marksList);
}
