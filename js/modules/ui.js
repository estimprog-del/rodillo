/* ui.js - Funciones de manipulación de interfaz */

let _openModalCount = 0;

export function showModal(modalId) {
  const modal = document.getElementById(`modal-${modalId}`);
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("active");
    _openModalCount++;
    document.body.style.overflow = "hidden";
  }
}

export function hideModal(modalId) {
  const modal = document.getElementById(`modal-${modalId}`);
  if (modal) {
    modal.style.display = "none";
    modal.classList.remove("active");
    _openModalCount = Math.max(0, _openModalCount - 1);
    if (_openModalCount === 0) {
      document.body.style.overflow = "";
    }
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
