/**
 * toast.js - Sistema de notificaciones toast para RodilloInt
 * Reemplaza alert() y confirm() nativos del navegador.
 */

let _toastContainer = null;

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement("div");
    _toastContainer.id = "toast-container";
    _toastContainer.setAttribute("aria-live", "polite");
    _toastContainer.setAttribute("aria-atomic", "false");
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

/**
 * Muestra un toast no bloqueante.
 * @param {string} message   Texto del mensaje
 * @param {"info"|"success"|"warning"|"error"} type  Tipo de toast
 * @param {number} duration  Duración en ms (0 = permanente hasta cerrar)
 */
export function showToast(message, type = "info", duration = 4000) {
  const container = getToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "alert");

  const icons = { info: "ℹ️", success: "✅", warning: "⚠️", error: "❌" };

  toast.innerHTML =
    `<span class="toast-icon">${icons[type] ?? "ℹ️"}</span>` +
    `<span class="toast-message">${escapeToastHtml(message)}</span>` +
    `<button class="toast-close" aria-label="Cerrar">×</button>`;

  toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));

  container.appendChild(toast);

  // Forzar reflow para animar entrada
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("toast-visible"));
  });

  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }

  return toast;
}

function dismissToast(toast) {
  toast.classList.remove("toast-visible");
  toast.classList.add("toast-hiding");
  toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  // Fallback por si transitionend no dispara
  setTimeout(() => toast.remove(), 400);
}

/**
 * Reemplaza confirm() nativo con un diálogo modal no bloqueante.
 * @param {string} message    Texto de la pregunta
 * @param {string} confirmText  Texto del botón afirmativo
 * @param {"danger"|"primary"} confirmStyle  Estilo del botón
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, confirmText = "Aceptar", confirmStyle = "danger") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "toast-confirm-overlay";

    overlay.innerHTML =
      `<div class="toast-confirm-box" role="dialog" aria-modal="true">` +
        `<p class="toast-confirm-message">${escapeToastHtml(message)}</p>` +
        `<div class="toast-confirm-actions">` +
          `<button class="toast-btn toast-btn-cancel">Cancelar</button>` +
          `<button class="toast-btn toast-btn-confirm toast-btn-${confirmStyle}">${escapeToastHtml(confirmText)}</button>` +
        `</div>` +
      `</div>`;

    function close(result) {
      overlay.classList.add("toast-confirm-hiding");
      overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
      setTimeout(() => overlay.remove(), 350);
      resolve(result);
    }

    overlay.querySelector(".toast-btn-cancel").addEventListener("click", () => close(false));
    overlay.querySelector(".toast-btn-confirm").addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add("toast-confirm-visible"));
    });

    // Focus en botón cancelar por seguridad
    setTimeout(() => overlay.querySelector(".toast-btn-cancel")?.focus(), 50);
  });
}

function escapeToastHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Exponer globalmente para uso desde app.js (módulos separados)
window.showToast = showToast;
window.showConfirm = showConfirm;
