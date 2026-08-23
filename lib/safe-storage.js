function readStorageArray(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { readStorageArray };
}
