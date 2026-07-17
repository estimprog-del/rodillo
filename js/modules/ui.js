/* ui.js - Funciones de manipulación de interfaz */

export function showModal(modalId) {
  const modal = document.getElementById(`modal-${modalId}`);
  if (modal) {
    modal.style.display = "flex"; // Forzamos visibilidad
    modal.className = "modal-overlay active";
  }
}

export function hideModal(modalId) {
  const modal = document.getElementById(`modal-${modalId}`);
  if (modal) {
    modal.style.display = "none";
    modal.className = "modal-overlay";
  }
}

export function setElDisplay(id, display) {
  const el = document.getElementById(id);
  if (el) el.style.display = display;
}

export function setElText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// Throttled HUD update
const UI_UPDATE_RATE = 250;
let lastUiUpdate = 0;

export function safeSetText(id, text) {
  const now = Date.now();
  if (now - lastUiUpdate > UI_UPDATE_RATE) {
    setElText(id, text);
    lastUiUpdate = now;
  }
}
