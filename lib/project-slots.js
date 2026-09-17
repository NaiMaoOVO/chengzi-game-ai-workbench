const ARCHIVE_AUTH_CONTROL_IDS = new Set(["archive-login-username", "archive-login-password"]);

function shouldPersistProjectControl(control) {
  return Boolean(control?.id)
    && control.type !== "file"
    && control.type !== "password"
    && !ARCHIVE_AUTH_CONTROL_IDS.has(control.id);
}

function sanitizeProjectState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || !state.controls || typeof state.controls !== "object") return state;
  const controls = { ...state.controls };
  let changed = false;
  for (const id of ARCHIVE_AUTH_CONTROL_IDS) {
    if (id in controls) {
      delete controls[id];
      changed = true;
    }
  }
  return changed ? { ...state, controls } : state;
}

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
    data && typeof data === "object" && data.controls && typeof data.controls === "object" ? sanitizeProjectState(data) : null
  ));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { readProjectSlots, getOccupiedSlotIndexes, sanitizeProjectSlots, sanitizeProjectState, shouldPersistProjectControl };
}
