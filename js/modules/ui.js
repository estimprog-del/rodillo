/* ui.js - Funciones de manipulación de interfaz */

let _openModalCount = 0;

export function showModal(modalId) {
  const id = modalId.startsWith("modal-") ? modalId : `modal-${modalId}`;
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("active");
    _openModalCount++;
    document.body.style.overflow = "hidden";
  }
}

export function hideModal(modalId) {
  const id = modalId.startsWith("modal-") ? modalId : `modal-${modalId}`;
  const modal = document.getElementById(id);
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

export function isMobileViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

export function isTouchDevice() {
  return (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
}

export function isMobilePortrait() {
  return (
    isMobileViewport() && window.matchMedia("(orientation: portrait)").matches
  );
}

export function isSmallMobile() {
  return window.matchMedia("(max-width: 480px)").matches;
}

// Teléfono/tableta pequeña en horizontal: ventana baja y estrecha.
// Coincide con el bloque @media (max-height: 560px) and (max-width: 1100px)
// de styles/workout.css.
export function isPhoneLandscape() {
  return (
    window.innerHeight <= 560 &&
    window.innerWidth <= 1100 &&
    window.innerWidth > window.innerHeight
  );
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
