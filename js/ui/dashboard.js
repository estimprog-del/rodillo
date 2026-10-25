// js/ui/dashboard.js
import { state as globalState } from "../modules/state.js";

export function loadDashboardHeader(customState) {
  const state = customState || globalState;
  if (!state || !state.currentUser) return;

  const user = state.currentUser;
  const nameEl = document.getElementById("dashboard-user-name");
  if (nameEl) nameEl.textContent = user.name;

  const headerEl = document.getElementById("active-profile-header");
  if (!headerEl) return;

  const avatarContainer = headerEl.querySelector(".avatar-small");
  if (!avatarContainer) return;

  const avatarSrc = user.avatarUrl || user.imageUri;
  if (avatarSrc) {
    avatarContainer.innerHTML = `<img src="${avatarSrc}" alt="${user.name}" class="avatar-img" />`;
  } else {
    const initials = user.name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    avatarContainer.textContent = initials;
  }
}
