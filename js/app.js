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
  createRoomId,
  getRemoteRoomId,
  isRemoteRoute,
} from "./modules/remoteRoom.js";
import {
  clampVirtualGear,
  DEFAULT_VIRTUAL_GEAR,
  formatVirtualGear,
  getVirtualGearRatio,
  calculateVirtualResistanceSlope,
} from "./modules/virtualGears.js";
import { exportAllData, getBackupStatus } from "./db.js";
import {
  calculateNormalizedPowerFromValues,
  calculateIntensityFactor,
  calculateTSS,
  calculateKilojoulesStep,
  calculateVirtualSpeed,
  getPowerZone,
} from "./core/physics.js";
import {
  changeTrainingCalendarMonth,
  selectTrainingCalendarDate,
  goToTrainingCalendarToday,
  loadProgressStats,
} from "./ui/calendarView.js";
import {
  initRoutesView,
  renderRouteLibrary,
  setRouteLibraryFilter,
  saveUserRoute,
  populateSessionSavedRoutes,
  loadSavedRouteInSessionModal,
} from "./ui/routesView.js";
import {
  initHistoryView,
  loadHistoryList,
  renameHistoryRoute,
  openHistoricalSessionSummary,
  downloadSpecificHistoryCsv,
  downloadSpecificHistoryFit,
  checkPendingSessions,
} from "./ui/historyView.js";
import {
  initUserView,
  loadProfilesGrid,
  selectUser,
  handleLogout,
  handleAddUserSubmit,
  handleEditUserSubmit,
  handleImportUserSubmit,
  handleDeleteProfile,
  handleExportProfile,
} from "./ui/userView.js";
import {
  SLOPE_AVERAGE_METERS,
  SLOPE_PREVIEW_LONG_METERS,
  initRouteOverviewSvg,
  updateRouteOverviewPosition,
  calculateTotalRouteAscent,
  getElevationAtDistance,
  getUpcomingSegmentData,
  applySlopeTrendStyle,
  refreshUpcomingPreview,
} from "./ui/routeOverviewSvg.js";
import {
  MAP_VIEW_MODES,
  initConfiguredMap,
  initLeafletMap,
  drawRouteOnMap,
  positionMapNavigationControls,
  createOrientationToggleButton,
  toggleMapEngine,
  updateFpvCamera,
  startFpvCameraLoop,
  stopFpvCameraLoop,
  isFpvCameraLoopRunning,
  isMapReady,
  isValidLngLat,
  normalizeLngLat,
  logFpvDebug,
} from "./ui/mapEngine.js";
import {
  applyWorkoutLayout,
  cycleWorkoutLayout,
  applyWorkoutPanels,
  toggleWorkoutPanel,
  updateFullscreenButton,
  saveFullscreenPreference,
  toggleFullscreen,
  showFullscreenRecovery,
  closeFullscreenRecovery,
  reactivateFullscreen,
  setWorkoutFontScale,
  syncWorkoutSlopePosition,
  observeWorkoutHudSize,
  updateRouteProgressHud,
  updateSessionAverages,
  configureWorkoutHudForMode,
} from "./ui/workoutHud.js";

const MAX_SLOPE_CHANGE_PER_SEC = 0.5;
const WHEEL_INACTIVITY_TIMEOUT_MS = 10000;
let activeRemoteRoomClient = null;
let countdownTimer = null;
let countdownFinishTimer = null;
let movementWaitTimer = null;
let sessionSafetyAcknowledged = false;
let summaryRouteMap = null;
let summaryRouteRenderId = 0;
let kilojuliosAcumulados = 0;

// --- WORKOUT HUD & LAYOUT (movido a ui/workoutHud.js) ---

window.addEventListener("resize", () => {
  if (state.workoutLayout === "auto") applyWorkoutLayout();
  else positionMapNavigationControls();
});


// Global Navigation function (injected)
let navigateTo;

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
    connections: () => syncBluetoothScreenStatus(),
    routes: () => renderRouteLibrary(),
  };

  navigateTo = initNavigation(UI, state, navigationCallbacks);
  initRoutesView({ navigateTo });
  initHistoryView({ navigateTo, renderSummaryMetrics, renderSummaryRoute, setSessionSaveStatus });
  initUserView({ navigateTo });

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
    triggerBleConnection,
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
  initPrivacyConsent();

  function initializeRemoteController() {
    document.documentElement.classList.add("remote-route");
    document.body.classList.add("remote-route");
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.classList.remove("active");
    });
    document.getElementById("screen-remote")?.classList.add("active");

    const roomId = getRemoteRoomId();
    const status = document.getElementById("remote-status");
    const label = document.getElementById("remote-room-label");
    const reconnectButton = document.getElementById("btn-remote-reconnect");
    const client = roomId ? new RemoteRoomClient(roomId, "remote") : null;
    let isConnecting = false;
    let wasHidden = false;
    let connectionState = "initialized";
    let sessionFinished = false;
    let remoteWakeLock = null;
    const setRemoteStatus = (text, state = "") => {
      if (status) {
        status.textContent = text;
        if (state) connectionState = state;
        status.dataset.connectionState = connectionState;
      }
      if (reconnectButton) {
        reconnectButton.disabled = isConnecting || !client;
        reconnectButton.hidden = sessionFinished ||
          connectionState === "connected" ||
          connectionState === "connecting" ||
          connectionState === "initialized";
        reconnectButton.textContent = isConnecting ? "…" : "↻";
      }
    };
    const requestRemoteWakeLock = async () => {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      try {
        remoteWakeLock = await navigator.wakeLock.request("screen");
        remoteWakeLock.addEventListener("release", () => {
          remoteWakeLock = null;
        }, { once: true });
      } catch (error) {
        console.warn("[Mando móvil] No se pudo mantener la pantalla activa:", error);
      }
    };
    void requestRemoteWakeLock();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (document.visibilityState === "visible") {
        void requestRemoteWakeLock();
        if (wasHidden && client) {
          wasHidden = false;
          void connectRemote(true);
        }
      }
    });
    const requestRemoteFullscreen = () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        void document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    requestRemoteFullscreen();
    document.addEventListener("click", requestRemoteFullscreen, { once: true });

    if (label) label.textContent = roomId ? `Sala: ${roomId}` : "Falta el identificador de sala";
    setRemoteStatus(client ? "Mando preparado" : "Enlace de sala no válido");

    const emitGearCommand = async (eventName) => {
      if (!client) return;
      try {
        await client.emit(eventName, {});
        setRemoteStatus("Orden enviada a Ably");
      } catch (error) {
        console.error(`[Mando móvil] No se pudo enviar ${eventName}:`, error);
        setRemoteStatus(`No enviada: ${error.message}`, "disconnected");
      }
    };
    const emitGearChange = async (direction) => {
      if (!client) return;
      try {
        await client.emit("CHANGE_GEAR", { direction });
        setRemoteStatus(`Orden enviada a Ably: ${direction === "up" ? "subir" : "bajar"}`);
      } catch (error) {
        console.error("[Mando móvil] No se pudo enviar el cambio de marcha:", error);
        setRemoteStatus(`No enviada: ${error.message}`, "disconnected");
      }
    };

    const showRemoteSummary = (summary) => {
      const controls = document.getElementById("remote-controls");
      const panel = document.getElementById("remote-summary");
      if (!controls || !panel) return;
      controls.hidden = true;
      panel.hidden = false;
      sessionFinished = true;
      document.querySelector(".remote-controller")?.classList.add("remote-session-finished");
      const values = {
        "remote-summary-duration": summary.duration || "--",
        "remote-summary-distance": `${Number(summary.distance || 0).toFixed(2)} km`,
        "remote-summary-speed": `${Number(summary.avgSpeed || 0).toFixed(1)} km/h`,
        "remote-summary-max-speed": `${Number(summary.maxSpeed || 0).toFixed(1)} km/h`,
        "remote-summary-power": `${Math.round(Number(summary.avgPower || 0))} W`,
        "remote-summary-max-power": `${Math.round(Number(summary.maxPower || 0))} W`,
        "remote-summary-hr": `${Math.round(Number(summary.avgHr || 0))} bpm`,
        "remote-summary-max-hr": `${Math.round(Number(summary.maxHr || 0))} bpm`,
        "remote-summary-ascent": `${Math.round(Number(summary.ascent || 0))} m`,
        "remote-summary-calories": `${Math.round(Number(summary.calories || 0))} kcal`,
        "remote-summary-training-load": `${Math.round(Number(summary.np || 0))} W / ${Math.round(Number(summary.tss || 0))}`,
      };
      Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      });
      setRemoteStatus("Sesión finalizada");
    };

    const showRemoteAccessDenied = (payload) => {
      if (payload?.targetSenderId &&
          payload.targetSenderId !== client?.getConnectionId()) {
        return;
      }
      document.getElementById("remote-controls")?.setAttribute("hidden", "");
      setRemoteStatus("Mando no autorizado: ya hay otro conectado", "failed");
    };

    const connectRemote = async (forceReconnect = false) => {
      if (!client || isConnecting) return;
      isConnecting = true;
      setRemoteStatus(forceReconnect ? "Reconectando con la sala..." : "Conectando con la sala...");
      try {
        if (forceReconnect) await client.reconnect();
        else await client.connect();
        setRemoteStatus("Conectado a la sala", "connected");
      } catch (error) {
        console.error("[Mando móvil] No se pudo conectar con Ably:", error);
        setRemoteStatus(
          error?.message?.includes("Falta configurar")
            ? "Ably no está configurado"
            : `Sin conexión: ${error?.message || "error de conexión"}`,
          "failed",
        );
      } finally {
        isConnecting = false;
        if (reconnectButton) reconnectButton.disabled = !client;
      }
    };

    client?.onConnectionStateChange((change) => {
      const stateMessages = {
        connecting: "Conectando con Ably...",
        connected: "Conectado a la sala",
        disconnected: "Conexión perdida. Reconectando...",
        suspended: "Conexión suspendida. Pulsa Reconectar.",
        closing: "Cerrando conexión...",
        closed: "Desconectado. Pulsa Reconectar.",
        failed: `Error de conexión: ${change.reason?.message || "Ably no disponible"}`,
      };
      connectionState = change.current;
      setRemoteStatus(
        stateMessages[change.current] || `Estado de conexión: ${change.current}`,
        "",
      );
    });
    document.getElementById("btn-remote-gear-up")?.addEventListener("click", () => emitGearChange("up"));
    document.getElementById("btn-remote-gear-down")?.addEventListener("click", () => emitGearChange("down"));
    document.getElementById("btn-remote-pause")?.addEventListener("click", () => emitGearCommand("TOGGLE_PAUSE"));
    document.getElementById("btn-remote-stop")?.addEventListener("click", async () => {
      if (await showConfirm("¿Finalizar la sesión?", "Finalizar", "danger")) void emitGearCommand("STOP_SESSION");
    });
    reconnectButton?.addEventListener("click", () => void connectRemote(true));

    if (client) {
      client.on("SESSION_SUMMARY", showRemoteSummary);
      client.on("REMOTE_ACCESS_DENIED", showRemoteAccessDenied);
      void connectRemote();
    }
  }

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
      void releaseWorkoutWakeLock();
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
    onStatusChanged,
  });
  initSensorReconnectControls();
});

function cacheUiElements() {
  // Screens
  [
    "user-select",
    "dashboard",
    "connections",
    "workout",
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

    // Recuperar valor guardado y actualizar estado
    const savedRealism = localStorage.getItem("rodilloint_realism");
    if (savedRealism) {
      state.realismFactor = parseFloat(savedRealism);
    }

    // Inicializar slider de realismo al abrir el modal de ruta
    const realismSlider = document.getElementById("realism-slider");
    const realismValue = document.getElementById("realism-value");
    if (realismSlider && realismValue) {
      realismSlider.value = Math.round((state.realismFactor || 1.0) * 100);
      realismValue.textContent = `${realismSlider.value}%`;

      realismSlider.oninput = (e) => {
        const val = e.target.value;
        realismValue.textContent = `${val}%`;
        state.realismFactor = parseFloat(val) / 100;

        // Guardar persistente
        localStorage.setItem("rodilloint_realism", state.realismFactor);
        saveStateToLocalStorage();

        // Sincronizar también el slider de sesión en vivo por si está visible
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

// --- ROUTE LIBRARY MOVED TO ui/routesView.js ---


// --- ROUTE OVERVIEW SVG (movido a ui/routeOverviewSvg.js) ---

// --- WORKOUT HUD METRICS & FONT SCALE (movido a ui/workoutHud.js) ---

// --- Funciones UI movidas a modules/ui.js ---

// --- USER PROFILE LOGIC (movido a ui/userView.js) ---

// --- WORKOUT LAUNCH MODAL/FLOW ---
function startModeFlow(mode) {
  state.currentMode = mode;

  // Check sensor setup
  const hasControllable = BleManager.connections.TRAINER.status === "CONECTADO";
  const hasPower = BleManager.connections.POWER.status === "CONECTADO";
  const hasSpeed = BleManager.connections.CSC.status === "CONECTADO";
  const isVirtual = BleManager.simulator.isActive;

  if (mode === "ROUTE" || mode === "MANUAL") {
    // Requires a controllable trainer, speed or power sensors to calculate virtual metrics
    if (!hasControllable && !hasPower && !hasSpeed && !isVirtual) {
      showToast("Se necesita conectar al menos un sensor (Rodillo inteligente, potenciómetro, sensor de velocidad) o activar el Rodillo Virtual para iniciar entrenamientos interactivos.", "warning");
      navigateTo("connections");
      return;
    }
  }

  navigateTo("workout");
}

// --- BLUETOOTH CONNECTION CENTER ---
function syncBluetoothScreenStatus() {
  const hasBluetooth = !!navigator.bluetooth;
  setElDisplay("bluetooth-support-warning", hasBluetooth ? "none" : "block");

  for (const type in BleManager.connections) {
    const conn = BleManager.connections[type];
    const card = document.getElementById(`sensor-${type}`);
    const label = document.getElementById(`status-label-${type}`);
    const btn = document.getElementById(`btn-connect-${type}`);

    // Ocultar o deshabilitar el sensor TRAINER si estamos en modo TRADITIONAL
    if (state.currentMode === "TRADITIONAL" && type === "TRAINER") {
      if (card) card.style.display = "none"; // Ocultar toda la tarjeta del rodillo
      // Alternativamente, podrías solo deshabilitarlo:
      // if (btn) { btn.disabled = true; btn.textContent = 'No Aplica'; btn.style.opacity = '0.5'; }
      // if (label) label.textContent = 'No Aplica';
      return; // Salir del bucle para este tipo de sensor
    }

    if (!hasBluetooth && btn) {
      btn.disabled = true;
      btn.textContent = "No Soportado";
    }

    if (conn.status === "CONECTADO") {
      card.className = "glass-card sensor-card connected";
      label.textContent = `Conectado: ${conn.name}`;
      btn.textContent = "Desconectar";
      btn.className = "btn btn-danger btn-sm";
    } else if (conn.status === "BUSCANDO" || conn.status === "CONECTANDO") {
      card.className = "glass-card sensor-card disconnected";
      label.textContent = "Conectando...";
      btn.textContent = "Buscando";
      btn.disabled = true;
    } else {
      card.className = "glass-card sensor-card disconnected";
      label.textContent = "Desconectado";
      btn.textContent = "Conectar";
      btn.className = "btn btn-dark btn-sm";
      btn.disabled = false;
    }
  }

  // Update virtual button active style
  if (BleManager.simulator.isActive) {
    document.getElementById("btn-toggle-sim").textContent =
      "Desactivar Rodillo Virtual";
    document.getElementById("btn-toggle-sim").className = "btn btn-danger";
  } else {
    document.getElementById("btn-toggle-sim").textContent =
      "Activar Rodillo Virtual";
    document.getElementById("btn-toggle-sim").className = "btn btn-secondary";
  }

  // Show hints for last connected devices
  const lastTrainer = localStorage.getItem("rodilloint_lastTrainerName");
  const lastHrm = localStorage.getItem("rodilloint_lastHrmName");
  const trainerLabel = document.getElementById("status-label-TRAINER");
  const hrmLabel = document.getElementById("status-label-HRM");
  if (
    lastTrainer &&
    BleManager.connections.TRAINER.status === "DESCONECTADO" &&
    trainerLabel
  ) {
    trainerLabel.textContent = `Último: ${lastTrainer} (pulsa Conectar)`;
  }
  if (
    lastHrm &&
    BleManager.connections.HRM.status === "DESCONECTADO" &&
    hrmLabel
  ) {
    hrmLabel.textContent = `Último: ${lastHrm} (pulsa Conectar)`;
  }
}

async function triggerBleConnection(type) {
  const conn = BleManager.connections[type];
  if (conn.status === "CONECTADO") {
    BleManager.disconnectDevice(type);
    // Clear saved name if user manually disconnects
    if (type === "TRAINER")
      localStorage.removeItem("rodilloint_lastTrainerName");
    if (type === "HRM") localStorage.removeItem("rodilloint_lastHrmName");
    syncBluetoothScreenStatus();
  } else {
    try {
      showRadarOverlay(type);
      const name = await BleManager.connectDevice(type);
      hideRadarOverlay();
      // Save name of last successfully connected device
      if (type === "TRAINER" && name)
        localStorage.setItem("rodilloint_lastTrainerName", name);
      if (type === "HRM" && name)
        localStorage.setItem("rodilloint_lastHrmName", name);
      syncBluetoothScreenStatus();
    } catch (e) {
      console.error(e);
      hideRadarOverlay();
      syncBluetoothScreenStatus();
    }
  }
}

function showRadarOverlay(type) {
  const labelMap = {
    TRAINER: "Rodillo Inteligente FTMS",
    HRM: "Pulsómetro BPM",
    POWER: "Sensor de Potencia (Watts)",
    CSC: "Sensor de Velocidad/Cadencia",
  };
  document.getElementById("radar-scan-title").textContent =
    `Buscando ${labelMap[type]}...`;
  UI.modals.scanOverlay.className = "radar-overlay active";
}
function hideRadarOverlay() {
  UI.modals.scanOverlay.className = "radar-overlay";
}

function onStatusChanged(type, status) {
  syncBluetoothScreenStatus();

  // Sincronizar workout status icons (mapeando tipos BLE a IDs de interfaz en workout)
  let targetIds = [`indicator-${type}`];
  if (type === "POWER") targetIds.push("indicator-PWR");
  if (type === "HRM") targetIds.push("indicator-HR");
  if (type === "CSC") {
    targetIds.push("indicator-CAD");
    targetIds.push("indicator-SPD");
  }
  if (type === "TRAINER") {
    targetIds.push("indicator-SPD");
  }

  targetIds.forEach((id) => {
    const icon = document.getElementById(id);
    if (icon) {
      const label =
        id === "indicator-PWR"
          ? "Potencia"
          : id === "indicator-HR"
            ? "Pulso"
            : id === "indicator-CAD"
              ? "Cadencia"
              : id === "indicator-SPD"
                ? "Velocidad"
                : type;
      const isConnected = BleManager.simulator.isActive || status === "CONECTADO";
      const canReconnect = !isConnected && status === "DESCONECTADO";
      icon.title = `${label}: ${
        isConnected
          ? "conectado"
          : status === "CONECTANDO" || status === "BUSCANDO"
            ? "conectando"
            : "desconectado"
      }${canReconnect ? ". Pulsa para conectar" : ""}`;
      icon.setAttribute("aria-label", icon.title);
      icon.setAttribute("aria-disabled", String(!canReconnect));
      icon.tabIndex = canReconnect ? 0 : -1;
      icon.classList.toggle("reconnect-available", canReconnect);

      // Si el simulador está activo, forzamos el estado activo (verde)
      if (BleManager.simulator.isActive) {
        icon.className = "indicator-icon active";
      } else if (status === "CONECTADO") {
        icon.className = "indicator-icon active";
      } else if (status === "CONECTANDO" || status === "BUSCANDO") {
        icon.className = "indicator-icon connecting";
      } else if (status === "DESCONECTADO") {
        icon.className = "indicator-icon disconnected";
      } else {
        icon.className = "indicator-icon";
      }
    }
  });
}

function initSensorReconnectControls() {
  const sensorButtons = {
    "indicator-PWR": "POWER",
    "indicator-HR": "HRM",
    "indicator-CAD": "CSC",
    "indicator-SPD": "CSC",
  };

  Object.entries(sensorButtons).forEach(([id, type]) => {
    const icon = document.getElementById(id);
    if (!icon) return;
    const connect = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const trainerDisconnected =
        (id === "indicator-PWR" || id === "indicator-SPD") &&
        BleManager.connections.TRAINER.device &&
        BleManager.connections.TRAINER.status === "DESCONECTADO";
      const connectionType = trainerDisconnected ? "TRAINER" : type;
      if (BleManager.connections[connectionType]?.status !== "DESCONECTADO") return;
      void triggerBleConnection(connectionType);
    };
    icon.addEventListener("click", connect);
    icon.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      connect(event);
    });
    icon.setAttribute("aria-disabled", "true");
    icon.tabIndex = -1;
  });
}

// --- TELEMETRY RX & CALCULATIONS ---
function onPowerReceived(power) {
  state.currentPower = power;

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
  state.currentCadence = cad;
  setElText("metrics-cadence", cad);
  if (state.isSessionActive && cad > 5) resumeSessionOnMovement();
}

function onSpeedReceived(speedKph, hasWheelRevolution = speedKph > 0) {
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

  onStatusChanged("TRAINER", BleManager.connections.TRAINER.status);
  onStatusChanged("HRM", BleManager.connections.HRM.status);
  onStatusChanged("POWER", BleManager.connections.POWER.status);
  onStatusChanged("CSC", BleManager.connections.CSC.status);

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
      initRouteOverviewSvg();
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
      state.routeTotalAscent = calculateTotalRouteAscent();

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

// --- LEAFLET MAPS ENGINE (movido a ui/mapEngine.js) ---

function initializeRemoteRoomPanel() {
  const panel = document.getElementById("remote-room-panel");
  const qr = document.getElementById("remote-room-qr");
  const label = document.getElementById("remote-room-id");
  const status = document.getElementById("remote-room-status");
  if (!panel || !qr || !label || !status) return;

  activeRemoteRoomClient?.disconnect();
  const roomId = createRoomId();
  const remoteUrl = buildRemoteUrl(roomId);
  activeRemoteRoomClient = new RemoteRoomClient(roomId, "host");
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

  label.textContent = `Sala: ${roomId}`;
  qr.src = buildQrUrl(remoteUrl);
  qr.title = remoteUrl;
  panel.title = `Mando móvil: ${remoteUrl}`;
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

// --- SCREEN WAKE LOCK (evita que la pantalla se apague en sesiones activas) ---
let workoutWakeLock = null;

async function requestWorkoutWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    if (!workoutWakeLock) {
      workoutWakeLock = await navigator.wakeLock.request("screen");
      workoutWakeLock.addEventListener("release", () => {
        workoutWakeLock = null;
      });
      console.log("[WakeLock] Pantalla activa fijada para el entrenamiento");
    }
  } catch (err) {
    console.warn("[WakeLock] No se pudo activar WakeLock:", err);
  }
}

async function releaseWorkoutWakeLock() {
  if (workoutWakeLock) {
    try {
      await workoutWakeLock.release();
    } catch (e) {}
    workoutWakeLock = null;
    console.log("[WakeLock] Pantalla liberada");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.isSessionActive && !state.isPaused) {
    void requestWorkoutWakeLock();
  }
});

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

    if (state.currentMode === "ROUTE" && state.routePoints.length > 0) {
      setRouteTargetSlope(0);
      refreshUpcomingPreview(0);
    }

    // Inicializar gráficos manuales si estamos en modo manual
    if (state.currentMode === "MANUAL") {
      window.ChartsManager.initManualTrainingCharts("manual-power-chart", "manual-hr-chart");
    }

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
  if (state.timerInterval) clearInterval(state.timerInterval);
  void requestWorkoutWakeLock();

  // Guardamos el tiempo de inicio real de la sesión (ajustado por pausas previas)
  // Nota: startTime debe ser relativo a Date.now() menos el tiempo transcurrido
  // pero el tiempo que ya ha pasado en pausas debe ser ignorado.
  // Para simplificar, ajustamos startTime en el momento de reanudar,
  // pero en la estructura actual `startTimerInterval` recalcula
  // `state.elapsedSeconds` basado en `Date.now() - startTime`.
  // Si queremos que no cuente el tiempo de pausa, necesitamos otra forma de gestionar el tiempo acumulado.
  const startTime = Date.now() - (state.elapsedSeconds || 0) * 1000;

  // Guardamos el tiempo en que la sesión fue pausada por última vez
  state.lastPauseTime = null;
  state.totalPausedDuration = 0;

  state.timerInterval = setInterval(() => {
    if (state.isSessionActive && !state.isPaused) {
      const now = Date.now();
      state.elapsedSeconds = Math.floor((now - startTime - (state.totalPausedDuration || 0)) / 1000);

      // Acumulación de Kilojulios (kJ) segundo a segundo
      const currentWatts = Number(state.currentPower) || 0;
      kilojuliosAcumulados += calculateKilojoulesStep(currentWatts, 1);
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
        setRouteTargetSlope(state.totalDistance);
        syncSlopeDisplayLabels();
        // Actualizar posición en el mini-mapa de vista general
        updateRouteOverviewPosition(state.currentRouteIndex);
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
    }
  }, 1000); // 1 segundo exacto
}

function pauseTimer() {
  state.isPaused = true;
  state.lastPauseTime = Date.now(); // Marcamos cuándo empezamos a pausar
  state.lastSlopeRampTime = Date.now();
  state.lastTelemetryTimestamp = Date.now();
  state.lastTelemetrySpeed = state.currentSpeed || 0;

  updatePauseButton("▶ Reanudar", "resume");
  if (state.isAutoPaused) {
    setElDisplay("workout-autopause-label", "block");
  }
}

function resumeTimer() {
  state.isPaused = false;
  void requestWorkoutWakeLock();

  // Sumamos el tiempo transcurrido durante la pausa al total de tiempo pausado
  if (state.lastPauseTime) {
    state.totalPausedDuration += (Date.now() - state.lastPauseTime);
    state.lastPauseTime = null;
  }

  state.lastSpeedUpdateTime = Date.now();
  state.lastMovementTime = Date.now();
  state.lastSlopeRampTime = Date.now();
  state.lastTelemetryTimestamp = Date.now();
  state.lastTelemetrySpeed = state.currentSpeed || 0;

  updatePauseButton("⏸ Pausa");
  setElDisplay("workout-autopause-label", "none");
}

async function saveTelemetryPoint() {
  if (!state.currentSessionId) return;

  // Extract coordinate lat/lon and elevation if active route
  let lat = null,
    lon = null,
    ele = 0.0;
  if (state.currentMode === "ROUTE" && state.routePoints.length > 0) {
    const pt = state.routePoints[state.currentRouteIndex];
    lat = pt.lat;
    lon = pt.lon;
    if (
      state.routeElevations &&
      state.routeElevations.length > state.currentRouteIndex
    ) {
      ele = state.routeElevations[state.currentRouteIndex];
    }
  } else {
    ele = state.totalAscent;
  }

  // Centralized distance accumulation based on last telemetry timestamp
  const nowTs = Date.now();
  if (!state.lastTelemetryTimestamp) state.lastTelemetryTimestamp = nowTs;
  const dt = (nowTs - state.lastTelemetryTimestamp) / 1000.0; // seconds
  let increment = 0.0;
  if (!state.isPaused && dt > 0 && dt < 10) {
    // Use trapezoidal integration between lastTelemetrySpeed and currentSpeed for better accuracy
    const lastSp = state.lastTelemetrySpeed !== undefined ? state.lastTelemetrySpeed : state.currentSpeed || 0;
    const currSp = state.currentSpeed || 0;
    increment = ((lastSp + currSp) / 2.0 / 3600.0) * dt; // km
    if (currSp > 0 || lastSp > 0) {
      state.totalDistance += increment;
    }
    state.lastTelemetrySpeed = currSp;
  }
  state.lastTelemetryTimestamp = nowTs;

  const point = {
    sessionId: state.currentSessionId,
    timestamp: nowTs,
    speed: state.currentSpeed,
    power: state.currentPower,
    cadence: state.currentCadence,
    heartRate: state.currentHr,
    slope: state.currentSlope,
    virtualGear: state.virtualGear,
    gearRatio: getVirtualGearRatio(state.virtualGear),
    elevation: ele,
    latitude: lat,
    longitude: lon,
    distance: state.totalDistance,
  };

  state.telemetryBuffer.push(point);

  // Backup buffer to localStorage in case of page refresh/crash (asynchronously to avoid blocking UI)
  const bufferCopy = [...state.telemetryBuffer];
  setTimeout(() => {
    try {
      localStorage.setItem(
        "rodilloint_telemetry_backup",
        JSON.stringify(bufferCopy),
      );
    } catch (err) {
      // ignore
    }
  }, 0);

  // Flush buffer every 10 items (approx 10 seconds)
  if (state.telemetryBuffer.length >= 10) {
    await flushTelemetryBuffer();
  }
}

async function flushTelemetryBuffer() {
  if (!state.telemetryBuffer || state.telemetryBuffer.length === 0) return;

  const pointsToSave = [...state.telemetryBuffer];
  state.telemetryBuffer = [];

  try {
    await DbManager.insertSensorDataBulk(pointsToSave);
    localStorage.removeItem("rodilloint_telemetry_backup");
  } catch (e) {
    console.error(
      "Failed to flush telemetry buffer to database, retrying next time",
      e,
    );
    // Put them back in the buffer to retry
    state.telemetryBuffer = [...pointsToSave, ...state.telemetryBuffer];
  }
}

async function recoverTelemetryBackup() {
  try {
    const backupStr = localStorage.getItem("rodilloint_telemetry_backup");
    if (backupStr) {
      const backup = JSON.parse(backupStr);
      if (Array.isArray(backup) && backup.length > 0) {
        console.log(
          `[Backup Recovery] Se encontraron ${backup.length} puntos de telemetría sin guardar en IndexedDB. Recuperando...`,
        );
        await DbManager.insertSensorDataBulk(backup);
        localStorage.removeItem("rodilloint_telemetry_backup");
        console.log("[Backup Recovery] Telemetría recuperada con éxito.");
      }
    }
  } catch (e) {
    console.warn(
      "[Backup Recovery] No se pudo recuperar el backup de telemetría:",
      e,
    );
  }
}

function renderSummaryMetrics(metrics) {
  document.getElementById("summary-duration").textContent = metrics.duration;
  document.getElementById("summary-total-duration").textContent =
    metrics.totalDuration;
  document.getElementById("summary-distance").textContent =
    `${metrics.distance.toFixed(2)} km`;
  document.getElementById("summary-np").textContent = `${metrics.np} W`;
  document.getElementById("summary-tss").textContent = metrics.tss;
  document.getElementById("summary-if").textContent =
    metrics.intensityFactor.toFixed(2);
  document.getElementById("summary-calories").textContent =
    `${metrics.calories} kcal`;
  const summaryKjEl = document.getElementById("summary-kilojoules");
  if (summaryKjEl) {
    const kjVal = Number.isFinite(Number(metrics.kilojoules))
      ? Math.round(Number(metrics.kilojoules))
      : (metrics.calories ? Math.round(metrics.calories * 1.05) : 0);
    summaryKjEl.textContent = `${kjVal} kJ`;
  }
  document.getElementById("summary-power-stats").textContent =
    `${metrics.avgPower} / ${metrics.maxPower} W`;
  document.getElementById("summary-speed-stats").textContent =
    `${metrics.avgSpeed.toFixed(1)} / ${metrics.maxSpeed.toFixed(1)} km/h`;
  document.getElementById("summary-hr-stats").textContent =
    `${metrics.avgHr} / ${metrics.maxHr} bpm`;

  ChartsManager.initZonesChart(
    "summary-zones-chart",
    metrics.timeInPowerZones,
  );
}

function renderSummaryRoute(session, distanceKm = 0) {
  const renderId = ++summaryRouteRenderId;
  const grid = document.getElementById("summary-route-grid");
  const elevationCard = document.getElementById("summary-elevation-card");
  const mapCard = document.getElementById("summary-map-card");
  const mapContainer = document.getElementById("summary-route-map");
  const points = Array.isArray(session?.routePoints)
    ? session.routePoints.map((point) => ({
        lat: Number(point?.lat),
        lon: Number(point?.lon),
      }))
    : [];
  const routePoints = points.filter(
    (point) =>
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lon) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      point.lon >= -180 &&
      point.lon <= 180,
  );
  const hasRoute = routePoints.length >= 2;
  const distances = Array.isArray(session?.routeDistances)
    ? session.routeDistances.map(Number)
    : [];
  const elevations = Array.isArray(session?.routeElevations)
    ? session.routeElevations.map(Number)
    : [];
  const hasProfile =
    hasRoute &&
    routePoints.length === points.length &&
    distances.length === routePoints.length &&
    elevations.length === routePoints.length &&
    distances.every(Number.isFinite) &&
    elevations.every(Number.isFinite) &&
    distances.every((distance, index) => index === 0 || distance >= distances[index - 1]) &&
    elevations.some((elevation) => elevation !== 0);

  if (!grid || !elevationCard || !mapCard || !mapContainer) return;
  elevationCard.hidden = !hasProfile;
  mapCard.hidden = !hasRoute;
  grid.hidden = !hasRoute && !hasProfile;

  if (summaryRouteMap) {
    summaryRouteMap.remove();
    summaryRouteMap = null;
  }
  mapContainer.replaceChildren();
  if (!hasRoute) return;

  requestAnimationFrame(() => {
    if (
      renderId !== summaryRouteRenderId ||
      !document.getElementById("screen-summary")?.classList.contains("active")
    ) {
      return;
    }

    if (hasProfile) {
      ChartsManager.initElevationChart(
        "summary-elevation-chart",
        distances,
        elevations,
      );
    }

    if (typeof L === "undefined") {
      console.error("Leaflet no está disponible para mostrar el mapa del resumen.");
      mapContainer.textContent = "No se pudo cargar el mapa en este navegador.";
      return;
    }

    try {
      const latLngs = routePoints.map((point) => [point.lat, point.lon]);
      summaryRouteMap = L.map(mapContainer, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(summaryRouteMap);

      L.polyline(latLngs, {
        color: "#3b82f6",
        opacity: 0.85,
        weight: 5,
      }).addTo(summaryRouteMap);

      const startPoint = latLngs[0];
      const endPoint = latLngs[latLngs.length - 1];
      L.circleMarker(startPoint, {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#10b981",
        fillOpacity: 1,
      }).bindTooltip("Inicio").addTo(summaryRouteMap);
      L.circleMarker(endPoint, {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 1,
      }).bindTooltip("Fin de la ruta").addTo(summaryRouteMap);

      const routeDistance = Number(distanceKm);
      if (
        distances.length === routePoints.length &&
        distances.every(Number.isFinite) &&
        Number.isFinite(routeDistance)
      ) {
        const nextIndex = distances.findIndex(
          (distance) => distance >= routeDistance,
        );
        const currentIndex = Math.max(
          0,
          Math.min(
            nextIndex < 0 ? distances.length - 1 : nextIndex,
            routePoints.length - 1,
          ),
        );
        if (currentIndex > 0) {
          L.polyline(latLngs.slice(0, currentIndex + 1), {
            color: "#10b981",
            opacity: 0.95,
            weight: 6,
          }).addTo(summaryRouteMap);
        }
        L.circleMarker(latLngs[currentIndex], {
          radius: 8,
          color: "#ffffff",
          weight: 3,
          fillColor: "#f59e0b",
          fillOpacity: 1,
        }).bindTooltip("Progreso estimado").addTo(summaryRouteMap);
      }

      summaryRouteMap.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24] });
      requestAnimationFrame(() => summaryRouteMap?.invalidateSize());
    } catch (error) {
      console.error("No se pudo mostrar el mapa del resumen:", error);
      mapContainer.textContent = "No se pudo mostrar el mapa de esta ruta.";
    }
  });
}

function setSessionSaveStatus(message, color = "var(--text-secondary)") {
  const status = document.getElementById("session-save-status");
  if (status) {
    status.textContent = message;
    status.style.color = color;
  }
}

async function stopSessionFlow() {
  cancelCountdown();
  if (!state.isSessionActive) {
    disconnectRemoteRoom();
    navigateTo("dashboard");
    return;
  }

  const confirmStop = await showConfirm(
    "¿Quieres finalizar y guardar el entrenamiento actual?",
  );
  if (!confirmStop) return;

  BleManager.stopAutoReconnect();
  void releaseWorkoutWakeLock();
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.isSessionActive = false;
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
  const intensityFactor = calculateIntensityFactor(np, ftp);
  const tss = calculateTSS(state.elapsedSeconds, np, intensityFactor, ftp);

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
    });

    if (activeRemoteRoomClient) {
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
    }
    disconnectRemoteRoom();

    // Initial zones chart rendering
    ChartsManager.initZonesChart("summary-zones-chart", state.timeInPowerZones);

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
    // Show summary screen
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
        const posicionCiclistaActual = normalizeLngLat({
            lon: point.lon,
            lat: point.lat,
        });
        if (!posicionCiclistaActual) return;
        const puntoSiguienteData = state.routePoints[
            Math.min(state.currentRouteIndex + 5, state.routePoints.length - 1)
        ] || point;
        const posicionCiclistaSiguiente = normalizeLngLat({
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
            updateFpvCamera(
                posicionCiclistaActual,
                posicionCiclistaSiguiente,
                state.isMapFollowingRoute,
            );
            if (!isFpvCameraLoopRunning()) startFpvCameraLoop();
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
            isValidLngLat(options.center) &&
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

function coerceSlope(slope) {
  const minSlope = Number.isFinite(state.virtualSlopeMin)
    ? state.virtualSlopeMin
    : -15.0;
  const maxSlope = Number.isFinite(state.virtualSlopeMax)
    ? state.virtualSlopeMax
    : 20.0;
  const safeMin = Math.min(minSlope, maxSlope);
  const safeMax = Math.max(minSlope, maxSlope);
  return Math.max(safeMin, Math.min(safeMax, slope));
}

function setRouteTargetSlope(currentDistKm) {
  const preview = getUpcomingSegmentData(SLOPE_AVERAGE_METERS, currentDistKm);
  if (preview) {
    state.targetSlope = coerceSlope(
      calculateVirtualResistanceSlope(
        preview.avgSlope,
        state.virtualGearsEnabled ? state.virtualGear : DEFAULT_VIRTUAL_GEAR,
      ),
    );
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
    setRouteTargetSlope(state.totalDistance);
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
  const routeSlope = getRouteSlopeAtDistance(state.totalDistance);
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

function getRouteSlopeAtDistance(distanceKm) {
  if (
    state.currentMode !== "ROUTE" ||
    state.routeDistances.length < 2 ||
    state.routeElevations.length !== state.routeDistances.length
  ) {
    return 0;
  }

  const routeStartKm = state.routeDistances[0];
  const routeEndKm = state.routeDistances[state.routeDistances.length - 1];
  const distance = Math.max(routeStartKm, Math.min(routeEndKm, Number(distanceKm) || 0));
  const sampleRadiusKm = 0.010; //Pendiente real 10m antes y 10m despues
  const startKm = Math.max(routeStartKm, distance - sampleRadiusKm);
  const endKm = Math.min(routeEndKm, distance + sampleRadiusKm);
  const distanceMeters = (endKm - startKm) * 1000;
  if (distanceMeters <= 0) return 0;

  const startElevation = getElevationAtDistance(startKm);
  const endElevation = getElevationAtDistance(endKm);
  const slope = ((endElevation - startElevation) / distanceMeters) * 100;
  return Number.isFinite(slope) ? slope : 0;
}

function updateTrainerSlope(slope, immediate = false) {
  const coerced = coerceSlope(slope);

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

// --- PREDICTIVE UPCOMING SLOPE AND RELIEF (movido a ui/routeOverviewSvg.js) ---

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
        if (!isValidLngLat(ghostCoordinates)) return;

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

// --- 3D MAP & FPV ENGINE (movido a ui/mapEngine.js) ---


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

// --- HISTORY AND STATISTICS SCREENS MOVED TO ui/historyView.js ---

// --- TRAINING CALENDAR AND STATS MOVED TO ui/calendarView.js ---

// --- FPV ZOOM CONTROLS (movido a ui/mapEngine.js) ---



