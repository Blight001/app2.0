(() => {
  // src/shadow-patch.ts
  (() => {
    const proto = Element.prototype;
    if (proto.__heysureShadowPatched)
      return;
    const native = proto.attachShadow;
    if (typeof native !== "function")
      return;
    proto.attachShadow = function(init) {
      const opts = { ...init || {}, mode: "open" };
      return native.call(this, opts);
    };
    proto.__heysureShadowPatched = true;
  })();
})();
