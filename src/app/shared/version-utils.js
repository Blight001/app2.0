(function initAiFreeVersionUtils(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.AiFreeVersionUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createVersionUtils() {
  function stripVersionPrefix(value) {
    return String(value || '').trim().replace(/^v/i, '');
  }

  function normalizeVersion(value) {
    const text = stripVersionPrefix(value);
    if (!text) return { parts: [0], preRelease: '' };

    const [mainPart, preRelease = ''] = text.split('-', 2);
    const parts = mainPart
      .split('.')
      .map((segment) => Number.parseInt(segment, 10))
      .map((num) => (Number.isFinite(num) ? num : 0));

    while (parts.length > 1 && parts[parts.length - 1] === 0) {
      parts.pop();
    }

    return { parts, preRelease };
  }

  function compareVersions(left, right) {
    const a = normalizeVersion(left);
    const b = normalizeVersion(right);
    const maxLen = Math.max(a.parts.length, b.parts.length);

    for (let i = 0; i < maxLen; i += 1) {
      const av = a.parts[i] || 0;
      const bv = b.parts[i] || 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }

    if (a.preRelease && !b.preRelease) return -1;
    if (!a.preRelease && b.preRelease) return 1;
    if (a.preRelease && b.preRelease && a.preRelease !== b.preRelease) {
      return a.preRelease > b.preRelease ? 1 : -1;
    }

    return 0;
  }

  return {
    stripVersionPrefix,
    normalizeVersion,
    compareVersions,
  };
});
