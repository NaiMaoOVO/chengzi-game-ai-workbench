function readProjectSlots(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function getOccupiedSlotIndexes(slots) {
  if (!Array.isArray(slots)) return [];
  return slots.reduce((occupied, slot, index) => {
    if (slot && typeof slot === "object") occupied.push(index + 1);
    return occupied;
  }, []);
}

function sanitizeProjectSlots(slots) {
  if (!Array.isArray(slots)) return [];
  return slots.map((data) => (
    data && typeof data === "object" && data.controls && typeof data.controls === "object" ? data : null
  ));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { readProjectSlots, getOccupiedSlotIndexes, sanitizeProjectSlots };
}
