// js/ui/workoutHud.js - Gestión de la interfaz del entrenamiento (HUD, diseño, paneles y pantalla completa)
import { state, saveStateToLocalStorage } from "../modules/state.js";
import { setElText, setElDisplay, showModal, hideModal } from "../modules/ui.js";
import { showToast } from "../modules/toast.js";
import { positionMapNavigationControls } from "./mapEngine.js";

let workoutHudResizeObserver = null;

export function layoutLabelsForResolvedLayout(layout) {
  return (
    {
      "horizontal-1": "H1",
      "horizontal-2": "H2",
      "vertical-1": "V1",
      "vertical-2": "V2",
    }[layout] || "H1"
  );
}

export function applyWorkoutLayout() {
  const viewport = document.querySelector(".workout-viewport");
  if (!viewport) return;

  const layouts = ["horizontal-1", "horizontal-2", "vertical-1", "vertical-2"];
  const selectedLayout = state.workoutLayout;
  const isVertical = window.matchMedia("(orientation: portrait)").matches;
  const layout = layouts.includes(selectedLayout)
    ? selectedLayout
    : isVertical
      ? window.innerWidth < 700
        ? "vertical-2"
        : "vertical-1"
      : window.innerWidth < 1100
        ? "horizontal-2"
        : "horizontal-1";

  viewport.classList.remove(...layouts.map((name) => `layout-${name}`));
  viewport.classList.add(`layout-${layout}`);

  requestAnimationFrame(() => {
    if (!state.map) return;
    if (typeof state.map.resize === "function") state.map.resize();
    if (typeof state.map.invalidateSize === "function")
      state.map.invalidateSize();
    positionMapNavigationControls();
  });

  const layoutLabels = {
    auto: `Auto (${layoutLabelsForResolvedLayout(layout)})`,
    "horizontal-1": "H1",
    "horizontal-2": "H2",
    "vertical-1": "V1",
    "vertical-2": "V2",
  };
  const layoutButton = document.getElementById("btn-cycle-layout");
  if (layoutButton) {
    layoutButton.textContent = `▣ Diseño: ${
      selectedLayout === "auto" ? layoutLabels.auto : layoutLabels[layout]
    }`;
  }
}

export function cycleWorkoutLayout() {
  const layouts = ["auto", "horizontal-1", "horizontal-2", "vertical-1", "vertical-2"];
  const currentIndex = layouts.indexOf(state.workoutLayout);
  state.workoutLayout = layouts[(currentIndex + 1) % layouts.length];
  saveStateToLocalStorage();
  applyWorkoutLayout();
}

export function applyWorkoutPanels() {
  const panels = {
    virtual: document.getElementById("virtual-trainer-panel"),
    progress: document.getElementById("hud-progress"),
    elevation: document.getElementById("hud-elevation-footer"),
    upcoming: document.getElementById("upcoming-profile-chart"),
  };
  Object.entries(panels).forEach(([name, panel]) => {
    if (!panel) return;
    panel.classList.toggle(
      "workout-panel-collapsed",
      state.workoutPanels[name] === false,
    );
    const toggle = panel.querySelector(".panel-toggle");
    if (toggle)
      toggle.textContent = state.workoutPanels[name] === false ? "+" : "−";
  });
}

export function toggleWorkoutPanel(name) {
  if (!(name in state.workoutPanels)) return;
  state.workoutPanels[name] = !state.workoutPanels[name];
  saveStateToLocalStorage();
  applyWorkoutPanels();
}

export function updateFullscreenButton() {
  const button = document.getElementById("btn-toggle-fullscreen");
  if (!button) return;
  button.textContent = document.fullscreenElement
    ? "⛶ Salir de pantalla completa"
    : "⛶ Pantalla completa";
}

export function saveFullscreenPreference(value) {
  state.fullscreenPreference = value;
  saveStateToLocalStorage();
}

export async function toggleFullscreen() {
  if (!document.fullscreenEnabled) {
    showToast("El navegador no permite pantalla completa en este dispositivo.", "warning");
    return;
  }

  if (document.fullscreenElement) {
    await document.exitFullscreen();
    saveFullscreenPreference(false);
  } else {
    await document.documentElement.requestFullscreen();
    saveFullscreenPreference(true);
  }
  updateFullscreenButton();
}

export function showFullscreenRecovery() {
  showModal("fullscreen-recovery");
}

export function closeFullscreenRecovery() {
  hideModal("fullscreen-recovery");
}

export async function reactivateFullscreen() {
  closeFullscreenRecovery();
  if (!document.fullscreenEnabled) {
    showToast("El navegador no permite pantalla completa en este dispositivo.", "warning");
    return;
  }
  await document.documentElement.requestFullscreen();
  saveFullscreenPreference(true);
  updateFullscreenButton();
}

export function setWorkoutFontScale(increment) {
  const viewport = document.querySelector(".workout-viewport");
  if (!viewport) return;

  let currentScale = parseFloat(
    getComputedStyle(viewport).getPropertyValue("--workout-text-multiplier") ||
      1.0,
  );

  let newScale = currentScale + increment;
  newScale = Math.min(Math.max(newScale, 0.5), 2.5);

  viewport.style.setProperty("--workout-text-multiplier", newScale);
  localStorage.setItem("rodilloint_fontSize", newScale);
  syncWorkoutSlopePosition();
}

export function syncWorkoutSlopePosition() {
  const viewport = document.querySelector(".workout-viewport");
  const hud = document.getElementById("hud-top-bar");
  if (!viewport || !hud) return;

  viewport.style.setProperty(
    "--workout-hud-height",
    `${Math.ceil(hud.getBoundingClientRect().height)}px`,
  );
}

export function observeWorkoutHudSize() {
  workoutHudResizeObserver?.disconnect();
  const hud = document.getElementById("hud-top-bar");
  if (!hud) return;

  syncWorkoutSlopePosition();
  if (typeof ResizeObserver === "undefined") return;

  workoutHudResizeObserver = new ResizeObserver(() => {
    syncWorkoutSlopePosition();
  });
  workoutHudResizeObserver.observe(hud);
}

export function updateRouteProgressHud() {
  if (!state.routeDistances || state.routeDistances.length === 0) return;

  const totalKm = state.routeDistances[state.routeDistances.length - 1];
  const remainingKm = Math.max(0, totalKm - state.totalDistance);
  setElText("submetrics-remaining", `${remainingKm.toFixed(2)} km`);

  const remainingAscent = Math.max(
    0,
    (state.routeTotalAscent || 0) - state.totalAscent,
  );
  setElText("submetrics-remaining-ascent", `${Math.round(remainingAscent)} m+`);
}

export function updateSessionAverages() {
  const avgPower =
    state.powerHistory.length > 0
      ? Math.round(
          state.powerHistory.reduce((a, b) => a + b, 0) /
            state.powerHistory.length,
        )
      : 0;
  setElText("metrics-power-avg", `${avgPower} Ø`);

  const avgHr =
    state.hrHistory.length > 0
      ? Math.round(
          state.hrHistory.reduce((a, b) => a + b, 0) / state.hrHistory.length,
        )
      : 0;
  setElText("metrics-hr-avg", `${avgHr} Ø`);

  const avgSpeed =
    state.elapsedSeconds > 0
      ? (state.totalDistance / (state.elapsedSeconds / 3600.0)).toFixed(1)
      : "0.0";
  setElText("metrics-speed-avg", `${avgSpeed} Ø`);
}

export function configureWorkoutHudForMode() {
  const isRoute = state.currentMode === "ROUTE";
  const isManual = state.currentMode === "MANUAL";
  const routeNameElement = document.getElementById("workout-route-name");
  if (routeNameElement) {
    const routeName = (
      state.routeName ||
      state.gpxFilename?.replace(/\.(gpx|tcx)$/i, "") ||
      ""
    ).trim();
    routeNameElement.textContent = routeName;
    routeNameElement.title = routeName;
    routeNameElement.hidden = !isRoute || !routeName;
  }

  setElDisplay("route-side-stack", isRoute ? "flex" : "none");
  setElDisplay("hud-progress", isRoute ? "block" : "none");
  setElDisplay("hud-profile", isRoute ? "flex" : "none");
  setElDisplay("hud-elevation-footer", isRoute ? "block" : "none");
  setElDisplay("workout-map", isRoute ? "block" : "none");

  setElDisplay("btn-toggle-3d", isRoute ? "block" : "none");
  setElDisplay("btn-orient-toggle", isRoute ? "block" : "none");
  setElDisplay("metrics-slope", isRoute ? "flex" : "none");
  setElDisplay("upcoming-profile-chart", isRoute ? "block" : "none");

  setElDisplay("manual-mode-panel", isManual ? "flex" : "none");

  const ghostBanner = document.getElementById("ghost-banner");
  if (ghostBanner) {
    ghostBanner.classList.toggle(
      "visible",
      isRoute && state.ghostEnabled && (state.ghostPoints?.length || 0) > 0,
    );
  }
}

// Window bindings
window.applyWorkoutLayout = applyWorkoutLayout;
window.cycleWorkoutLayout = cycleWorkoutLayout;
window.toggleWorkoutPanel = toggleWorkoutPanel;
window.toggleFullscreen = toggleFullscreen;
window.closeFullscreenRecovery = closeFullscreenRecovery;
window.reactivateFullscreen = reactivateFullscreen;
