// js/ui/dashboard.js

export function loadDashboardHeader(state) {
  if (!state.currentUser) return;
  document.getElementById("dashboard-user-name").textContent =
    state.currentUser.name;

  const initials = state.currentUser.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  document
    .getElementById("active-profile-header")
    .querySelector(".avatar-small").textContent = initials;
}
