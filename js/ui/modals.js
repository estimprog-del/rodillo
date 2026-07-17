import { showModal, hideModal } from "../modules/ui.js";
import { state, saveStateToLocalStorage } from "../modules/state.js";

/**
 * UI Modal Manager
 * Encapsulates showing and hiding application modals
 */

export function openAddUserModal() {
  showModal("add-user");
}

export function closeAddUserModal() {
  hideModal("add-user");
}

export function openImportUserModal() {
  showModal("import-user");
}

export function closeImportUserModal() {
  hideModal("import-user");
}

export function openEditUserModal() {
  showModal("edit-user");
}

export function closeEditUserModal() {
  hideModal("edit-user");
}

export function openRouteModal() {
  const routeModal = document.getElementById("route-modal");
  if (routeModal) {
    routeModal.classList.add("active");

    const realismSlider = document.getElementById("realism-slider");
    const realismValueSpan = document.getElementById("realism-value");

    if (realismSlider && realismValueSpan) {
      realismSlider.value = Math.round(state.realismFactor * 100); // Guardado como 0.3-1.5, mostrado como 30-150%
      realismValueSpan.textContent = `${realismSlider.value}%`;

      realismSlider.oninput = (e) => {
        const value = e.target.value;
        realismValueSpan.textContent = `${value}%`;
        state.realismFactor = parseFloat(value) / 100;
        saveStateToLocalStorage();
      };
    }
  }
}

export function closeRouteModal() {
  const routeModal = document.getElementById("route-modal");
  if (routeModal) routeModal.classList.remove("active");
}

export function openRadarOverlay() {
  const radar = document.getElementById("radar-scan-overlay");
  if (radar) radar.classList.add("active");
}

export function openSettingsModal() {
  showModal("settings");
}

export function closeSettingsModal() {
  hideModal("settings");
}
