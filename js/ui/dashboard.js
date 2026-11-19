// js/ui/dashboard.js
import { state as globalState } from "../modules/state.js";
import { isAvatarDataUrl } from "../utils/imageUtils.js";

export function loadDashboardHeader(customState) {
  const state = customState || globalState;
  if (!state || !state.currentUser) return;

  const user = state.currentUser;
  const nameEl = document.getElementById("dashboard-user-name");
  const name = typeof user.name === "string" ? user.name : "";
  if (nameEl) nameEl.textContent = name;

  const headerEl = document.getElementById("active-profile-header");
  if (!headerEl) return;

  const avatarContainer = headerEl.querySelector(".avatar-small");
  if (!avatarContainer) return;

  const avatarSrc = user.avatarUrl || user.imageUri;
  if (isAvatarDataUrl(avatarSrc)) {
    const image = document.createElement("img");
    image.src = avatarSrc;
    image.alt = `Avatar de ${name}`;
    image.className = "avatar-img";
    avatarContainer.replaceChildren(image);
  } else {
    const initials = name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    avatarContainer.textContent = initials;
  }
}
