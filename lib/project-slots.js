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

function inspectProjectSlots(raw) {
  if (raw === null || raw === undefined || raw === "") return { slots: [], issue: "" };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    return { slots: [], issue: "invalid-json" };
  }

  if (!isValidProjectSlots(parsed)) {
    return { slots: Array.isArray(parsed) ? sanitizeProjectSlots(parsed) : [], issue: "invalid-shape" };
  }
  return { slots: sanitizeProjectSlots(parsed), issue: "" };
}

function isValidProjectSlots(slots) {
  return Array.isArray(slots) && slots.every((slot) => slot === null
    || Boolean(slot
      && typeof slot === "object"
      && !Array.isArray(slot)
      && slot.controls
      && typeof slot.controls === "object"
      && !Array.isArray(slot.controls)));
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
  module.exports = { readProjectSlots, inspectProjectSlots, isValidProjectSlots, getOccupiedSlotIndexes, sanitizeProjectSlots, sanitizeProjectState, shouldPersistProjectControl };
}
