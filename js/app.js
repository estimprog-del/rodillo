import L from "leaflet";
import * as maplibregl from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  showModal,
  hideModal,
  setElDisplay,
  setElText,
  safeSetText,
} from "./modules/ui.js";
import {
  state,
  saveStateToLocalStorage,
  loadStateFromLocalStorage,
  loadWorkoutLayoutForUser,
} from "./modules/state.js";
import { initNavigation } from "./ui/navigation.js";
import { loadDashboardHeader } from "./ui/dashboard.js";
import { updateClock, updatePauseButton } from "./ui/uiHelpers.js";
import { bindEvents } from "./modules/events.js";
import { initPrivacyConsent } from "./modules/privacyConsent.js";
import { showToast, showConfirm } from "./modules/toast.js";
import {
  RemoteRoomClient,
  buildQrUrl,
  buildRemoteUrl,
  createRemoteRoom,
  createRoomId,
  getRemoteRoomId,
  isRemoteRoute,
  isRemoteAuthConfigured,
} from "./modules/remoteRoom.js";
import {
  clampVirtualGear,
  DEFAULT_VIRTUAL_GEAR,
  formatVirtualGear,
  getVirtualGearRatio,
} from "./modules/virtualGears.js";
import { exportAllData, getBackupStatus } from "./db.js";
import {
  loadProfilesGrid,
  selectUser,
  handleLogout,
  handleAddUserSubmit,
  handleEditUserSubmit,
  handleImportUserSubmit,
  handleDeleteProfile,
  handleExportProfile,
} from "./core/userProfile.js";
import {
  loadHistoryList,
  openHistoricalSessionSummary,
  checkPendingSessions,
  downloadSpecificHistoryCsv,
  downloadSpecificHistoryFit,
  loadProgressStats,
  repeatRouteFromHistory,
  deleteHistorySession,
  changeTrainingCalendarMonth,
  selectTrainingCalendarDate,
  goToTrainingCalendarToday,
} from "./core/history.js";
import {
  renderRouteLibrary,
  setRouteLibraryFilter,
  saveUserRoute,
  populateSessionSavedRoutes,
  loadSavedRouteInSessionModal,
} from "./core/routeLibrary.js";
import { renderWorkoutLibrary } from "./core/workoutLibrary.js";
import { createWorkoutEditorController } from "./core/workoutEditor.js";
import { initializeRemoteController } from "./modules/remoteController.js";
import { createSensorConnectionsController } from "./modules/sensorConnections.js";
import { createMapCameraController } from "./modules/mapCamera.js";
import {
  calculateTotalRouteAscent,
  createRouteOverviewController,
} from "./modules/routeOverview.js";
import { createRouteSimulationController } from "./modules/routeSimulation.js";
import { createSessionTimerController } from "./modules/sessionTimer.js";
import {
  flushTelemetryBuffer,
  recoverTelemetryBackup,
  saveTelemetryPoint,
} from "./modules/telemetryStorage.js";
import {
  getWorkoutPowerAdherence,
  renderSummaryMetrics,
  renderSummaryRoute,
  setSessionSaveStatus,
} from "./core/sessionSummary.js";
import {
  initWorkoutEngine,
  resetWorkoutEngine,
  tickWorkout,
  adjustWorkoutBias,
  resetWorkoutBias,
  getWorkoutBias,
  renderActiveWorkoutHudSvg,
} from "./core/workoutEngine.js";

window.adjustWorkoutBias = adjustWorkoutBias;
window.resetWorkoutBias = resetWorkoutBias;
globalThis.L = L;
globalThis.maplibregl = maplibregl;
maplibregl.setWorkerUrl(mapLibreWorkerUrl);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const serviceWorkerUrl = new URL(
      `${import.meta.env.BASE_URL}sw.js`,
      window.location.origin,
    );
    navigator.serviceWorker.register(serviceWorkerUrl)
      .then((registration) => console.log("[PWA] SW registrado:", registration.scope))
      .catch((error) => console.warn("[PWA] SW error:", error));
  }, { once: true });
}


const MAX_SLOPE_CHANGE_PER_SEC = 0.5;
const WHEEL_INACTIVITY_TIMEOUT_MS = 10000;
const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY || "";
const MAP_VIEW_MODES = ["2D", "3D_AEREO", "3D_FPV"];
let activeRemoteRoomClient = null;
let remoteRoomInitialization = 0;
let lastFpvDebugState = "";
let mapReadyInstance = null;
let workoutHudResizeObserver = null;
let mapControlsResizeObserver = null;
let observedMapControls = null;
let observedMapHudGroup = null;
let countdownTimer = null;
let countdownFinishTimer = null;
let movementWaitTimer = null;
let sessionSafetyAcknowledged = false;
let lastPowerReceivedAt = 0;
let lastCadenceReceivedAt = 0;
let workoutPowerSamples = [];
let kilojuliosAcumulados = 0;

function logFpvDebug(message, details = {}) {
  const stateKey = `${message}:${JSON.stringify(details)}`;
  if (stateKey === lastFpvDebugState) return;
  lastFpvDebugState = stateKey;
  console.debug(`[FPV] ${message}`, details);
}


function getMapSdk() {
  return (
    [globalThis.maptilersdk, globalThis.maplibregl].find(
      (sdk) => sdk?.Map && sdk?.MercatorCoordinate,
    ) || null
  );
}

function isMapReady(map) {
  return Boolean(
    map &&
      (map === mapReadyInstance ||
        typeof map.isStyleLoaded !== "function" ||
        map.isStyleLoaded()),
  );
}

const mapCamera = createMapCameraController({
  state,
  getMapSdk,
  isMapReady,
});
const routeOverview = createRouteOverviewController(state);
const routeSimulation = createRouteSimulationController(state);
const sessionTimer = createSessionTimerController(state);

function applyWorkoutLayout() {
  const viewport = document.querySelector(".workout-viewport");
  if (!viewport) return;

  const layouts = ["horizontal-1", "horizontal-2", "vertical-1", "vertical-2"];
  const selectedLayout = state.workoutLayout;
  const isVertical = window.matchMedia("(orientation: portrait)").matches;
  const layout = layouts.includes(selectedLayout)
    ? selectedLayout
    : isVertical
      ? (window.innerWidth < 700 ? "vertical-2" : "vertical-1")
      : (window.innerWidth < 1100 ? "horizontal-2" : "horizontal-1");

  viewport.classList.remove(...layouts.map((name) => `layout-${name}`));
  viewport.classList.add(`layout-${layout}`);

  requestAnimationFrame(() => {
    if (!state.map) return;
    if (typeof state.map.resize === "function") state.map.resize();
    if (typeof state.map.invalidateSize === "function") state.map.invalidateSize();
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
    layoutButton.textContent = `▣ Diseño: ${selectedLayout === "auto" ? layoutLabels.auto : layoutLabels[layout]}`;
  }
}

function layoutLabelsForResolvedLayout(layout) {
  return { "horizontal-1": "H1", "horizontal-2": "H2", "vertical-1": "V1", "vertical-2": "V2" }[layout];
}

window.applyWorkoutLayout = applyWorkoutLayout;

function updateFullscreenButton() {
  const button = document.getElementById("btn-toggle-fullscreen");
  if (!button) return;
  button.textContent = document.fullscreenElement
    ? "⛶ Salir de pantalla completa"
    : "⛶ Pantalla completa";
}

function saveFullscreenPreference(value) {
  state.fullscreenPreference = value;
  saveStateToLocalStorage();
}

async function toggleFullscreen() {
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

window.toggleFullscreen = toggleFullscreen;
document.addEventListener("fullscreenchange", () => {
  updateFullscreenButton();
  if (!state.fullscreenFilePickerActive) {
    saveFullscreenPreference(!!document.fullscreenElement);
  }
});

function showFullscreenRecovery() {
  showModal("fullscreen-recovery");
}

function closeFullscreenRecovery() {
  hideModal("fullscreen-recovery");
}

async function reactivateFullscreen() {
  closeFullscreenRecovery();
  if (!document.fullscreenEnabled) {
    showToast("El navegador no permite pantalla completa en este dispositivo.", "warning");
    return;
  }
  await document.documentElement.requestFullscreen();
  saveFullscreenPreference(true);
  updateFullscreenButton();
}

window.closeFullscreenRecovery = closeFullscreenRecovery;
window.reactivateFullscreen = reactivateFullscreen;

function cycleWorkoutLayout() {
  const layouts = ["auto", "horizontal-1", "horizontal-2", "vertical-1", "vertical-2"];
  const currentIndex = layouts.indexOf(state.workoutLayout);
  state.workoutLayout = layouts[(currentIndex + 1) % layouts.length];
  saveStateToLocalStorage();
  applyWorkoutLayout();
}

window.cycleWorkoutLayout = cycleWorkoutLayout;

window.addEventListener("resize", () => {
  if (state.workoutLayout === "auto") applyWorkoutLayout();
  else positionMapNavigationControls();
});

function positionMapNavigationControls() {
  const mapContainer = document.getElementById("workout-map");
  const hudGroup = document.querySelector(".hud-bottom-right-group");
  const controls = mapContainer?.querySelector(
    ".maplibregl-ctrl-top-right, .leaflet-top.leaflet-right",
  );
  if (!mapContainer || !hudGroup || !controls) return;

  const mapRect = mapContainer.getBoundingClientRect();
  const hudRect = hudGroup.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();
  if (!controlsRect.height || !mapRect.height) return;

  const top = Math.max(
    80,
    hudRect.top - mapRect.top - controlsRect.height - 10,
  );
  const right = Math.max(8, mapRect.right - hudRect.right);
  controls.style.setProperty("top", `${top}px`, "important");
  controls.style.setProperty("right", `${right}px`, "important");

  if (typeof ResizeObserver !== "undefined") {
    if (!mapControlsResizeObserver) {
      mapControlsResizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(positionMapNavigationControls);
      });
    }
    if (controls !== observedMapControls || hudGroup !== observedMapHudGroup) {
      mapControlsResizeObserver.disconnect();
      mapControlsResizeObserver.observe(hudGroup);
      mapControlsResizeObserver.observe(controls);
      observedMapControls = controls;
      observedMapHudGroup = hudGroup;
    }
  }
}

function applyWorkoutPanels() {
  const panels = {
    virtual: document.getElementById("virtual-trainer-panel"),
    progress: document.getElementById("hud-progress"),
    elevation: document.getElementById("hud-elevation-footer"),
    upcoming: document.getElementById("upcoming-profile-chart"),
  };
  Object.entries(panels).forEach(([name, panel]) => {
    if (!panel) return;
    panel.classList.toggle("workout-panel-collapsed", state.workoutPanels[name] === false);
    const toggle = panel.querySelector(".panel-toggle");
    if (toggle) toggle.textContent = state.workoutPanels[name] === false ? "+" : "−";
  });
}

function toggleWorkoutPanel(name) {
  if (!(name in state.workoutPanels)) return;
  state.workoutPanels[name] = !state.workoutPanels[name];
  saveStateToLocalStorage();
  applyWorkoutPanels();
}

window.toggleWorkoutPanel = toggleWorkoutPanel;

function formatWorkoutTimer(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateWorkoutErgHud(workoutStatus) {
  if (!workoutStatus || !state.currentWorkout) {
    setElDisplay("workout-erg-panel", "none");
    return;
  }

  const step = workoutStatus.step || {};
  const stepTypeLabel = {
    warmup: "Calentamiento",
    steady: "Sostenido",
    interval: "Intervalo",
    ramp: "Rampa",
    cooldown: "Recuperación",
  }[step.type] || "Bloque";

  const stepTag = document.getElementById("workout-step-tag");
  const stepCounter = document.getElementById("workout-step-counter");
  const countdown = document.getElementById("workout-step-countdown");
  const progressBar = document.getElementById("workout-step-progress-bar");
  const powerLabel = document.getElementById("workout-target-power-val");
  const actualPowerLabel = document.getElementById("workout-current-power-val");
  const actualPowerDelta = document.getElementById("workout-power-delta");
  const cadenceLabel = document.getElementById("workout-target-cadence-val");
  const actualCadenceLabel = document.getElementById("workout-current-cadence-val");
  const actualPowerPill = document.getElementById("workout-current-power-pill");
  const messageBanner = document.getElementById("workout-message-banner");
  const nextName = document.getElementById("workout-next-step-name");
  const nextMeta = document.getElementById("workout-next-step-meta");
  const biasLabel = document.getElementById("workout-bias-label");
  const timelineProgress = document.getElementById("workout-timeline-progress");
  const timelineContainer = document.getElementById("workout-timeline-container");

  if (stepTag) stepTag.textContent = stepTypeLabel;
  if (stepCounter) stepCounter.textContent = `Bloque ${workoutStatus.stepIndex || 1} de ${workoutStatus.totalSteps || 1}`;
  if (countdown) countdown.textContent = formatWorkoutTimer(workoutStatus.stepRemaining || 0);

  const progressValue = step.durationSeconds > 0 ? Math.min(100, Math.max(0, ((step.durationSeconds - (workoutStatus.stepRemaining || 0)) / step.durationSeconds) * 100)) : 0;
  if (progressBar) progressBar.style.width = `${progressValue}%`;
  if (powerLabel) powerLabel.textContent = `${Math.round(workoutStatus.targetWatts || 0)} W`;
  if (cadenceLabel) cadenceLabel.textContent = `${workoutStatus.targetCadence ?? "--"} rpm`;
  const hasRecentPower = Date.now() - lastPowerReceivedAt < 5000;
  const hasRecentCadence = Date.now() - lastCadenceReceivedAt < 5000;
  const currentPower = hasRecentPower ? Math.round(Number(state.currentPower) || 0) : null;
  const currentCadence = hasRecentCadence ? Math.round(Number(state.currentCadence) || 0) : null;
  if (actualPowerLabel) actualPowerLabel.textContent = currentPower === null ? "-- W" : `${currentPower} W`;
  if (actualCadenceLabel) actualCadenceLabel.textContent = currentCadence === null ? "-- rpm" : `${currentCadence} rpm`;
  if (actualPowerDelta && actualPowerPill) {
    const delta = currentPower === null ? null : currentPower - workoutStatus.targetWatts;
    const tolerance = Math.max(5, workoutStatus.targetWatts * 0.05);
    actualPowerDelta.textContent = delta === null
      ? "Esperando potenciómetro"
      : `${delta > tolerance ? "Por encima" : delta < -tolerance ? "Por debajo" : "En objetivo"} · ${delta > 0 ? "+" : ""}${delta} W`;
    actualPowerPill.classList.toggle("is-above", delta !== null && delta > tolerance);
    actualPowerPill.classList.toggle("is-below", delta !== null && delta < -tolerance);
    actualPowerPill.classList.toggle("is-on-target", delta !== null && Math.abs(delta) <= tolerance);
  }
  if (messageBanner) messageBanner.textContent = workoutStatus.textMessage || step.text || "Mantén el ritmo";

  if (nextName) {
    nextName.textContent = workoutStatus.nextStep ? (workoutStatus.nextStep.text || stepTypeLabel) : "Fin del entrenamiento";
  }
  if (nextMeta) {
    nextMeta.textContent = workoutStatus.nextStep
      ? `${formatWorkoutTimer(workoutStatus.nextStep.durationSeconds)} · ${Math.round(workoutStatus.nextStepWatts || 0)} W`
      : "Sesión completa";
  }
  if (biasLabel) biasLabel.textContent = `Bias: ${Math.round(workoutStatus.biasWatts || 0)} W`;
  if (timelineProgress) {
    const total = Math.max(1, state.currentWorkout.totalDurationSeconds || 1);
    timelineProgress.textContent = `${formatWorkoutTimer(state.elapsedSeconds || 0)} / ${formatWorkoutTimer(total)}`;
  }

  if (timelineContainer) {
    const svg = renderActiveWorkoutHudSvg(
      state.currentWorkout,
      state.elapsedSeconds || 0,
      state.currentUser?.ftp || 200,
      640,
      110,
      workoutPowerSamples,
    );
    timelineContainer.innerHTML = svg || "";
  }
}

function loadWorkoutsScreen(filter = "all") {
  const filterElement = document.getElementById("workout-library-filter");
  if (filterElement) filterElement.value = filter;

  renderWorkoutLibrary(filter, (workout) => {
    state.currentWorkout = workout;
    state.currentMode = "ERG";
    state.connectionsReturnScreen = "workouts";
    saveStateToLocalStorage();
    showToast(`Entrenamiento cargado: ${workout.name}`, "success");
    navigateTo("connections");
  }, undefined, (workout) => {
    workoutEditor.openWorkoutEditor(workout, "copy");
  }, (workout) => {
    workoutEditor.openWorkoutEditor(workout, "edit");
  }, (workout) => workoutEditor.exportWorkoutAsZwo(workout));
}

// Global Navigation function (injected)
let navigateTo;
const sensorConnections = createSensorConnectionsController();
const workoutEditor = createWorkoutEditorController({
  refreshLibrary: (filter) => loadWorkoutsScreen(filter),
});

// UI Elements references
const UI = {
  screens: {},
  buttons: {},
  inputs: {},
  labels: {},
  modals: {},
};

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", async () => {
  console.log("RodilloInt SPA initializing...");

  if (isRemoteRoute()) {
    initializeRemoteController();
    return;
  }

  // Cargar estado guardado sin bloquear el arranque si existe un valor corrupto.
  try {
    loadStateFromLocalStorage();
  } catch (error) {
    console.error("No se pudo restaurar el estado guardado:", error);
    localStorage.removeItem("rodilloint_state");
  }

  // Initialize Navigation
  const navigationCallbacks = {
    dashboard: () => {
      loadDashboardHeader(state);
      setTimeout(() => {
        if (typeof BleManager.autoReconnectSavedDevices === "function") {
          BleManager.autoReconnectSavedDevices();
        }
      }, 600);
    },
    workout: () => enterWorkoutScreen(),
    history: () => loadHistoryList(),
    stats: () => loadProgressStats(),
    connections: () => sensorConnections.syncBluetoothScreenStatus(),
    routes: () => renderRouteLibrary(),
    workouts: () => loadWorkoutsScreen(),
  };

  navigateTo = initNavigation(UI, state, navigationCallbacks);

  // Exponer bridges para que los módulos core/ puedan acceder a funciones de app.js
  window._navigateTo = navigateTo;
  window._renderSummaryMetrics = renderSummaryMetrics;
  window._renderSummaryRoute = renderSummaryRoute;
  window._loadDashboardHeader = loadDashboardHeader;

  // Bind UI Elements
  cacheUiElements();
  bindEvents({
    handleAddUserSubmit,
    handleEditUserSubmit,
    handleImportUserSubmit,
    handleDeleteProfile,
    handleExportProfile,
    handleLogout,
    startModeFlow,
    navigateTo,
    triggerBleConnection: sensorConnections.triggerBleConnection,
    togglePause,
    stopSessionFlow,
    handleGpxUpload,
    adjustManualSlope,
    adjustManualPower,
    setWorkoutFontScale,
    startSession,
    changeVirtualGear,
    confirmSessionSafety,
    saveUserRoute,
    setRouteLibraryFilter,
    populateSessionSavedRoutes,
    loadSavedRouteInSessionModal,
    changeTrainingCalendarMonth,
    selectTrainingCalendarDate,
    goToTrainingCalendarToday,
  });

  workoutEditor.bindEvents();
  loadWorkoutsScreen();
  initPrivacyConsent();

  // Init Database and listeners
  try {
    await DbManager.initDb();
    await recoverTelemetryBackup();
    await loadProfilesGrid();
    await checkPendingSessions();

    setInterval(() => {
      if (state.isSessionActive && state.currentSessionId) {
        localStorage.setItem("rodilloint_active_session", JSON.stringify({
          sessionId: state.currentSessionId,
          lastUpdated: Date.now(),
          elapsedSeconds: state.elapsedSeconds,
          totalDistance: state.totalDistance
        }));
        if (typeof flushTelemetryBuffer === 'function') flushTelemetryBuffer();
      }
    }, 15000);

    window.addEventListener("beforeunload", async (e) => {
      if (state.isSessionActive && typeof flushTelemetryBuffer === 'function') {
        await flushTelemetryBuffer();
      }
    });

    const savedUserId = localStorage.getItem("rodilloint_userId");
    if (savedUserId) {
      const user = await DbManager.getUserById(savedUserId);
      if (user) selectUser(user);
    }
  } catch (e) {
    console.error("Failed to init IndexedDB", e);
    const container = document.getElementById("users-grid-container");
    if (container) {
      container.innerHTML = `
        <div class="glass-card" style="text-align:center;padding:30px;color:var(--accent-red);">
          No se pudieron cargar los perfiles guardados.
        </div>
      `;
    }
  }

  // Expose state globally for easier debugging in DevTools console
  try {
    window.state = state;
  } catch (err) {
    // noop if running in restricted environment
  }

  BleManager.setBleListener({
    onPowerReceived,
    onHeartRateReceived,
    onCadenceReceived,
    onSpeedReceived,
    onStatusChanged: sensorConnections.onStatusChanged,
  });
  sensorConnections.initSensorReconnectControls();
});

function cacheUiElements() {
  // Screens
  [
    "user-select",
    "dashboard",
    "connections",
    "workouts",
    "workout",
    "remote",
    "summary",
    "history",
    "stats",
    "help",
    "routes",
  ].forEach((s) => {
    UI.screens[s] = document.getElementById(`screen-${s}`);
  });

  // Modals
  ["add-user", "import-user", "edit-user", "scan-overlay"].forEach((m) => {
    UI.modals[m] = document.getElementById(`modal-${m}`);
  });
  if (!UI.modals.scanOverlay)
    UI.modals.scanOverlay = document.getElementById("radar-scan-overlay");

  // Forms
  UI.formAddUser = document.getElementById("form-add-user");
  UI.formEditUser = document.getElementById("form-edit-user");

  // Inputs
  UI.inputs.gpxFileInput = document.getElementById("gpx-file-input");
  UI.routeModal = document.getElementById("route-modal");
}

// UI Update throttling to prevent DOM congestion
// UI Update throttling to prevent DOM congestion (ahora importado desde modules/ui.js)

// --- Funciones persistencia movidas a modules/state.js ---
// --- Funciones UI movidas a modules/ui.js ---

// NOTA: Las funciones showModal, hideModal, setElDisplay, setElText,
// y safeSetText han sido eliminadas de este archivo.
// Ahora se utilizan las versiones importadas.

function showRouteModal() {
  if (UI.routeModal) {
    UI.routeModal.classList.add("active");

    const savedRealism = localStorage.getItem("rodilloint_realism");
    if (savedRealism) {
      state.realismFactor = parseFloat(savedRealism);
    }

    const realismSlider = document.getElementById("realism-slider");
    const realismValue = document.getElementById("realism-value");
    if (realismSlider && realismValue) {
      realismSlider.value = Math.round((state.realismFactor || 1.0) * 100);
      realismValue.textContent = `${realismSlider.value}%`;

      realismSlider.oninput = (e) => {
        const val = e.target.value;
        realismValue.textContent = `${val}%`;
        state.realismFactor = parseFloat(val) / 100;
        localStorage.setItem("rodilloint_realism", state.realismFactor);
        saveStateToLocalStorage();

        const sessionSlider = document.getElementById("realism-slider-session");
        const sessionValue = document.getElementById("realism-value-session");
        if (sessionSlider && sessionValue) {
          sessionSlider.value = val;
          sessionValue.textContent = `${val}%`;
        }
      };
    }
  }
}

function hideRouteModal() {
  if (UI.routeModal) UI.routeModal.classList.remove("active");
}

// --- ROUTE LIBRARY --- (migrado a js/core/routeLibrary.js)
// renderRouteLibrary, buildRouteCardEl, loadRouteCardData, setRouteLibraryFilter,
// saveUserRoute, populateSessionSavedRoutes, loadSavedRouteInSessionModal, escapeHtml

function updateRouteProgressHud() {
  if (state.routeDistances.length === 0) return;

  const totalKm = state.routeDistances[state.routeDistances.length - 1];
  const remainingKm = Math.max(0, totalKm - state.totalDistance);
  setElText("submetrics-remaining", `${remainingKm.toFixed(2)} km`);

  if (!state.routeTotalAscent) {
    state.routeTotalAscent = calculateTotalRouteAscent(state.routeElevations);
  }
  const remainingAscent = Math.max(
    0,
    state.routeTotalAscent - state.totalAscent,
  );
  setElText("submetrics-remaining-ascent", `${Math.round(remainingAscent)} m+`);
}

function updateSessionAverages() {
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
      ? (
          state.totalDistance /
          (state.elapsedSeconds / 3600.0)
        ).toFixed(1)
      : "0.0";
  setElText("metrics-speed-avg", `${avgSpeed} Ø`);
}

function configureWorkoutHudForMode() {
  const isRoute = state.currentMode === "ROUTE";
  const isManual = state.currentMode === "MANUAL";
  const isErg = state.currentMode === "ERG";
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
  setElDisplay("workout-erg-panel", isErg ? "block" : "none");

  setElDisplay("btn-toggle-3d", isRoute ? "block" : "none");
  setElDisplay("btn-orient-toggle", isRoute ? "block" : "none");
  setElDisplay("metrics-slope", isRoute ? "flex" : "none");
  setElDisplay("upcoming-profile-chart", isRoute ? "block" : "none");

  setElDisplay("manual-mode-panel", isManual ? "flex" : "none");
  if (isManual) {
    const label = document.getElementById("manual-slope-label");
    const modeText = document.getElementById("manual-mode-label-text");
    const btn = document.getElementById("btn-toggle-manual-mode");
    if (state.manualMode === "ERG") {
      if (modeText) modeText.textContent = "Potencia Objetivo";
      if (label) label.textContent = `${state.targetWatts || 150} W`;
      if (btn) btn.textContent = "Cambiar a Modo Pendiente (%)";
    } else {
      if (modeText) modeText.textContent = "Pendiente";
      if (label) label.textContent = `${(state.currentSlope || 0).toFixed(1)}%`;
      if (btn) btn.textContent = "Cambiar a Modo ERG (W)";
    }
  }

  const ghostBanner = document.getElementById("ghost-banner");
  if (ghostBanner) {
    ghostBanner.classList.toggle(
      "visible",
      isRoute && state.ghostEnabled && (state.ghostPoints?.length || 0) > 0,
    );
  }

  if (isErg) {
    const workoutTitle = document.getElementById("workout-timeline-name");
    if (workoutTitle) {
      workoutTitle.textContent = state.currentWorkout?.name || "Entrenamiento";
    }
  }
}

function initConfiguredMap() {
    const configuredMode = MAP_VIEW_MODES.includes(state.mapViewMode)
        ? state.mapViewMode
        : state.mapType === "leaflet"
            ? "2D"
            : "3D_AEREO";
    const toggleButton = document.getElementById("btn-toggle-3d");

    if (state.map) {
        state.map.remove();
        state.map = null;
    }
    mapReadyInstance = null;

    if (configuredMode === "2D") {
        state.mapViewMode = "2D";
        state.mapType = "leaflet";
        initLeafletMap();
        drawRouteOnMap();
        createOrientationToggleButton();
        return;
    }

    if (!toggleButton || typeof window.toggleMapEngine !== "function") {
        console.error("No se pudo inicializar el mapa 3D: falta el control del motor.");
        return;
    }

    // Reutilizar el flujo probado del botón garantiza el mismo mapa al arrancar
    // desde Ajustes y al cambiarlo manualmente durante la sesión.
    state.mapViewMode = "2D";
    state.mapType = "leaflet";
    window.toggleMapEngine(toggleButton);

    if (configuredMode === "3D_FPV") {
        window.toggleMapEngine(toggleButton);
    }
}// --- Eventos movidos a modules/events.js ---
// Se ha importado la función bindEvents al inicio del archivo.

/*
   La función original bindEvents ha sido eliminada para evitar duplicidad.
*/

// --- NAVIGATION ENGINE ---

function setWorkoutFontScale(increment) {
  const viewport = document.querySelector(".workout-viewport");
  if (!viewport) return;

  // Obtener valor actual o default 1.0
  let currentScale = parseFloat(
    getComputedStyle(viewport).getPropertyValue("--workout-text-multiplier") ||
      1.0,
  );

  // Calcular nuevo valor: incrementar o decrementar
  let newScale = currentScale + increment;

  // Límite: entre 0.5 y 2.5
  newScale = Math.min(Math.max(newScale, 0.5), 2.5);

  // Aplicar
  viewport.style.setProperty("--workout-text-multiplier", newScale);
  localStorage.setItem("rodilloint_fontSize", newScale);
  syncWorkoutSlopePosition();
}

function syncWorkoutSlopePosition() {
  const viewport = document.querySelector(".workout-viewport");
  const hud = document.getElementById("hud-top-bar");
  if (!viewport || !hud) return;

  viewport.style.setProperty(
    "--workout-hud-height",
    `${Math.ceil(hud.getBoundingClientRect().height)}px`,
  );
}

function observeWorkoutHudSize() {
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


// --- USER PROFILE LOGIC --- (migrado a js/core/userProfile.js)
// loadProfilesGrid, selectUser, handleLogout, handleAddUserSubmit,
// handleEditUserSubmit, handleImportUserSubmit, handleDeleteProfile,
// handleExportProfile, deleteProfileFromSelectScreen


// --- WORKOUT LAUNCH MODAL/FLOW ---
function startModeFlow(mode) {
  state.currentMode = mode;

  // Check sensor setup
  const hasControllable = BleManager.connections.TRAINER.status === "CONECTADO";
  const hasPower = BleManager.connections.POWER.status === "CONECTADO";
  const hasSpeed = BleManager.connections.CSC.status === "CONECTADO";
  const isVirtual = BleManager.simulator.isActive;

  if (mode === "ROUTE" || mode === "MANUAL" || mode === "ERG") {
    // Requires a controllable trainer, speed or power sensors to calculate virtual metrics
    if (!hasControllable && !hasPower && !hasSpeed && !isVirtual) {
      showToast("Se necesita conectar al menos un sensor (Rodillo inteligente, potenciómetro, sensor de velocidad) o activar el Rodillo Virtual para iniciar entrenamientos interactivos.", "warning");
      navigateTo("connections");
      return;
    }
  }

  if (mode === "ERG" && !state.currentWorkout) {
    showToast("Primero selecciona un entrenamiento ERG o importa uno .zwo/.erg.", "warning");
    navigateTo("workouts");
    return;
  }

  navigateTo("workout");
}

// --- TELEMETRY RX & CALCULATIONS ---
function onPowerReceived(power) {
  sensorConnections.onMetricReceived("power");
  state.currentPower = power;
  lastPowerReceivedAt = Date.now();

  // Lógica de inicio por movimiento
  if (state.isWaitingForMovement && power > 10) {
    console.log("Movimiento detectado, iniciando cuenta atrás...");
    state.isWaitingForMovement = false;
    startCountdown(() => {
      state.lastTelemetryTimestamp = Date.now();
      state.lastTelemetrySpeed = state.currentSpeed || 0;
      startTimerInterval();
      updatePauseButton("⏸ Pausa");
    }, state.countdownDuration || 3);
  }

  setElText("metrics-power", power);

  // Power Buffer rolling average based on settings
  const windowSize = Math.max(1, Math.round((state.sensorSmoothing || 1000) / 1000));
  state.powerBuffer.push(power);
  if (state.powerBuffer.length > windowSize) state.powerBuffer.shift();
  state.power3s = Math.round(
    state.powerBuffer.reduce((a, b) => a + b, 0) / state.powerBuffer.length,
  );

  const ftp = state.currentUser ? state.currentUser.ftp : 200;
  // Usar zonas personalizadas del estado, divididas por 100 para obtener el factor
  const z = state.powerZones || [55, 75, 88, 95, 106];

  let zoneColor = "#10b981";
  let activeZoneIndex = 0;

  if (power < ftp * (z[0] / 100)) {
    zoneColor = "#6b7280";
    activeZoneIndex = 0;
  } else if (power < ftp * (z[1] / 100)) {
    zoneColor = "#3b82f6";
    activeZoneIndex = 1;
  } else if (power < ftp * (z[2] / 100)) {
    zoneColor = "#10b981";
    activeZoneIndex = 2;
  } else if (power < ftp * (z[3] / 100)) {
    zoneColor = "#f59e0b";
    activeZoneIndex = 3;
  } else if (power < ftp * (z[4] / 100)) {
    zoneColor = "#f97316";
    activeZoneIndex = 4;
  } else {
    zoneColor = "#ef4444";
    activeZoneIndex = 5;
  }

  const powerEl = document.getElementById("metrics-power");
  if (powerEl) powerEl.style.color = zoneColor;

  if (state.isSessionActive && !state.isPaused) {
    state.timeInPowerZones[activeZoneIndex]++;
    state.powerHistory.push(power);
    updateSessionAverages();
  }

  if (state.isSessionActive && power > 15) {
    const hasPedalingPower = state.currentMode !== "ROUTE" ||
      BleManager.calculateVirtualSpeed(
        power,
        state.currentSlope,
        state.currentUser ? state.currentUser.weight : 75.0,
      ) > 0.5;
    if (hasPedalingPower) resumeSessionOnMovement();
  }
}

function onHeartRateReceived(hr) {
  sensorConnections.onMetricReceived("heartRate");
  state.currentHr = hr;
  setElText("metrics-hr", hr);

  const maxHr = state.currentUser ? state.currentUser.maxHeartRate : 190;
  const ratio = hr / maxHr;
  let zoneColor = "#6b7280";

  if (ratio < 0.6) {
    zoneColor = "#6b7280";
  } else if (ratio < 0.7) {
    zoneColor = "#3b82f6";
  } else if (ratio < 0.8) {
    zoneColor = "#10b981";
  } else if (ratio < 0.9) {
    zoneColor = "#f59e0b";
  } else {
    zoneColor = "#ef4444";
  }

  const hrEl = document.getElementById("metrics-hr");
  if (hrEl) {
    hrEl.style.color = zoneColor;
    if (hr >= maxHr && hr > 0) {
      hrEl.style.animation = "radar-pulse 0.5s alternate infinite";
    } else {
      hrEl.style.animation = "";
    }
  }

  if (state.isSessionActive && !state.isPaused) {
    state.hrHistory.push(hr);
    updateSessionAverages();
  }
}

function onCadenceReceived(cad) {
  sensorConnections.onMetricReceived("cadence");
  state.currentCadence = cad;
  lastCadenceReceivedAt = Date.now();
  setElText("metrics-cadence", cad);
  if (state.isSessionActive && cad > 5) resumeSessionOnMovement();
}

function onSpeedReceived(speedKph, hasWheelRevolution = speedKph > 0) {
  sensorConnections.onMetricReceived("speed");
  state.currentSpeed = speedKph;
  setElText("metrics-speed", speedKph.toFixed(1));

  const now = Date.now();
  state.lastSpeedUpdateTime = now;
  if (hasWheelRevolution && speedKph > 0) {
    state.lastWheelRevolutionTime = now;
  }

  // Positive wheel movement can resume an automatic pause.
  if (state.isSessionActive) {
    if (hasWheelRevolution && speedKph > 0.5) {
      state.lastMovementTime = now;
      resumeSessionOnMovement();
    }
  }
}

function resumeSessionOnMovement() {
  if (
    !state.isSessionActive ||
    !state.isPaused ||
    state.isCountdownActive ||
    BleManager.simulator.isActive
  ) {
    return;
  }
  state.isAutoPaused = false;
  resumeTimer();
}


// --- CYCLING PHYSICS / TSS / IF MATH ---
function calculateNormalizedPower() {
  return calculateNormalizedPowerFromValues(state.powerHistory);
}

function calculateNormalizedPowerFromValues(values) {
  if (values.length < 30) {
    return (
      values.reduce((a, b) => a + b, 0) / values.length || 0.0
    );
  }

  // 1. Calculate 30-second rolling averages
  const rollingAverages = [];
  for (let i = 29; i < values.length; i++) {
    const sum = values
      .slice(i - 29, i + 1)
      .reduce((a, b) => a + b, 0);
    const avg = sum / 30.0;
    rollingAverages.push(Math.pow(avg, 4.0));
  }

  // 2. Average the 4th powers, and take the 4th root
  const avgPowers4 =
    rollingAverages.reduce((a, b) => a + b, 0) / rollingAverages.length;
  return Math.pow(avgPowers4, 0.25);
}

// --- Countdown Timer ---
function startCountdown(onComplete, duration) {
  cancelCountdown();
  // Reset forzado antes de empezar para evitar bloqueos
  state.isCountdownActive = true;
  toggleRemoteRoomPanel(true);

  const countdownOverlay = document.getElementById("workout-countdown-overlay");
  const countdownText = document.getElementById("countdown-text");

  if (!countdownOverlay || !countdownText) {
    toggleRemoteRoomPanel(false);
    if (onComplete) onComplete();
    state.isCountdownActive = false;
    return;
  }

  // Fuerza la visibilidad de la capa
  countdownOverlay.style.display = "flex";
  countdownOverlay.style.visibility = "visible";
  countdownOverlay.style.opacity = "1";

  let count = duration || state.countdownDuration || 3;
  countdownText.textContent = count;

  // Audio context se inicializa una vez
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const playBeep = (freq = 880) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  };

  // Intervalo solo para actualizar la UI
  countdownTimer = setInterval(() => {
    count--;
    if (count > 0) {
      countdownText.textContent = count;
      // Pitido para 3, 2, 1
      if (count <= 3) playBeep(880);
    } else {
      clearInterval(countdownTimer);
      countdownTimer = null;
      countdownText.textContent = "¡Listo!";
      // Pitido final
      playBeep(1200);
      countdownFinishTimer = setTimeout(() => {
        countdownFinishTimer = null;
        countdownOverlay.style.display = "none";
        toggleRemoteRoomPanel(false);
        state.isCountdownActive = false;
        audioCtx.close();
        if (onComplete) onComplete();
      }, 1000);
    }

  }, 1000);
}

function cancelCountdown() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (countdownFinishTimer !== null) {
    clearTimeout(countdownFinishTimer);
    countdownFinishTimer = null;
  }
  if (movementWaitTimer !== null) {
    clearTimeout(movementWaitTimer);
    movementWaitTimer = null;
  }
  state.isCountdownActive = false;
  const overlay = document.getElementById("workout-countdown-overlay");
  if (overlay) overlay.style.display = "none";
  toggleRemoteRoomPanel(false);
}

// --- WORKOUT SCREEN ACTIVATION ---
function enterWorkoutScreen() {
  initializeRemoteRoomPanel();
  toggleRemoteRoomPanel(true);
  applyWorkoutLayout();
  setElDisplay("hud-top-bar", "flex");
  observeWorkoutHudSize();
  setElDisplay("hud-bottom-left", "flex");
  setElDisplay("hud-bottom-right-group", "flex");
  setElDisplay("elevation-chart-cursor", "none");
  state.powerBuffer = [];
  state.powerHistory = [];
  state.hrHistory = [];
  state.speedHistory = [];
  state.elapsedSeconds = 0;
  workoutPowerSamples = [];
  state.totalDistance = 0.0;
  state.totalAscent = 0.0;
  state.currentRouteIndex = 0;
  state.isMapFollowingRoute = state.mapInitialOrientation === "RUTA";
  state.currentSlope = 0.0;
  state.targetSlope = 0.0;
  state.virtualGear = state.virtualGearsEnabled
    ? clampVirtualGear(state.initialVirtualGear || DEFAULT_VIRTUAL_GEAR)
    : DEFAULT_VIRTUAL_GEAR;
  updateVirtualGearDisplay();
  updateVirtualGearVisibility();
  state.lastSlopeRampTime = 0;
  state.timeInPowerZones = [0, 0, 0, 0, 0, 0];
  state.isPaused = false;
  state.isAutoPaused = false;
  state.isSessionActive = false;
  state.routeTotalAscent = 0;
  kilojuliosAcumulados = 0;
  state.kilojoules = 0;

  setElText("workout-timer", "00:00:00");
  setElText("metrics-power", "0");
  setElText("metrics-kj", "0");
  setElText("metrics-hr", "0");
  setElText("metrics-cadence", "0");
  setElText("metrics-speed", "0.0");
  setElText("metrics-power-avg", "0 Ø");
  setElText("metrics-hr-avg", "0 Ø");
  setElText("metrics-speed-avg", "0.0 Ø");
  setElText("submetrics-distance", "0.00 km");
  setElText("submetrics-ascent", "0 m");
  setElText("submetrics-remaining", "--");
  setElText("submetrics-remaining-ascent", "--");
  setElDisplay("workout-autopause-label", "none");

  updateClock();
  if (state.clockInterval) clearInterval(state.clockInterval);
  state.clockInterval = setInterval(updateClock, 30000);

  sensorConnections.onStatusChanged("TRAINER", BleManager.connections.TRAINER.status);
  sensorConnections.onStatusChanged("HRM", BleManager.connections.HRM.status);
  sensorConnections.onStatusChanged("POWER", BleManager.connections.POWER.status);
  sensorConnections.onStatusChanged("CSC", BleManager.connections.CSC.status);
  sensorConnections.resetMetricQuality();

  if (BleManager.simulator.isActive) {
    setElDisplay("virtual-trainer-panel", "block");

    // Lógica para el slider de realismo en sesión
    const realismSliderSession = document.getElementById("realism-slider-session");
    const realismValueSession = document.getElementById("realism-value-session");

    if (realismSliderSession && realismValueSession) {
      realismSliderSession.value = Math.round((state.realismFactor || 1.0) * 100);
      realismValueSession.textContent = `${realismSliderSession.value}%`;

      realismSliderSession.oninput = (e) => {
        const value = e.target.value;
        realismValueSession.textContent = `${value}%`;
        state.realismFactor = parseFloat(value) / 100;
        saveStateToLocalStorage();
      };
    }

  } else {
    setElDisplay("virtual-trainer-panel", "none");
  }

  configureWorkoutHudForMode();
  applyWorkoutPanels();

  // Aplicar tamaño de fuente guardado
  const viewport = document.querySelector(".workout-viewport");
  if (viewport) {
    const savedScale = localStorage.getItem("rodilloint_fontSize");
    if (savedScale) {
      viewport.style.setProperty("--workout-text-multiplier", savedScale);
    }
  }

  const isRouteMode = state.currentMode === "ROUTE";
  const ghostBanner = document.getElementById("ghost-banner");
  if (ghostBanner) ghostBanner.classList.remove("visible");

  if (isRouteMode) {
    if (state.ghostEnabled && state.gpxFilename) {
      void loadGhostRiderSession();
    }
    initConfiguredMap();
    ChartsManager.initUpcomingChart("upcoming-chart-inner");

    // Mostrar footer de elevación y cargar gráfico si hay puntos
    if (state.routePoints.length > 0) {
      setElDisplay("hud-elevation-footer", "block");
      ChartsManager.initElevationChart(
        "elevation-chart",
        state.routeDistances,
        state.routeElevations,
      );
      // Inicializar el SVG de vista general con la traza completa
      routeOverview.init();
    }

    setTimeout(() => {
      if (state.map) {
          if (typeof state.map.resize === 'function') {
              state.map.resize();
          } else if (typeof state.map.invalidateSize === 'function') {
              state.map.invalidateSize();
          }
      }
      // Botón para alternar modo mapa (Norte/Ruta)
      createOrientationToggleButton();

      if (state.routePoints.length > 0) {
          drawRouteOnMap();
          refreshUpcomingPreview(0);
          updateRouteProgressHud();
      }
    }, 150);
  }

  updatePauseButton("▶ Empezar");
}

// --- GPX ROUTE LOADER & PARSER ---
async function handleGpxUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  state.fullscreenFilePickerActive = false;
  const shouldRecoverFullscreen = state.fullscreenPreference && !document.fullscreenElement;

  // Validación de extensión
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith(".gpx") && !fileName.endsWith(".tcx")) {
    showToast("Por favor, selecciona un archivo válido (.gpx o .tcx).", "warning");
    return;
  }

  state.gpxFilename = file.name;
  state.routeName = file.name.replace(/\.(gpx|tcx)$/i, "");
  state.routeLoadedFromHistory = false;
  const label = document.getElementById("gpx-filename-label");
  const btnPick = document.getElementById("btn-trigger-gpx-pick");

  if (label) label.textContent = `${file.name} (Procesando...)`;
  if (btnPick) {
    btnPick.disabled = true;
    btnPick.textContent = "Procesando...";
  }

  try {
    const text = await file.text();
    if (!text || text.trim().length === 0) throw new Error("Archivo vacío");

    const routeData = await GpxManager.parseRouteAsync(text);

    if (routeData) {
      state.routePoints = routeData.points;
      state.routeElevations = routeData.elevations;
      state.routeDistances = routeData.distances;
      state.currentRouteIndex = 0;
      state.routeTotalAscent = calculateTotalRouteAscent(state.routeElevations);

      initConfiguredMap();
      drawRouteOnMap();
      refreshUpcomingPreview(0);
      updateRouteProgressHud(state);

      setElDisplay("hud-elevation-footer", "block");
      ChartsManager.initElevationChart(
        "elevation-chart",
        state.routeDistances,
        state.routeElevations,
      );

      if (label) label.textContent = file.name;
      if (shouldRecoverFullscreen) showFullscreenRecovery();
    } else {
      throw new Error("No se encontraron puntos de ruta válidos.");
    }
  } catch (err) {
    console.error("Error al procesar el archivo GPX:", err);
    showToast("Error: El archivo no es válido o está corrupto. Asegúrate de que contiene datos de ruta.", "error");
    if (label) label.textContent = "Error al cargar archivo.";
  } finally {
    if (btnPick) {
      btnPick.disabled = false;
      btnPick.textContent = "Seleccionar Archivo GPX";
    }
  }
}

async function loadGhostRiderSession() {
  const ghostBanner = document.getElementById("ghost-banner");
  if (!state.currentUser || !state.ghostEnabled || !state.gpxFilename) {
    state.ghostPoints = [];
    ghostBanner?.classList.remove("visible");
    return;
  }
  try {
    const best = await DbManager.getBestSessionForRoute(
      state.currentUser.id,
      state.gpxFilename,
    );
    if (best) {
      state.ghostStartTime = best.startTime;
      state.ghostPoints = await DbManager.getSensorDataForSession(best.id);

      // Filter valid coordinates
      state.ghostPoints = state.ghostPoints.filter(
        (point) =>
          point.latitude !== null &&
          point.latitude !== undefined &&
          point.longitude !== null &&
          point.longitude !== undefined &&
          point.distance !== null &&
          point.distance !== undefined &&
          point.timestamp !== null &&
          point.timestamp !== undefined &&
          Number.isFinite(Number(point.latitude)) &&
          Number.isFinite(Number(point.longitude)) &&
          Number.isFinite(Number(point.distance)) &&
          Number.isFinite(Number(point.timestamp)),
      );

      if (state.ghostPoints.length > 0) {
        ghostBanner?.classList.add("visible");
        document.getElementById("ghost-time-gap").textContent = "-0:00";
        document.getElementById("ghost-time-gap").className =
          "ghost-value ahead";
        console.log(
          `Ghost Rider loaded from session: ${best.id}. Points count: ${state.ghostPoints.length}`,
        );
      }
    } else {
      state.ghostPoints = [];
      ghostBanner?.classList.remove("visible");
    }
  } catch (e) {
    state.ghostPoints = [];
    ghostBanner?.classList.remove("visible");
    console.error("Failed to load ghost session", e);
  }
}

// --- LEAFLET MAPS ENGINE ---
function initLeafletMap() {
  if (state.map) return;

  // standard Madrid coordinates initial view
  state.map = L.map("workout-map", {
    zoomControl: false,
    attributionControl: false,
  }).setView([40.4168, -3.7038], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(state.map);

  // Custom zoom buttons
  const zoomControl = L.control.zoom({ position: "topright" });
  zoomControl.addTo(state.map);
  requestAnimationFrame(positionMapNavigationControls);
}

function drawRouteOnMap() {
  if (!state.map || state.routePoints.length === 0) return;

  // Verificación de seguridad de coordenadas
  const firstPoint = state.routePoints[0];
  if (!firstPoint || isNaN(firstPoint.lat) || isNaN(firstPoint.lon)) return;

  // Detectar motor: si existe addSource es MapLibre (3D)
  if (state.map.addSource) {
      if (!isMapReady(state.map)) {
          return;
      }

      const geojson = {
          type: 'Feature',
          geometry: {
              type: 'LineString',
              coordinates: state.routePoints.map(p => [p.lon, p.lat])
          }
      };

      // Añadir o actualizar la ruta en MapLibre
      if (state.map.getSource('route')) {
          state.map.getSource('route').setData(geojson);
      } else {
          state.map.addSource('route', { type: 'geojson', data: geojson });
          state.map.addLayer({
              id: 'route',
              type: 'line',
              source: 'route',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#ff5722', 'line-width': 6 }
          });
      }

      // Posicionar cámara en el primer punto
      state.map.jumpTo({
          center: [firstPoint.lon, firstPoint.lat],
          zoom: state.mapViewMode === "3D_FPV" ? 20 : 14,
          pitch: state.mapViewMode === "3D_FPV" ? 82 : 60,
      });
  } else {
      // Lógica original para Leaflet (2D)
      if (state.routePolyline) state.map.removeLayer(state.routePolyline);
      if (state.userMarker) state.map.removeLayer(state.userMarker);
      if (state.ghostMarker) state.map.removeLayer(state.ghostMarker);

      const latLngs = state.routePoints.map((p) => [p.lat, p.lon]);

      state.routePolyline = L.polyline(latLngs, {
          color: "#ff5722",
          weight: 6,
          opacity: 0.85,
      }).addTo(state.map);

      const userIcon = L.divIcon({
          className: "custom-user-marker",
          html: '<div class="user-marker-core"><div class="user-marker-pulse"></div></div>',
          iconSize: [14, 14],
      });

      state.userMarker = L.marker(latLngs[0], {
          icon: userIcon,
          title: "Tú",
      }).addTo(state.map);

      state.map.fitBounds(state.routePolyline.getBounds(), { padding: [20, 20] });
  }
}

async function initializeRemoteRoomPanel() {
  const panel = document.getElementById("remote-room-panel");
  const qr = document.getElementById("remote-room-qr");
  const label = document.getElementById("remote-room-id");
  const status = document.getElementById("remote-room-status");
  if (!panel || !qr || !label || !status) return;

  const initialization = ++remoteRoomInitialization;
  activeRemoteRoomClient?.disconnect();
  activeRemoteRoomClient = null;
  qr.hidden = true;
  qr.removeAttribute("src");
  let roomId;
  let remoteOrigin = window.location.origin;
  let hostSecret = null;
  try {
    if (isRemoteAuthConfigured()) {
      status.textContent = "Creando sala segura...";
      const room = await createRemoteRoom();
      if (initialization !== remoteRoomInitialization) return;
      roomId = room.roomId;
      hostSecret = room.hostSecret;
      remoteOrigin = room.remoteOrigin;
    } else {
      roomId = createRoomId();
    }
  } catch (error) {
    console.error("[Mando móvil] No se pudo crear una sala segura:", error);
    if (initialization === remoteRoomInitialization) {
      label.textContent = "Sala no disponible";
      status.textContent = error.message;
    }
    return;
  }
  const remoteUrl = buildRemoteUrl(roomId, remoteOrigin);

  label.textContent = `Sala: ${roomId}`;
  qr.title = remoteUrl;
  panel.title = `Mando móvil: ${remoteUrl}`;
  void buildQrUrl(remoteUrl)
    .then((qrDataUrl) => {
      if (!qr.isConnected || initialization !== remoteRoomInitialization) return;
      qr.src = qrDataUrl;
      qr.hidden = false;
    })
    .catch((error) => {
      console.error("[Mando móvil] No se pudo generar el QR:", error);
      status.textContent = "No se pudo generar el código QR local.";
    });

  if (!isRemoteAuthConfigured()) {
    status.textContent = "QR listo; mando desactivado hasta configurar la autenticación segura de Ably.";
    return;
  }

  activeRemoteRoomClient = new RemoteRoomClient(roomId, "host", hostSecret);
  status.textContent = "Ably: conectando...";
  activeRemoteRoomClient.onConnectionStateChange((change) => {
    const messages = {
      connecting: "Ably: conectando...",
      connected: "Ably: conectado",
      disconnected: "Ably: conexión perdida, reconectando...",
      suspended: "Ably: conexión suspendida",
      closed: "Ably: desconectado",
      failed: `Ably: error de conexión${change.reason?.message ? ` (${change.reason.message})` : ""}`,
    };
    status.textContent = messages[change.current] || `Ably: ${change.current}`;
  });
  void activeRemoteRoomClient.connect()
    .then(() => {
      const isAuthorized = (payload, message) => {
        const authorized = message?.clientId === "remote";
        if (authorized) {
          status.textContent = "Mando conectado";
          toggleRemoteRoomPanel(false);
        }
        return authorized;
      };
      activeRemoteRoomClient?.on("CHANGE_GEAR", (payload, message) => {
        if (!isAuthorized(payload, message)) return;
        const direction = payload?.direction;
        if (direction !== "up" && direction !== "down") return;
        toggleRemoteRoomPanel(false);
        changeVirtualGear(direction === "up" ? 1 : -1);
      });
      activeRemoteRoomClient?.on("TOGGLE_PAUSE", (payload, message) => {
        if (!isAuthorized(payload, message)) return;
        toggleRemoteRoomPanel(false);
        togglePause();
      });
      activeRemoteRoomClient?.on("STOP_SESSION", (payload, message) => {
        if (!isAuthorized(payload, message)) return;
        toggleRemoteRoomPanel(false);
        if (state.isSessionActive && !state.isPaused) {
          pauseTimer();
        }
        void stopSessionFlow();
      });
      status.textContent = "Ably: conectado; esperando mando";
    })
    .catch((error) => {
      console.error("[Mando móvil] No se pudo abrir la sala Ably:", error);
      status.textContent = error?.message?.includes("Falta configurar")
        ? "Ably: no configurado"
        : "Ably: credencial rechazada";
    });

}

function toggleRemoteRoomPanel(isOpen = null) {
  const panel = document.getElementById("remote-room-panel");
  if (!panel) return;
  const nextIsOpen = isOpen === null
    ? !panel.classList.contains("is-open")
    : isOpen;
  panel.classList.toggle("is-open", nextIsOpen);
  panel.setAttribute("aria-hidden", String(!nextIsOpen));
}

window.toggleRemoteRoomPanel = toggleRemoteRoomPanel;

function disconnectRemoteRoom() {
  activeRemoteRoomClient?.disconnect();
  activeRemoteRoomClient = null;
  toggleRemoteRoomPanel(false);
}

// --- SESSION WORKFLOW CONTROL ---
function togglePause() {
  if (!state.isSessionActive) {
    if (state.currentMode === "ROUTE" && state.routePoints.length === 0) {
      showRouteModal();
      return;
    }
    startSession();
  } else {
    // Toggle Pause Action
    if (state.isPaused) {
      resumeTimer();
    } else {
      pauseTimer();
    }
  }
}

async function startSession() {
  if (!state.currentUser) return;
  if (!sessionSafetyAcknowledged && state.sessionSafetyNoticeEnabled) {
    const acknowledgement = document.getElementById(
      "session-safety-acknowledgement",
    );
    const confirmButton = document.getElementById(
      "btn-session-safety-confirm",
    );
    const skipFutureNotice = document.getElementById(
      "session-safety-skip-future",
    );
    if (acknowledgement) acknowledgement.checked = false;
    if (confirmButton) confirmButton.disabled = true;
    if (skipFutureNotice) skipFutureNotice.checked = false;
    showModal("session-safety");
    return;
  }
  sessionSafetyAcknowledged = false;

  try {
    const sessId = await DbManager.insertSession({
      userId: state.currentUser.id,
      startTime: Date.now(),
      mode: state.currentMode,
      gpxPath: state.currentMode === "ROUTE" ? state.gpxFilename : null,
      routePoints: state.currentMode === "ROUTE"
        ? state.routePoints.map((point) => ({
            lat: Number(point.lat),
            lon: Number(point.lon),
          }))
        : null,
      routeElevations: state.currentMode === "ROUTE"
        ? [...state.routeElevations]
        : null,
      routeDistances: state.currentMode === "ROUTE"
        ? [...state.routeDistances]
        : null,
      routeTotalAscent: state.currentMode === "ROUTE"
        ? state.routeTotalAscent
        : 0,
      routeName: state.currentMode === "ROUTE"
        ? (state.routeName || state.gpxFilename || "Ruta")
        : null,
      virtualGear: state.virtualGear,
      gearRatio: getVirtualGearRatio(state.virtualGear),
    });

    state.currentSessionId = sessId;
    state.isSessionActive = true;
    state.isPaused = false;
    state.isAutoPaused = false;
    state.sessionStartTime = Date.now();
    state.lastSpeedUpdateTime = Date.now();
    state.lastMovementTime = Date.now();
    state.lastWheelRevolutionTime = Date.now();
    state.lastTelemetryTimestamp = Date.now(); // for centralized distance accumulation
    state.lastTelemetrySpeed = state.currentSpeed || 0.0;

    // Clean history array values
    state.powerHistory = [];
    state.hrHistory = [];
    state.speedHistory = [];
    state.elevationHistory = [];
    state.totalDistance = 0.0;
    state.totalAscent = 0.0;
    kilojuliosAcumulados = 0;
    state.kilojoules = 0;
    setElText("metrics-kj", "0");
    state.currentSlope = 0.0;
    state.targetSlope = 0.0;
    state.lastSlopeRampTime = Date.now();

    // Forzamos el estado inicial en el rodillo
    state.currentSlope = 0;
    state.targetSlope = 0;
    applyTrainerSlope(0);

    if (state.currentMode === "ERG") {
      if (!state.currentWorkout) {
        showToast("Primero selecciona un entrenamiento ERG.", "warning");
        navigateTo("workouts");
        state.isSessionActive = false;
        return;
      }
      initWorkoutEngine(state.currentWorkout, state.currentUser?.ftp || 200);
      const initialStatus = tickWorkout(0);
      updateWorkoutErgHud(initialStatus);
      const pills = document.getElementById("workout-erg-panel");
      if (pills) pills.style.display = "block";
    }

    if (state.currentMode === "ROUTE" && state.routePoints.length > 0) {
      routeSimulation.setTargetSlope(0);
      refreshUpcomingPreview(0);
    }

    // Inicializar gráficos manuales si estamos en modo manual
    if (state.currentMode === "MANUAL") {
      window.ChartsManager.initManualTrainingCharts("manual-power-chart", "manual-hr-chart");
      if (state.manualMode === "ERG" && typeof BleManager !== "undefined" && BleManager.connections.TRAINER.status === "CONECTADO") {
        BleManager.setTargetPower(state.targetWatts || 150);
      }
    }

    sensorConnections.startMetricQualityMonitoring();

    // Iniciar cuenta atrás condicional
    const startLogic = () => {
      const runCountdown = () => {
        startCountdown(() => {
          startTimerInterval();
          updatePauseButton("⏸ Pausa");
          console.log(`Active training session started: ${sessId}`);
        }, state.countdownDuration || 3);
      };

      if (state.startOnMovement) {
        // Esperar a que haya movimiento
        console.log("Esperando movimiento para iniciar...");

        // Usamos una función para comprobar el estado
        const checkMovement = () => {
          movementWaitTimer = null;
          if (state.currentPower > 5 || state.currentSpeed > 0.5) {
            runCountdown();
          } else {
            // Reintentar en 1 segundo si aún no hay movimiento
            movementWaitTimer = setTimeout(checkMovement, 1000);
          }
        };

        checkMovement();
      } else {
        runCountdown();
      }
    };

    startLogic();

  } catch (e) {
    console.error(e);
    showToast("No se pudo inicializar la base de datos de entrenamiento.", "error");
  }
}

function confirmSessionSafety() {
  const acknowledgement = document.getElementById(
    "session-safety-acknowledgement",
  );
  if (!acknowledgement?.checked) return;

  const skipFutureNotice = document.getElementById(
    "session-safety-skip-future",
  );
  if (skipFutureNotice?.checked) {
    state.sessionSafetyNoticeEnabled = false;
    saveStateToLocalStorage();
  }
  hideModal("session-safety");
  sessionSafetyAcknowledged = true;
  void startSession();
}

function startTimerInterval() {
  sessionTimer.start((now) => {

      // Acumulación de Kilojulios (kJ) segundo a segundo
      const currentWatts = Number(state.currentPower) || 0;
      kilojuliosAcumulados += (currentWatts / 1000);
      state.kilojoules = kilojuliosAcumulados;
      setElText("metrics-kj", String(Math.round(kilojuliosAcumulados)));

      // 1. Cálculos de velocidad virtual y estado (Modo Ruta)
      if (state.currentMode === "ROUTE") {
        setElText("metrics-speed", state.currentSpeed.toFixed(1));

        if (!state.isPaused && state.currentSpeed > 0) {
          state.speedHistory.push(state.currentSpeed);
        }

        // Auto-pause is based on the last detected wheel revolution, not on
        // residual speed values reported by a trainer or its motor.
        if (
          state.lastWheelRevolutionTime &&
          now - state.lastWheelRevolutionTime >= WHEEL_INACTIVITY_TIMEOUT_MS
        ) {
          state.currentSpeed = 0;
          setElText("metrics-speed", "0.0");
          if (!state.isPaused && !state.isAutoPaused) {
            state.isAutoPaused = true;
            pauseTimer();
          }
        }
      }

      // 2. Rampa de pendiente y Simulador
      stepSlopeRamp();
      if (BleManager.simulator.isActive && state.currentMode === "ROUTE") {
        BleManager.simulator.slope = state.currentSlope;
      }

      // 3. Actualizar UI de tiempo y métricas
      const h = Math.floor(state.elapsedSeconds / 3600);
      const m = Math.floor((state.elapsedSeconds % 3600) / 60);
      const s = state.elapsedSeconds % 60;
      const formatted = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      setElText("workout-timer", formatted);

      if (state.currentMode === "ERG") {
        const workoutStatus = tickWorkout(state.elapsedSeconds);
        if (workoutStatus) {
          if (Date.now() - lastPowerReceivedAt < 5000) {
            const lastSample = workoutPowerSamples[workoutPowerSamples.length - 1];
            if (lastSample?.elapsedSeconds !== state.elapsedSeconds) {
              workoutPowerSamples.push({
                elapsedSeconds: state.elapsedSeconds,
                watts: Math.max(0, Number(state.currentPower) || 0),
                targetWatts: workoutStatus.targetWatts,
              });
            }
          }
          updateWorkoutErgHud(workoutStatus);
        }
      }

      if (state.currentMode === "MANUAL") {
        window.ChartsManager.updateManualTrainingCharts(state.currentPower, state.currentHr);
      }

      // Update distance before refreshing averages, HUD, and map position.
      saveTelemetryPoint();

      if (state.currentMode === "ROUTE") {
        if (window.ChartsManager) {
          window.ChartsManager.setElevationCursor(state.totalDistance, state.routeTotalDistance);
        }
        setElText("submetrics-distance", `${state.totalDistance.toFixed(2)} km`);
        updateRouteProgressHud(state);
        updateRouteSimulation(state.totalDistance);
        routeSimulation.setTargetSlope(state.totalDistance);
        syncSlopeDisplayLabels();
        // Actualizar posición en el mini-mapa de vista general
        routeOverview.updatePosition(state.currentRouteIndex);
      }

      updateSessionAverages();

      const avgPower =
        state.powerHistory.length > 0
          ? Math.round(
              state.powerHistory.reduce((a, b) => a + b, 0) /
                state.powerHistory.length,
            )
          : 0;
      state.calories = Math.round(
        avgPower * (state.elapsedSeconds / 3600.0) * 3.6,
      );

      updateGhostProgress();

      if (state.elapsedSeconds % 30 === 0) {
        flushTelemetryBuffer();
      }
      sensorConnections.refreshMetricQuality();
  });
}

function pauseTimer() {
  sessionTimer.pause();
  state.lastSlopeRampTime = Date.now();
  state.lastTelemetryTimestamp = Date.now();
  state.lastTelemetrySpeed = state.currentSpeed || 0;

  updatePauseButton("▶ Reanudar", "resume");
  if (state.isAutoPaused) {
    setElDisplay("workout-autopause-label", "block");
  }
}

function resumeTimer() {
  sessionTimer.resume();

  state.lastSpeedUpdateTime = Date.now();
  state.lastMovementTime = Date.now();
  state.lastSlopeRampTime = Date.now();
  state.lastTelemetryTimestamp = Date.now();
  state.lastTelemetrySpeed = state.currentSpeed || 0;

  updatePauseButton("⏸ Pausa");
  setElDisplay("workout-autopause-label", "none");
}

async function stopSessionFlow() {
  cancelCountdown();
  if (!state.isSessionActive) {
    disconnectRemoteRoom();
    setElDisplay("manual-mode-panel", "none");
    setElDisplay("workout-erg-panel", "none");
    setElDisplay("virtual-trainer-panel", "none");
    document.getElementById("ghost-banner")?.classList.remove("visible");
    navigateTo("dashboard");
    return;
  }

  const confirmStop = await showConfirm(
    "¿Quieres finalizar y guardar el entrenamiento actual?",
  );
  if (!confirmStop) return;

  BleManager.stopAutoReconnect();
  sessionTimer.stop();

  state.isSessionActive = false;
  sensorConnections.stopMetricQualityMonitoring();
  if (state.currentMode === "ERG") {
    resetWorkoutEngine();
    updateWorkoutErgHud(null);
  }
  state.lastSavedSessionId = state.currentSessionId;
  state.summaryReturnScreen = "dashboard";

  // Calculate average telemetry fields
  const avgPower =
    state.powerHistory.length > 0
      ? Math.round(
          state.powerHistory.reduce((a, b) => a + b, 0) /
            state.powerHistory.length,
        )
      : 0;
  const maxPower =
    state.powerHistory.length > 0 ? Math.max(...state.powerHistory) : 0;
  const maxSpeed =
    state.speedHistory.length > 0
      ? Math.max(...state.speedHistory)
      : state.currentSpeed || 0;

  const avgHr =
    state.hrHistory.length > 0
      ? Math.round(
          state.hrHistory.reduce((a, b) => a + b, 0) / state.hrHistory.length,
        )
      : 0;
  const maxHr = state.hrHistory.length > 0 ? Math.max(...state.hrHistory) : 0;

  // Normalized Power, TSS, IF calculations
  const ftp = state.currentUser ? state.currentUser.ftp : 200;
  const np = Math.round(calculateNormalizedPower());
  const intensityFactor = ftp > 0 ? parseFloat((np / ftp).toFixed(2)) : 0.0;
  const tss =
    ftp > 0
      ? Math.round((state.elapsedSeconds * np * intensityFactor) / (ftp * 36))
      : 0;

  // Distance / Speed averages
  const duration = document.getElementById("workout-timer").textContent;
  let finalDistance = state.totalDistance; // km

  try {
    setSessionSaveStatus("Guardando sesión...", "var(--accent-blue)");
    // Guardar los puntos pendientes en el búfer
    await flushTelemetryBuffer();

    // Use the live state.totalDistance as canonical finalDistance to keep HUD and summary consistent
    try {
      await DbManager.getSensorDataForSession(state.currentSessionId); // ensure telemetry flushed/accessible
    } catch (e) {
      console.warn('Failed to access telemetry for finalization:', e);
    }
    finalDistance = state.totalDistance;

    const currentSession = await DbManager.getSessionById(
      state.currentSessionId,
    );
    const endTime = Date.now();
    const totalDurationSeconds = currentSession
        ? Math.max(0, (endTime - currentSession.startTime) / 1000)
        : state.elapsedSeconds;
    const totalDuration = new Date(totalDurationSeconds * 1000)
        .toISOString()
        .substr(11, 8);

    const avgSpeed =
        finalDistance > 0 && state.elapsedSeconds > 0
        ? finalDistance / (state.elapsedSeconds / 3600.0)
        : 0.0;

    // Update DB Session headers
    if (currentSession) {
      await DbManager.updateSession({
        ...currentSession,
        endTime,
        totalDistance: finalDistance,
        activeDuration: state.elapsedSeconds,
        totalDuration: totalDurationSeconds,
        normalizedPower: np,
        tss,
        intensityFactor,
        calories: state.calories,
        kilojoules: Math.round(kilojuliosAcumulados),
        maxSpeed,
        maxHeartRate: maxHr,
        averageSpeed: avgSpeed,
        averagePower: avgPower,
        averageHeartRate: avgHr,
      });
    }
    let backupStatusMessage = "Sesión guardada correctamente";
    if (state.autoBackupOnSessionEnd) {
      try {
        await exportAllData({ automatic: true });
        backupStatusMessage = "Sesión guardada; descarga del backup iniciada";
      } catch (backupError) {
        console.error("No se pudo descargar el backup automático:", backupError);
        backupStatusMessage = "Sesión guardada; no se pudo iniciar el backup";
      }
    }
    setSessionSaveStatus(
      backupStatusMessage,
      backupStatusMessage.includes("no se pudo")
        ? "var(--accent-orange)"
        : "var(--accent-green)",
    );

    renderSummaryMetrics({
      duration,
      totalDuration,
      distance: finalDistance,
      np,
      tss,
      intensityFactor,
      calories: state.calories,
      kilojoules: Math.round(kilojuliosAcumulados),
      avgPower,
      maxPower,
      avgSpeed,
      maxSpeed,
      avgHr,
      maxHr,
      timeInPowerZones: state.timeInPowerZones,
      workoutAdherence: state.currentMode === "ERG" ? getWorkoutPowerAdherence(workoutPowerSamples) : null,
    });

    if (activeRemoteRoomClient) {
      try {
        await activeRemoteRoomClient.emit("SESSION_SUMMARY", {
          duration,
          distance: finalDistance,
          avgSpeed,
          maxSpeed,
          avgPower,
          maxPower,
          avgHr,
          maxHr,
          ascent: state.totalAscent,
          calories: state.calories,
          kilojoules: Math.round(kilojuliosAcumulados),
          np,
          tss,
        });
      } catch (remoteError) {
        console.warn(
          "La sesión se guardó, pero no se pudo enviar el resumen al mando remoto:",
          remoteError,
        );
      }
    }
    disconnectRemoteRoom();

    // Ocultar elementos de la UI del entrenamiento
    document
      .getElementById("hud-top-bar")
      ?.style.setProperty("display", "none");
    document
      .getElementById("hud-bottom-left")
      ?.style.setProperty("display", "none");
    document
      .getElementById("hud-bottom-right-group")
      ?.style.setProperty("display", "none");
    document
      .getElementById("manual-mode-panel")
      ?.style.setProperty("display", "none");
    document
      .getElementById("virtual-trainer-panel")
      ?.style.setProperty("display", "none");
    document
      .getElementById("elevation-chart-cursor")
      ?.style.setProperty("display", "none");
    document
      .getElementById("ghost-banner")
      ?.style.setProperty("display", "none");

    navigateTo("summary");
    renderSummaryRoute(
      currentSession || {
        routePoints: state.currentMode === "ROUTE" ? state.routePoints : null,
        routeDistances: state.currentMode === "ROUTE" ? state.routeDistances : null,
        routeElevations: state.currentMode === "ROUTE" ? state.routeElevations : null,
      },
      finalDistance,
    );
  } catch (e) {
    disconnectRemoteRoom();
    setSessionSaveStatus("Error al guardar la sesión", "var(--accent-red)");
    console.error("Failed to close session", e);
    navigateTo("dashboard");
  }
}

// --- GPX ROUTE SIMULATION UPDATES ---
function updateRouteSimulation(currentDistKm) {
  if (state.currentMode !== "ROUTE" || state.routePoints.length === 0) return;

  // Find closest point indexes along distances array
  let index = state.routeDistances.findIndex((d) => d >= currentDistKm);
  if (index === -1) index = state.routeDistances.length - 1;
  index = Math.max(0, Math.min(state.routePoints.length - 1, index));

  if (index !== state.currentRouteIndex) {
      state.currentRouteIndex = index;
      const point = state.routePoints[index];

      // 1. Mover Marcador/Posición
      // ... (código existente de posición)

      // 2. Actualizar el gráfico "Prox 500m" y el desnivel
      refreshUpcomingPreview(currentDistKm);

      if (index < state.routePoints.length - 1) {
          const elevationDiffMeters = state.routeElevations[index + 1] - state.routeElevations[index];
          if (elevationDiffMeters > 0) {
              state.totalAscent += elevationDiffMeters;
              setElText("submetrics-ascent", `${Math.round(state.totalAscent)} m`);
              updateRouteProgressHud();
          }
      }
  }

  // 2. Sync elevation chart cursor (always for smooth movement)
  const totalDistKm =
    state.routeDistances[state.routeDistances.length - 1] || 0.1;
  ChartsManager.setElevationCursor(currentDistKm, totalDistKm);

    // Lógica para banner de alerta de distancia restante
    const remaining = (state.routeDistances[state.routeDistances.length - 1] - currentDistKm);
    const thresholds = [20, 10, 5, 4, 3, 2, 1];
    const trigger = thresholds.find(t => Math.abs(remaining - t) < 0.05);

    if (trigger && state.lastAlertedThreshold !== trigger) {
        state.lastAlertedThreshold = trigger;
        const banner = document.getElementById("route-alert-banner");
        if (banner) {
            banner.textContent = `¡Quedan ${trigger} km para el final!`;
            banner.style.display = "block";
            setTimeout(() => { banner.style.display = "none"; }, 3000);
        }
    }

    // Actualizar posición del usuario en el mapa según el motor
    const point = state.routePoints[state.currentRouteIndex];
    if (!point) return;
    if (state.map.addSource) {
        if (!isMapReady(state.map)) return;
        const posicionCiclistaActual = mapCamera.normalizeLngLat({
            lon: point.lon,
            lat: point.lat,
        });
        if (!posicionCiclistaActual) return;
        const puntoSiguienteData = state.routePoints[
            Math.min(state.currentRouteIndex + 5, state.routePoints.length - 1)
        ] || point;
        const posicionCiclistaSiguiente = mapCamera.normalizeLngLat({
            lon: puntoSiguienteData.lon,
            lat: puntoSiguienteData.lat,
        }) || posicionCiclistaActual;

        // Motor 3D (MapLibre)
        if (!state.map.getSource('user-location')) {
            state.map.addSource('user-location', {
                type: 'geojson',
                data: { type: 'Point', coordinates: posicionCiclistaActual },
            });
            state.map.addLayer({
                id: 'user-location',
                type: 'circle',
                source: 'user-location',
                paint: { 'circle-radius': 8, 'circle-color': '#4264fb', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
            });
        } else {
            state.map.getSource('user-location').setData({
                type: 'Point',
                coordinates: posicionCiclistaActual,
            });
        }
        if (state.map.getLayer("user-location")) {
            state.map.setLayoutProperty(
                "user-location",
                "visibility",
                state.mapViewMode === "3D_FPV" ? "none" : "visible",
            );
        }
        // Seguimiento suave de cámara y rotación según rumbo
        const center = posicionCiclistaActual;
        const options = { center, pitch: 60, essential: true };

        if (state.mapViewMode === "3D_FPV") {
            logFpvDebug("Actualizando desde telemetría", {
                routeIndex: state.currentRouteIndex,
                position: posicionCiclistaActual,
                nextPosition: posicionCiclistaSiguiente,
            });
            mapCamera.updateFpvCamera(
                posicionCiclistaActual,
                posicionCiclistaSiguiente,
                state.isMapFollowingRoute,
            );
            if (!mapCamera.isAnimationFrameActive()) mapCamera.startFpvCameraLoop();
        } else if (state.isMapFollowingRoute) {
            // Calcular el rumbo (bearing) del movimiento actual
            const dx = posicionCiclistaSiguiente[0] - posicionCiclistaActual[0];
            const dy = posicionCiclistaSiguiente[1] - posicionCiclistaActual[1];
            const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
            options.bearing = bearing;
        } else {
            // Resetear la orientación al Norte
            options.bearing = 0;
        }

        if (
            state.mapViewMode !== "3D_FPV" &&
            mapCamera.isValidLngLat(options.center) &&
            Number.isFinite(options.bearing)
        ) {
            try {
                state.map.flyTo(options);
            } catch (mapUpdateError) {
                console.error("Error controlado actualizando el mapa:", mapUpdateError);
            }
        }
    } else {
        // Motor 2D (Leaflet) - Actualizar marcador
        if (state.userMarker) {
            state.userMarker.setLatLng([point.lat, point.lon]);

            if (state.isMapFollowingRoute) {
                // Leaflet no tiene rotación nativa integrada de mapa de la misma manera que 3D,
                // pero podemos orientar el marcador o rotar el mapa si se usara un plugin.
                // Lo más estándar sin plugins pesados es ajustar la vista para seguir la dirección (Rumbo)
                // calculando un ángulo. Como mínimo, panteamos al marcador para mantenerlo centrado.
                state.map.panTo([point.lat, point.lon]);
            } else {
                // Modo Norte estándar (mantener centrado)
                state.map.panTo([point.lat, point.lon]);
            }
        }
    }
  }

function updateVirtualGearDisplay() {
  setElText("metrics-gear", formatVirtualGear(state.virtualGear));
}

function updateVirtualGearVisibility() {
  const control = document.getElementById("virtual-gear-control");
  if (control) control.style.display = state.virtualGearsEnabled ? "flex" : "none";
}

function changeVirtualGear(delta) {
  if (!state.virtualGearsEnabled) return;
  const nextGear = clampVirtualGear(state.virtualGear + delta);
  if (nextGear === state.virtualGear) return;

  state.virtualGear = nextGear;
  const userKey = state.currentUser?.uuid || state.currentUser?.id;
  if (userKey) state.virtualGearByUser[userKey] = nextGear;
  saveStateToLocalStorage();
  updateVirtualGearDisplay();

  if (state.currentMode === "ROUTE" && state.isSessionActive) {
    routeSimulation.setTargetSlope(state.totalDistance);
  }
}

function applyTrainerSlope(slope) {
  BleManager.setTrainerSlope(slope);
}

function syncSlopeDisplayLabels() {
  const formatted = `${state.currentSlope >= 0 ? "+" : ""}${state.currentSlope.toFixed(1)}%`;

  // Actualizar etiqueta en panel manual
  const manualLabel = document.getElementById("manual-slope-label");
  if (manualLabel) manualLabel.textContent = formatted;

  // Actualizar etiqueta de depuración/envío
  const sentLabel = document.getElementById("current-slope-sent-label");
  if (sentLabel) {
    sentLabel.textContent = `Rodillo: ${formatted}`;
  }

  // Actualizar etiqueta principal del HUD (metrics-slope)
  // Ahora el usuario ve exactamente lo que el rodillo está aplicando
  const slopeEl = document.getElementById("metrics-slope");
  const trainerSlopeValue = document.getElementById("metrics-trainer-slope");
  if (trainerSlopeValue) trainerSlopeValue.textContent = formatted;

  const routeSlopeValue = document.getElementById("metrics-route-slope");
  const routeSlope =
    routeSimulation.getRouteSlopeAtDistance(state.totalDistance);
  if (routeSlopeValue) {
    routeSlopeValue.textContent = `${routeSlope >= 0 ? "+" : ""}${routeSlope.toFixed(1)}%`;
  }

  const slopeColor = (slope) => {
    if (slope < 0) return "#10b981";
    if (slope <= 3) return "#059669";
    if (slope <= 7) return "#f59e0b";
    if (slope <= 10) return "#f97316";
    if (slope <= 15) return "#ef4444";
    return "#7f1d1d";
  };
  const trainerReading = document.getElementById("trainer-slope-reading");
  const routeReading = document.getElementById("route-slope-reading");
  if (trainerReading) trainerReading.style.background = slopeColor(state.currentSlope);
  if (routeReading) routeReading.style.background = slopeColor(routeSlope);
  if (slopeEl) {
    slopeEl.style.display = state.currentMode === "ROUTE" ? "flex" : "none";
  }
}

function updateTrainerSlope(slope, immediate = false) {
  const coerced = routeSimulation.coerceSlope(slope);

  if (immediate || state.currentMode !== "ROUTE") {
    state.targetSlope = coerced;
    state.currentSlope = coerced;
    syncSlopeDisplayLabels();
    applyTrainerSlope(coerced);
    return;
  }

  state.targetSlope = coerced;
}

function stepSlopeRamp(now = Date.now()) {
  if (
    state.currentMode !== "ROUTE" ||
    !state.isSessionActive ||
    state.isPaused
  ) {
    if (state.isSessionActive) state.lastSlopeRampTime = now;
    return;
  }

  if (!state.lastSlopeRampTime) {
    state.lastSlopeRampTime = now;
    return;
  }

  const deltaSec = (now - state.lastSlopeRampTime) / 1000;
  // Bajamos a 1.5s para asegurar que entre en cada ciclo de 2s del timer
  if (deltaSec < 1.5) return;
  state.lastSlopeRampTime = now;

  const target = state.targetSlope;
  const current = state.currentSlope;
  const diff = target - current;

  if (Math.abs(diff) < 0.05) {
    if (Math.abs(diff) > 0) {
      state.currentSlope = target;
      syncSlopeDisplayLabels();
      applyTrainerSlope(target);
    }
    return;
  }

  const maxChange = MAX_SLOPE_CHANGE_PER_SEC * deltaSec;
  const newSlope =
    Math.abs(diff) <= maxChange
      ? target
      : current + Math.sign(diff) * maxChange;

  state.currentSlope = newSlope;
  syncSlopeDisplayLabels();
  applyTrainerSlope(newSlope);
}

function adjustManualPower(delta) {
  const newWatts = Math.max(50, state.targetWatts + delta * 10);
  console.log(`[Manual ERG] Ajustando potencia: ${state.targetWatts}W -> ${newWatts}W`);
  BleManager.setTargetPower(newWatts);
  state.targetWatts = newWatts;
  setElText("manual-slope-label", `${newWatts} W`);
}

function adjustManualSlope(delta) {
  const newSlope = state.currentSlope + delta;
  console.log(`[Manual Slope] Ajustando manualmente: ${state.currentSlope} -> ${newSlope}`);
  updateTrainerSlope(newSlope, true);
}

function applySlopeTrendStyle(slope, slopeLabel, arrowLabel) {
  if (!slopeLabel || !arrowLabel) return;

  slopeLabel.textContent = `${slope >= 0 ? "+" : ""}${slope.toFixed(1)}%`;

  if (slope > 1.0) {
    arrowLabel.textContent = "🔺";
    slopeLabel.style.color = "#ef4444";
  } else if (slope > 0.2) {
    arrowLabel.textContent = "↗️";
    slopeLabel.style.color = "#f97316";
  } else if (slope < -1.0) {
    arrowLabel.textContent = "🔻";
    slopeLabel.style.color = "#10b981";
  } else if (slope < -0.2) {
    arrowLabel.textContent = "↘️";
    slopeLabel.style.color = "#10b981";
  } else {
    arrowLabel.textContent = "➡️";
    slopeLabel.style.color = "#9ca3af";
  }
}

function refreshUpcomingPreview(currentDistKm = null) {
  const distKm =
    currentDistKm !== null
      ? currentDistKm
      : state.routeDistances[state.currentRouteIndex] || 0;

  const preview = routeSimulation.getUpcoming(500, distKm);
  if (!preview) return;

  const slope = preview.avgSlope;
  const upcomingSlopeLabel = document.getElementById("upcoming-slope-label");
  if (upcomingSlopeLabel) {
    upcomingSlopeLabel.textContent =
      `⛰️ ${slope >= 0 ? "+" : ""}${slope.toFixed(1)}%`;
  }

  ChartsManager.updateUpcomingChart(
    preview.distances,
    preview.elevations,
    slope,
  );
}

// --- GHOST RIDER GAP AND METRICS UPDATE ---
function updateGhostProgress() {
  if (
    !state.ghostPoints ||
    state.ghostPoints.length === 0 ||
    !state.isSessionActive ||
    state.isPaused
  )
    return;

  const currentElapsedMillis = state.elapsedSeconds * 1000;
  const currentDist = state.totalDistance;

  // Find closest point by distance in ghost rider list
  let closest = state.ghostPoints[0];
  let minDist = Math.abs(closest.distance - currentDist);

  for (let i = 1; i < state.ghostPoints.length; i++) {
    const d = Math.abs(state.ghostPoints[i].distance - currentDist);
    if (d < minDist) {
      minDist = d;
      closest = state.ghostPoints[i];
    }
  }

  if (closest && closest.latitude !== null && closest.longitude !== null) {
    // Draw/Move ghost marker
    if (state.map) {
      if (typeof state.map.addSource === "function") {
        if (!isMapReady(state.map)) {
          return;
        }
        const ghostCoordinates = [Number(closest.longitude), Number(closest.latitude)];
        if (!mapCamera.isValidLngLat(ghostCoordinates)) return;

        const ghostData = {
          type: "Feature",
          geometry: { type: "Point", coordinates: ghostCoordinates },
          properties: {},
        };
        if (!state.map.getSource("ghost-location")) {
          state.map.addSource("ghost-location", {
            type: "geojson",
            data: ghostData,
          });
          state.map.addLayer({
            id: "ghost-location",
            type: "circle",
            source: "ghost-location",
            paint: {
              "circle-radius": 7,
              "circle-color": "#39ff88",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#123d28",
            },
          });
        } else {
          state.map.getSource("ghost-location").setData(ghostData);
        }
      } else if (!state.ghostMarker) {
        // Create green neon icon or marker for rival ghost in Leaflet.
        const ghostIcon = L.divIcon({
          className: "custom-ghost-marker",
          html: '<div class="ghost-marker-core"></div>',
          iconSize: [12, 12],
        });
        state.ghostMarker = L.marker([closest.latitude, closest.longitude], {
          icon: ghostIcon,
        }).addTo(state.map);
      } else {
        state.ghostMarker.setLatLng([closest.latitude, closest.longitude]);
      }
    }

    // Compute Time Gap
    const ghostElapsedMillis = closest.timestamp - state.ghostStartTime;
    const gapSeconds = Math.round(
      (ghostElapsedMillis - currentElapsedMillis) / 1000,
    );

    state.ghostTimeGap = gapSeconds;

    const prefix = gapSeconds >= 0 ? "-" : "+"; // (-) means user is ahead, (+) means behind
    const absSeconds = Math.abs(gapSeconds);
    const m = Math.floor(absSeconds / 60);
    const s = absSeconds % 60;

    const formatted = `${prefix}${m}:${String(s).padStart(2, "0")}`;
    const valueLabel = document.getElementById("ghost-time-gap");
    valueLabel.textContent = formatted;

    if (gapSeconds >= 0) {
      valueLabel.className = "ghost-value ahead";
    } else {
      valueLabel.className = "ghost-value behind";
    }
  }
}

function createOrientationToggleButton() {
    console.log("Configurando funcionalidad del botón de orientación...");
    const btn = document.getElementById("btn-orient-toggle");
    if (!btn) {
        console.warn("No se encontró el botón btn-orient-toggle en el DOM.");
        return;
    }

    // Inicializar texto según estado actual
    btn.textContent = state.isMapFollowingRoute ? "⬆️ Ruta" : "🗺️ Norte";

    // Solo añadimos el evento de clic y la actualización del estado
    btn.onclick = () => {
        state.isMapFollowingRoute = !state.isMapFollowingRoute;
        btn.textContent = state.isMapFollowingRoute ? "⬆️ Ruta" : "🗺️ Norte";
    };
}

window.toggleMapEngine = function(btn) {
    console.log("¡Clic recibido en toggleMapEngine!");
    mapCamera.stopFpvCameraLoop();
    const container = document.getElementById("workout-map");
    const currentMode = state.mapViewMode || (state.mapType === "leaflet" ? "2D" : "3D_AEREO");
    const nextMode = MAP_VIEW_MODES[(MAP_VIEW_MODES.indexOf(currentMode) + 1) % MAP_VIEW_MODES.length];
    state.mapViewMode = nextMode;
    state.mapType = nextMode === "2D" ? "leaflet" : "maplibre";
    if (nextMode === "3D_FPV") {
        state.isMapFollowingRoute = true;
    }
    saveStateToLocalStorage();

    if (nextMode === "2D") {
        console.log("Cambiando a motor Leaflet 2D...");
        if (state.map) {
            state.map.remove();
            state.map = null;
        }
        mapReadyInstance = null;
        container.className = "workout-map-fullscreen";
        container.style.height = "100%";
        container.style.width = "100%";

        btn.textContent = mapCamera.getMapViewLabel(nextMode);
        initLeafletMap();
        drawRouteOnMap();

        // Re-configurar botón de orientación para 2D Leaflet
        createOrientationToggleButton();
    }
    else {
        console.log(`Cambiando a motor MapLibre ${nextMode}...`);
        if (!MAPTILER_API_KEY) {
            showToast("El mapa 3D no está configurado: falta la clave de MapTiler.", "warning");
            return;
        }

        if (state.map) {
            state.map.remove();
            state.map = null;
        }
        mapReadyInstance = null;
        btn.textContent = mapCamera.getMapViewLabel(nextMode);

        container.className = "workout-map-fullscreen";
        container.style.height = "100%";
        container.style.width = "100%";

        try {
            const mapSdk = getMapSdk();
            if (!mapSdk?.Map) {
                throw new Error("El SDK 3D no está disponible.");
            }

            state.map = new mapSdk.Map({
                container: 'workout-map',
                style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`,
                center: state.routePoints.length > 0 ? [state.routePoints[0].lon, state.routePoints[0].lat] : [-1.9297, 43.3178],
                zoom: 14,
                pitch: nextMode === "3D_FPV" ? 82 : 60,
                maxPitch: 85,
                antialias: true
            });
            const mapInstance = state.map;

            // Añadir controles de navegación (Zoom y Brújula)
            state.map.addControl(new mapSdk.NavigationControl({
                showCompass: true,
                showZoom: true
            }), 'top-right');

            state.map.on("load", () => {
                if (state.map !== mapInstance) return;
                mapReadyInstance = mapInstance;
                console.log(`Mapa ${nextMode} cargado correctamente.`);
                logFpvDebug("Mapa cargado", {
                    mode: nextMode,
                    routePoints: state.routePoints.length,
                    currentRouteIndex: state.currentRouteIndex,
                    hasFreeCamera:
                        typeof state.map.getFreeCameraOptions === "function" &&
                        typeof state.map.setFreeCameraOptions === "function",
                    sdk: getMapSdk()?.version || "desconocido",
                });
                if (typeof state.map.setFog === "function") {
                    state.map.setFog({
                        range: [0.5, 10],
                        color: "#ffffff",
                        "horizon-blend": 0.1,
                    });
                }
                state.map.setMaxPitch(85);
                if (nextMode === "3D_FPV") state.map.setPitch(85);
                if (nextMode === "3D_FPV" && !state.map.getSource("terrain")) {
                    state.map.addSource("terrain", {
                        type: "raster-dem",
                        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_API_KEY}`,
                        tileSize: 256,
                        encoding: "mapbox",
                    });
                    state.map.setTerrain({ source: "terrain", exaggeration: 1 });
                }
                state.map.resize();
                requestAnimationFrame(positionMapNavigationControls);
                drawRouteOnMap();

                // Re-configurar botón de orientación para 3D MapLibre
                createOrientationToggleButton();
                if (nextMode === "3D_FPV" && state.routePoints.length > 0) {
                    const point = state.routePoints[state.currentRouteIndex];
                    const nextPoint = state.routePoints[Math.min(state.currentRouteIndex + 1, state.routePoints.length - 1)];
                    mapCamera.updateFpvCamera(
                        [point.lon, point.lat],
                        [nextPoint.lon, nextPoint.lat],
                        state.isMapFollowingRoute,
                    );
                    mapCamera.startFpvCameraLoop();
                }
            });

            let mapErrorAlertShown = false;
            const reportedMapErrors = new Set();
            state.map.on("error", (e) => {
                const mapError = e?.error;
                const status = e?.error?.status;
                if (!mapErrorAlertShown && (status === 401 || status === 403)) {
                    mapErrorAlertShown = true;
                    showToast("Error de autorización del mapa 3D. Revisa la clave de MapTiler.", "error");
                }
                const errorMessage = mapError?.message || String(mapError || "");
                if (errorMessage && !reportedMapErrors.has(errorMessage)) {
                    reportedMapErrors.add(errorMessage);
                    console.warn("MapLibre notificó un recurso no disponible:", errorMessage);
                }
            });
        } catch (err) {
            console.error("Error inicialización MapLibre:", err);
            state.mapViewMode = "3D_AEREO";
            state.mapType = "maplibre";
            btn.textContent = mapCamera.getMapViewLabel(state.mapViewMode);
        }
    }
};

async function handleSessionExport() {
  if (!state.currentSessionId && !state.lastSavedSessionId) return;
  const sId = state.lastSavedSessionId || state.currentSessionId;

  try {
    const session = await DbManager.getSessionById(sId);
    const data = await DbManager.getSensorDataForSession(sId);

    if (session && data.length > 0) {
      const uName = state.currentUser ? state.currentUser.name : "Usuario";
      if (!session.gpxPath) {
        showToast("Las sesiones manuales no tienen una ruta GPS para exportar.", "info");
        return;
      }
      if (!GpxManager.exportSession(session, data, uName)) {
        showToast("Esta sesión no contiene coordenadas GPS válidas para exportar.", "warning");
      }
    } else {
      showToast("Error: No hay datos de telemetría válidos para exportar.", "error");
    }
  } catch (e) {
    console.error(e);
  }
}
window.handleSessionExport = handleSessionExport;

async function handleSessionFitExport() {
  if (!state.currentSessionId && !state.lastSavedSessionId) return;
  const sessionId = state.lastSavedSessionId || state.currentSessionId;

  try {
    const session = await DbManager.getSessionById(sessionId);
    const data = await DbManager.getSensorDataForSession(sessionId);

    if (!session || data.length === 0) {
      showToast("Error: No hay datos de telemetría válidos para exportar.", "error");
      return;
    }

    const userName = state.currentUser ? state.currentUser.name : "Usuario";
    if (!GpxManager.exportSessionFit(session, data, userName)) {
      showToast("No se pudo generar el archivo FIT de esta sesión.", "error");
    }
  } catch (error) {
    console.error("Error exportando FIT de la sesión:", error);
    showToast("No se pudo exportar el FIT de la sesión.", "error");
  }
}
window.handleSessionFitExport = handleSessionFitExport;

async function handleSessionCsvExport() {
  if (!state.currentSessionId && !state.lastSavedSessionId) return;
  const sessionId = state.lastSavedSessionId || state.currentSessionId;

  try {
    const session = await DbManager.getSessionById(sessionId);
    const data = await DbManager.getSensorDataForSession(sessionId);

    if (!session || data.length === 0) {
      showToast("Error: No hay datos de telemetría válidos para exportar.", "error");
      return;
    }

    const userName = state.currentUser ? state.currentUser.name : "Usuario";
    if (!GpxManager.exportSessionCsv(session, data, userName)) {
      showToast("No se pudo generar el archivo CSV de esta sesión.", "error");
    }
  } catch (error) {
    console.error("Error exportando CSV de la sesión:", error);
    showToast("No se pudo exportar el CSV de la sesión.", "error");
  }
}
window.handleSessionCsvExport = handleSessionCsvExport;


// --- HISTORY AND STATISTICS SCREENS --- (migrado a js/core/history.js)
// loadHistoryList, deleteHistorySession, openHistoricalSessionSummary,
// checkPendingSessions, downloadSpecificHistoryCsv, downloadSpecificHistoryFit,
// repeatRouteFromHistory, loadProgressStats, renderTrainingCalendar,
// changeTrainingCalendarMonth, selectTrainingCalendarDate, goToTrainingCalendarToday


window.changeFpvZoom = mapCamera.changeZoom;

window.addEventListener("keydown", (event) => {
  if (event.key === "+") {
    mapCamera.changeZoom(1);
  } else if (event.key === "-") {
    mapCamera.changeZoom(-1);
  }
});
