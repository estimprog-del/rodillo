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
} from "./modules/state.js";
import { initNavigation } from "./ui/navigation.js";
import { loadDashboardHeader } from "./ui/dashboard.js";
import { updateClock, updatePauseButton } from "./ui/uiHelpers.js";
import { bindEvents } from "./modules/events.js";

const SLOPE_AVERAGE_METERS = 20;
const SLOPE_PREVIEW_LONG_METERS = 500;
const MAX_SLOPE_CHANGE_PER_SEC = 0.5;

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
  };

  navigateTo = initNavigation(UI, state, navigationCallbacks);

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
    navigateTo, // <- This now uses the initialized version
    triggerBleConnection,
    togglePause,
    stopSessionFlow,
    handleGpxUpload,
    adjustManualSlope,
    setWorkoutFontScale,
    startSession,
  });

  // Init Database
  try {
    await DbManager.initDb();
    // Recuperar copia de seguridad de telemetría de una desconexión anterior si existe
    await recoverTelemetryBackup();
    await loadProfilesGrid();

    // Check if there is an active user from last session in localStorage
    const savedUserId = localStorage.getItem("rodilloint_userId");
    if (savedUserId) {
      const user = await DbManager.getUserById(savedUserId);
      if (user) {
        selectUser(user);
      }
    }
  } catch (e) {
    console.error("Failed to init IndexedDB", e);
  }

  // Setup Web Bluetooth Data Receivers
  BleManager.setBleListener({
    onPowerReceived,
    onHeartRateReceived,
    onCadenceReceived,
    onSpeedReceived,
    onStatusChanged,
  });
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
  if (UI.routeModal) UI.routeModal.classList.add("active");
}

function hideRouteModal() {
  if (UI.routeModal) UI.routeModal.classList.remove("active");
}

function calculateTotalRouteAscent() {
  if (state.routeElevations.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < state.routeElevations.length; i++) {
    const diff = state.routeElevations[i] - state.routeElevations[i - 1];
    if (diff > 0) total += diff;
  }
  return total;
}

function updateRouteProgressHud() {
  if (state.routeDistances.length === 0) return;

  const totalKm = state.routeDistances[state.routeDistances.length - 1];
  const remainingKm = Math.max(0, totalKm - state.totalDistance);
  setElText("submetrics-remaining", `${remainingKm.toFixed(1)} km`);

  if (!state.routeTotalAscent) {
    state.routeTotalAscent = calculateTotalRouteAscent();
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
    state.speedHistory.length > 0
      ? (
          state.speedHistory.reduce((a, b) => a + b, 0) /
          state.speedHistory.length
        ).toFixed(1)
      : "0.0";
  setElText("metrics-speed-avg", `${avgSpeed} Ø`);
}

function configureWorkoutHudForMode() {
  const isRoute = state.currentMode === "ROUTE";
  const isManual = state.currentMode === "MANUAL";

  setElDisplay("hud-progress", isRoute ? "block" : "none");
  setElDisplay("hud-profile", isRoute ? "flex" : "none");
  setElDisplay("manual-mode-panel", isManual ? "block" : "none");

  const ghostBanner = document.getElementById("ghost-banner");
  if (ghostBanner && !isRoute) {
    ghostBanner.classList.remove("visible");
  }
}

// --- Eventos movidos a modules/events.js ---
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
}

// --- Funciones UI movidas a modules/ui.js ---

// --- USER PROFILE LOGIC ---
async function loadProfilesGrid() {
  const users = await DbManager.getAllUsers();
  const container = document.getElementById("users-grid-container");
  container.innerHTML = "";

  if (users.length === 0) {
    container.innerHTML = `
      <div class="glass-card user-card" style="grid-column: span 100%; cursor: default; padding: 30px;">
        <p style="color: var(--text-secondary); margin-bottom: 8px;">No hay perfiles de usuario creados.</p>
        <span style="font-size: 13px;">Crea tu primer perfil deportista para comenzar.</span>
      </div>
    `;
    return;
  }

  users.forEach((u) => {
    const card = document.createElement("div");
    card.className = "glass-card user-card";
    card.onclick = () => selectUser(u);

    // Initials for avatar
    const initials = u.name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    card.innerHTML = `
      <button class="user-card-delete" title="Eliminar Perfil">&times;</button>
      <div class="user-avatar">${initials}</div>
      <div class="user-name">${u.name}</div>
      <div class="user-meta">${u.weight} kg • FTP ${u.ftp}W</div>
    `;

    const deleteBtn = card.querySelector(".user-card-delete");
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteProfileFromSelectScreen(u.id, u.name);
    };

    container.appendChild(card);
  });
}

async function deleteProfileFromSelectScreen(id, name) {
  const confirmDel = confirm(
    `¿Estás seguro de que quieres eliminar el perfil de ${name}? Esto borrará sus datos permanentemente.`,
  );
  if (confirmDel) {
    try {
      await DbManager.deleteUser(id);
      await loadProfilesGrid();
    } catch (e) {
      console.error("Error al eliminar perfil:", e);
    }
  }
}

function selectUser(user) {
  state.currentUser = user;
  localStorage.setItem("rodilloint_userId", user.id);
  navigateTo("dashboard");
}

function handleLogout() {
  state.currentUser = null;
  localStorage.removeItem("rodilloint_userId");
  loadProfilesGrid();
  navigateTo("user-select");
}

async function handleAddUserSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("new-user-name").value.trim();
  const weight = parseFloat(document.getElementById("new-user-weight").value);
  const ftp = parseInt(document.getElementById("new-user-ftp").value);
  const maxHeartRate = parseInt(
    document.getElementById("new-user-maxhr").value,
  );
  const age = parseInt(document.getElementById("new-user-age").value);
  const height = parseInt(document.getElementById("new-user-height").value);

  if (name.length > 0) {
    try {
      const newId = await DbManager.insertUser({
        name,
        weight,
        ftp,
        maxHeartRate,
        age,
        height,
      });
      const user = await DbManager.getUserById(newId);
      hideModal("add-user");
      UI.formAddUser.reset();
      selectUser(user);
    } catch (e) {
      console.error(e);
      alert("Error al crear perfil.");
    }
  }
}

async function handleEditUserSubmit(e) {
  e.preventDefault();
  if (!state.currentUser) return;

  const name = document.getElementById("edit-user-name").value.trim();
  const weight = parseFloat(document.getElementById("edit-user-weight").value);
  const ftp = parseInt(document.getElementById("edit-user-ftp").value);
  const maxHeartRate = parseInt(
    document.getElementById("edit-user-maxhr").value,
  );
  const age = parseInt(document.getElementById("edit-user-age").value);
  const height = parseInt(document.getElementById("edit-user-height").value);

  const updatedUser = {
    ...state.currentUser,
    name,
    weight,
    ftp,
    maxHeartRate,
    age,
    height,
  };

  try {
    await DbManager.updateUser(updatedUser);
    state.currentUser = updatedUser;
    hideModal("edit-user");
    loadDashboardHeader();
  } catch (e) {
    console.error(e);
    alert("Error al guardar ajustes.");
  }
}

async function handleImportUserSubmit() {
  const jsonStr = document.getElementById("import-json-data").value.trim();
  if (jsonStr.length === 0) return;

  try {
    const profile = JSON.parse(jsonStr);
    if (!profile.name || !profile.ftp) {
      alert(
        "Formato de perfil no válido. Faltan campos obligatorios (name, ftp).",
      );
      return;
    }
    const newId = await DbManager.insertUser({
      uuid: profile.uuid || undefined,
      name: profile.name,
      weight: profile.weight || 75.0,
      ftp: profile.ftp || 200,
      maxHeartRate: profile.maxHeartRate || 190,
      age: profile.age || 30,
      height: profile.height || 175,
    });

    const user = await DbManager.getUserById(newId);
    hideModal("import-user");
    document.getElementById("import-json-data").value = "";
    selectUser(user);
  } catch (e) {
    console.error(e);
    alert("Formato JSON no válido.");
  }
}

async function handleDeleteProfile() {
  if (!state.currentUser) return;
  const confirmDel = confirm(
    `¿Estás seguro de que quieres eliminar el perfil de ${state.currentUser.name}? Esto borrará sus datos permanentemente.`,
  );
  if (confirmDel) {
    try {
      await DbManager.deleteUser(state.currentUser.id);
      hideModal("edit-user");
      handleLogout();
    } catch (e) {
      console.error(e);
    }
  }
}

function handleExportProfile() {
  if (!state.currentUser) return;
  const profile = {
    uuid: state.currentUser.uuid,
    name: state.currentUser.name,
    weight: state.currentUser.weight,
    ftp: state.currentUser.ftp,
    maxHeartRate: state.currentUser.maxHeartRate,
    age: state.currentUser.age,
    height: state.currentUser.height,
  };
  const jsonStr = JSON.stringify(profile, null, 2);

  // Prompt copy
  navigator.clipboard
    .writeText(jsonStr)
    .then(() => {
      alert(
        "¡Código de Perfil copiado al portapapeles! Pégalo en otro dispositivo para importarlo.",
      );
    })
    .catch(() => {
      alert(`Copia este código:\n\n${jsonStr}`);
    });
}

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
      alert(
        "Se necesita conectar al menos un sensor (Rodillo inteligente, potenciómetro, sensor de velocidad) o activar el Rodillo Virtual para iniciar entrenamientos interactivos.",
      );
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
      if (status === "CONECTADO") {
        icon.className = "indicator-icon active";
      } else if (status === "CONECTANDO" || status === "BUSCANDO") {
        icon.className = "indicator-icon connecting";
      } else {
        icon.className = "indicator-icon";
      }
    }
  });
}

// --- TELEMETRY RX & CALCULATIONS ---
function onPowerReceived(power) {
  state.currentPower = power;
  setElText("metrics-power", power);

  // Power Buffer 3s rolling average
  state.powerBuffer.push(power);
  if (state.powerBuffer.length > 3) state.powerBuffer.shift();
  state.power3s = Math.round(
    state.powerBuffer.reduce((a, b) => a + b, 0) / state.powerBuffer.length,
  );

  const ftp = state.currentUser ? state.currentUser.ftp : 200;
  let zoneColor = "#10b981";
  let activeZoneIndex = 0;

  if (power < ftp * 0.55) {
    zoneColor = "#6b7280";
    activeZoneIndex = 0;
  } else if (power < ftp * 0.75) {
    zoneColor = "#3b82f6";
    activeZoneIndex = 1;
  } else if (power < ftp * 0.9) {
    zoneColor = "#10b981";
    activeZoneIndex = 2;
  } else if (power < ftp * 1.05) {
    zoneColor = "#f59e0b";
    activeZoneIndex = 3;
  } else if (power < ftp * 1.2) {
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

  // Reanudar automáticamente en modo ROUTE si se empieza a pedalear
  if (
    state.currentMode === "ROUTE" &&
    state.isSessionActive &&
    state.isAutoPaused &&
    power > 15
  ) {
    const userWeight = state.currentUser ? state.currentUser.weight : 75.0;
    const vSpeed = BleManager.calculateVirtualSpeed(
      power,
      state.currentSlope,
      userWeight,
    );
    if (vSpeed > 0.5) {
      state.isAutoPaused = false;
      resumeTimer();
    }
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
}

function onSpeedReceived(speedKph) {
  if (state.currentMode === "ROUTE") return;

  state.currentSpeed = speedKph;
  setElText("metrics-speed", speedKph.toFixed(1));

  const now = Date.now();

  // Auto-pause detection logic
  if (state.isSessionActive) {
    if (speedKph > 0.5) {
      state.lastMovementTime = now;
      if (state.isAutoPaused) {
        state.isAutoPaused = false;
        resumeTimer();
      }
    } else if (now - state.lastMovementTime > 3000) {
      // 3 seconds timeout
      if (!state.isPaused && !state.isAutoPaused) {
        state.isAutoPaused = true;
        pauseTimer();
      }
    }

    // Distance Accumulation based on speed & time delta
    if (!state.isPaused && state.lastSpeedUpdateTime > 0) {
      const deltaSeconds = (now - state.lastSpeedUpdateTime) / 1000.0;
      if (deltaSeconds > 0 && deltaSeconds < 5) {
        // Speed in km/h to km/s multiplied by deltaSeconds
        state.totalDistance += (speedKph / 3600.0) * deltaSeconds;
        setElText(
          "submetrics-distance",
          `${state.totalDistance.toFixed(2)} km`,
        );
        updateRouteSimulation(state.totalDistance);
      }
    }

    if (!state.isPaused && speedKph > 0) {
      state.speedHistory.push(speedKph);
      updateSessionAverages();
    }
  }

  state.lastSpeedUpdateTime = now;
}

// --- CYCLING PHYSICS / TSS / IF MATH ---
function calculateNormalizedPower() {
  if (state.powerHistory.length < 30) {
    return (
      state.powerHistory.reduce((a, b) => a + b, 0) /
        state.powerHistory.length || 0.0
    );
  }

  // 1. Calculate 30-second rolling averages
  const rollingAverages = [];
  for (let i = 29; i < state.powerHistory.length; i++) {
    const sum = state.powerHistory
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

// --- WORKOUT SCREEN ACTIVATION ---
function enterWorkoutScreen() {
  state.powerBuffer = [];
  state.powerHistory = [];
  state.hrHistory = [];
  state.speedHistory = [];
  state.elapsedSeconds = 0;
  state.totalDistance = 0.0;
  state.totalAscent = 0.0;
  state.currentRouteIndex = 0;
  state.currentSlope = 0.0;
  state.targetSlope = 0.0;
  state.lastSlopeRampTime = 0;
  state.timeInPowerZones = [0, 0, 0, 0, 0, 0];
  state.isPaused = false;
  state.isAutoPaused = false;
  state.isSessionActive = false;
  state.routeTotalAscent = 0;

  setElText("workout-timer", "00:00:00");
  setElText("metrics-power", "0");
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
  } else {
    setElDisplay("virtual-trainer-panel", "none");
  }

  configureWorkoutHudForMode();

  const isRouteMode = state.currentMode === "ROUTE";
  const ghostBanner = document.getElementById("ghost-banner");
  if (ghostBanner) ghostBanner.classList.remove("visible");

  if (isRouteMode) {
    initLeafletMap();
    ChartsManager.initUpcomingChart("upcoming-chart-inner");

    // Mostrar footer de elevación y cargar gráfico si hay puntos
    if (state.routePoints.length > 0) {
      setElDisplay("hud-elevation-footer", "block");
      ChartsManager.initElevationChart(
        "elevation-chart",
        state.routeDistances,
        state.routeElevations,
      );
    }

    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
      if (state.routePoints.length > 0) {
        drawRouteOnMap();
        refreshUpcomingPreview(0);
        updateRouteProgressHud();
      }
    }, 150);

    // Forzamos que siempre se muestre el modal de configuración de ruta al entrar al modo ruta
    showRouteModal();
  } else {
    hideRouteModal();
    setElDisplay("hud-elevation-footer", "none");
  }

  updatePauseButton("▶ Empezar");
}

// --- GPX ROUTE LOADER & PARSER ---
async function handleGpxUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  state.gpxFilename = file.name;
  const label = document.getElementById("gpx-filename-label");
  const btnPick = document.getElementById("btn-trigger-gpx-pick");

  if (label) label.textContent = `${file.name} (Procesando...)`;
  if (btnPick) {
    btnPick.disabled = true;
    btnPick.textContent = "Procesando Ruta...";
  }

  try {
    const text = await file.text();
    const routeData = await GpxManager.parseRouteAsync(text);

    if (routeData) {
      state.routePoints = routeData.points;
      state.routeElevations = routeData.elevations;
      state.routeDistances = routeData.distances;
      state.currentRouteIndex = 0;
      console.log(
        "DEBUG: routeData points count:",
        routeData.points ? routeData.points.length : "null",
      );
      state.routeTotalAscent = calculateTotalRouteAscent();

      initLeafletMap();
      drawRouteOnMap();
      refreshUpcomingPreview(0);
      updateRouteProgressHud(state);

      // Inicializar perfil de elevación principal
      setElDisplay("hud-elevation-footer", "block");
      ChartsManager.initElevationChart(
        "elevation-chart",
        state.routeDistances,
        state.routeElevations,
      );

      loadGhostRiderSession();
      if (label) label.textContent = file.name;
    } else {
      throw new Error("No se encontraron puntos de ruta válidos.");
    }
  } catch (err) {
    console.error("Error al procesar el archivo GPX:", err);
    alert(
      "Error al importar la ruta. Comprueba que sea un archivo GPX o TCX válido.",
    );
    if (label) label.textContent = "Ningún archivo seleccionado.";
  } finally {
    if (btnPick) {
      btnPick.disabled = false;
      btnPick.textContent = "Seleccionar Archivo GPX";
    }
  }
}

async function loadGhostRiderSession() {
  if (!state.currentUser) return;
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
        (p) => p.latitude !== null && p.longitude !== null,
      );

      if (state.ghostPoints.length > 0) {
        document.getElementById("ghost-banner").classList.add("visible");
        document.getElementById("ghost-time-gap").textContent = "-0:00";
        document.getElementById("ghost-time-gap").className =
          "ghost-value ahead";
        console.log(
          `Ghost Rider loaded from session: ${best.id}. Points count: ${state.ghostPoints.length}`,
        );
      }
    } else {
      state.ghostPoints = [];
      document.getElementById("ghost-banner").classList.remove("visible");
    }
  } catch (e) {
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
}

function drawRouteOnMap() {
  if (!state.map || state.routePoints.length === 0) return;

  // Clear previous overlays
  if (state.routePolyline) state.map.removeLayer(state.routePolyline);
  if (state.userMarker) state.map.removeLayer(state.userMarker);
  if (state.ghostMarker) state.map.removeLayer(state.ghostMarker);

  const latLngs = state.routePoints.map((p) => [p.lat, p.lon]);

  // Plot Polyline orange neon
  state.routePolyline = L.polyline(latLngs, {
    color: "#ff5722",
    weight: 6,
    opacity: 0.85,
  }).addTo(state.map);

  // Create cyclist marker with custom neon pulsing DivIcon
  const userIcon = L.divIcon({
    className: "custom-user-marker",
    html: '<div class="user-marker-core"><div class="user-marker-pulse"></div></div>',
    iconSize: [14, 14],
  });

  state.userMarker = L.marker(latLngs[0], {
    icon: userIcon,
    title: "Tú",
  }).addTo(state.map);

  // Autozoom fits bounds
  state.map.fitBounds(state.routePolyline.getBounds(), { padding: [20, 20] });
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

  try {
    const sessId = await DbManager.insertSession({
      userId: state.currentUser.id,
      startTime: Date.now(),
      gpxPath: state.currentMode === "ROUTE" ? state.gpxFilename : null,
    });

    state.currentSessionId = sessId;
    state.isSessionActive = true;
    state.isPaused = false;
    state.isAutoPaused = false;
    state.sessionStartTime = Date.now();
    state.lastSpeedUpdateTime = Date.now();
    state.lastMovementTime = Date.now();

    // Clean history array values
    state.powerHistory = [];
    state.hrHistory = [];
    state.speedHistory = [];
    state.elevationHistory = [];
    state.totalDistance = 0.0;
    state.totalAscent = 0.0;
    state.currentSlope = 0.0;
    state.targetSlope = 0.0;
    state.lastSlopeRampTime = Date.now();

    if (state.currentMode === "ROUTE" && state.routePoints.length > 0) {
      setRouteTargetSlope(0);
      applyTrainerSlope(0);
      refreshUpcomingPreview(0);
    } else {
      applyTrainerSlope(0);
    }

    // Start timer interval loop
    startTimerInterval();

    updatePauseButton("⏸ Pausa");
    console.log(`Active training session started: ${sessId}`);
  } catch (e) {
    console.error(e);
    alert("No se pudo inicializar la base de datos de entrenamiento.");
  }
}

function startTimerInterval() {
  if (state.timerInterval) clearInterval(state.timerInterval);

  state.timerInterval = setInterval(() => {
    if (state.isSessionActive) {
      const now = Date.now();

      // 1. Cálculos de velocidad virtual y estado (Modo Ruta) - Ocurren siempre
      if (state.currentMode === "ROUTE") {
        const userWeight = state.currentUser ? state.currentUser.weight : 75.0;
        const virtualSpeed = BleManager.calculateVirtualSpeed(
          state.currentPower,
          state.currentSlope,
          userWeight,
        );

        state.currentSpeed = virtualSpeed;
        setElText("metrics-speed", virtualSpeed.toFixed(1));

        if (!state.isPaused && virtualSpeed > 0) {
          state.speedHistory.push(virtualSpeed);
        }

        // Auto-pause detection logic based on virtual speed
        if (virtualSpeed > 0.5) {
          state.lastMovementTime = now;
          if (state.isAutoPaused) {
            state.isAutoPaused = false;
            resumeTimer();
          }
        } else if (now - state.lastMovementTime > 3000) {
          // 3 seconds timeout
          if (!state.isPaused && !state.isAutoPaused) {
            state.isAutoPaused = true;
            pauseTimer();
          }
        }
      }

      // 2. Rampa de pendiente y Simulador (Ocurren siempre para mantener el rodillo sincronizado)
      stepSlopeRamp();
      if (BleManager.simulator.isActive && state.currentMode === "ROUTE") {
        BleManager.simulator.slope = state.currentSlope;
      }

      // 3. Lógica de progresión (Solo si NO está pausado)
      if (!state.isPaused) {
        state.elapsedSeconds++;

        // Update Timer label
        const h = Math.floor(state.elapsedSeconds / 3600);
        const m = Math.floor((state.elapsedSeconds % 3600) / 60);
        const s = state.elapsedSeconds % 60;
        const formatted = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        setElText("workout-timer", formatted);

        if (state.currentMode === "ROUTE") {
          state.totalDistance += state.currentSpeed / 3600.0;
          if (window.ChartsManager) {
            window.ChartsManager.setElevationCursor(
              state.totalDistance / 1000,
              state.routeTotalDistance / 1000,
            );
          }
          setElText(
            "submetrics-distance",
            `${state.totalDistance.toFixed(2)} km`,
          );
          updateRouteProgressHud(state);
          updateRouteSimulation(state.totalDistance);
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

        // Persistent telemetry point save
        saveTelemetryPoint();
        if (state.elapsedSeconds % 30 === 0) {
          flushTelemetryBuffer();
        }
      }
    }
  }, 1000);
}

function pauseTimer() {
  state.isPaused = true;
  state.lastSlopeRampTime = Date.now();

  updatePauseButton("▶ Reanudar", "resume");
  if (state.isAutoPaused) {
    setElDisplay("workout-autopause-label", "block");
  }
}

function resumeTimer() {
  state.isPaused = false;
  state.lastSpeedUpdateTime = Date.now();
  state.lastMovementTime = Date.now();
  state.lastSlopeRampTime = Date.now();

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

  const point = {
    sessionId: state.currentSessionId,
    timestamp: Date.now(),
    speed: state.currentSpeed,
    power: state.currentPower,
    cadence: state.currentCadence,
    heartRate: state.currentHr,
    slope: state.currentSlope,
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

async function stopSessionFlow() {
  if (!state.isSessionActive) {
    navigateTo("dashboard");
    return;
  }

  const confirmStop = confirm(
    "¿Quieres finalizar y guardar el entrenamiento actual?",
  );
  if (!confirmStop) return;

  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.isSessionActive = false;

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
  const finalDistance = state.totalDistance; // km
  const avgSpeed =
    finalDistance > 0 && state.elapsedSeconds > 0
      ? finalDistance / (state.elapsedSeconds / 3600.0)
      : 0.0;

  try {
    // Guardar los puntos pendientes en el búfer
    await flushTelemetryBuffer();

    // Update DB Session headers
    const currentSession = await DbManager.getSessionById(
      state.currentSessionId,
    );
    if (currentSession) {
      await DbManager.updateSession({
        ...currentSession,
        endTime: Date.now(),
        totalDistance: finalDistance,
        averageSpeed: avgSpeed,
        averagePower: avgPower,
        averageHeartRate: avgHr,
      });
    }

    // Populate summary screen UI
    document.getElementById("summary-duration").textContent = duration;
    document.getElementById("summary-distance").textContent =
      `${finalDistance.toFixed(2)} km`;
    document.getElementById("summary-np").textContent = `${np} W`;
    document.getElementById("summary-tss").textContent = tss;
    document.getElementById("summary-if").textContent =
      intensityFactor.toFixed(2);
    document.getElementById("summary-calories").textContent =
      `${state.calories} kcal`;
    document.getElementById("summary-power-stats").textContent =
      `${avgPower} / ${maxPower} W`;
    document.getElementById("summary-speed-stats").textContent =
      `${avgSpeed.toFixed(1)} / ${(avgSpeed * 1.3).toFixed(1)} km/h`; // Estimate max speed approx
    document.getElementById("summary-hr-stats").textContent =
      `${avgHr} / ${maxHr} bpm`;

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
  } catch (e) {
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

    // 1. Move Marker on Map
    if (state.userMarker) {
      state.userMarker.setLatLng([point.lat, point.lon]);
      state.map.panTo([point.lat, point.lon]);
    }

    // 2. Sync elevation chart cursor
    if (index < state.routePoints.length - 1) {
      const elevationDiffMeters =
        state.routeElevations[index + 1] - state.routeElevations[index];
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

  // Pendiente objetivo: media de los próximos 20 m desde la posición actual
  setRouteTargetSlope(currentDistKm);
  refreshUpcomingPreview(currentDistKm);
  stepSlopeRamp();
}

function coerceSlope(slope) {
  return Math.max(-15.0, Math.min(20.0, slope));
}

function setRouteTargetSlope(currentDistKm) {
  const preview = getUpcomingSegmentData(SLOPE_AVERAGE_METERS, currentDistKm);
  if (preview) {
    state.targetSlope = coerceSlope(preview.avgSlope);
  }
}

function applyTrainerSlope(slope) {
  BleManager.setTrainerSlope(slope);
}

function syncSlopeDisplayLabels() {
  const formatted = `${state.currentSlope >= 0 ? "+" : ""}${state.currentSlope.toFixed(1)}%`;
  const manualLabel = document.getElementById("manual-slope-label");
  if (manualLabel) manualLabel.textContent = formatted;

  const sentLabel = document.getElementById("current-slope-sent-label");
  if (sentLabel) {
    sentLabel.textContent = `Rodillo: ${state.currentSlope >= 0 ? "+" : ""}${state.currentSlope.toFixed(1)}%`;
  }
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
  if (deltaSec <= 0) return;
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

function adjustManualSlope(delta) {
  updateTrainerSlope(state.currentSlope + delta, true);
}

function getElevationAtDistance(distKm) {
  if (state.routeElevations.length === 0) return 0;
  if (distKm <= state.routeDistances[0]) return state.routeElevations[0];

  const lastIdx = state.routeDistances.length - 1;
  if (distKm >= state.routeDistances[lastIdx])
    return state.routeElevations[lastIdx];

  const idx = state.routeDistances.findIndex((d) => d >= distKm);
  const d0 = state.routeDistances[idx - 1];
  const d1 = state.routeDistances[idx];
  const span = d1 - d0;
  if (span < 0.00001) return state.routeElevations[idx - 1];

  const t = (distKm - d0) / span;
  return (
    state.routeElevations[idx - 1] +
    (state.routeElevations[idx] - state.routeElevations[idx - 1]) * t
  );
}

// --- PREDICTIVE UPCOMING SLOPE AND RELIEF ---
function getUpcomingSegmentData(
  previewDistanceMeters = SLOPE_PREVIEW_LONG_METERS,
  currentDistKm = null,
) {
  if (state.routePoints.length === 0) return null;

  const currentDistanceKm =
    currentDistKm !== null
      ? currentDistKm
      : state.routeDistances[state.currentRouteIndex];

  const targetDistanceKm = currentDistanceKm + previewDistanceMeters / 1000.0;
  const routeEndKm = state.routeDistances[state.routeDistances.length - 1];
  const actualEndKm = Math.min(targetDistanceKm, routeEndKm);

  const previewDistances = [];
  const previewElevations = [];

  let endIndex = state.currentRouteIndex;

  for (let i = 0; i < state.routeDistances.length; i++) {
    if (state.routeDistances[i] < currentDistanceKm) continue;

    endIndex = i;
    const relativeDistanceM =
      (state.routeDistances[i] - currentDistanceKm) * 1000.0;
    previewDistances.push(relativeDistanceM);
    previewElevations.push(state.routeElevations[i]);

    if (state.routeDistances[i] >= actualEndKm) {
      break;
    }
  }

  const distanceRun = (actualEndKm - currentDistanceKm) * 1000.0;
  if (distanceRun < 3.0) return null;

  const startEle = getElevationAtDistance(currentDistanceKm);
  const endEle = getElevationAtDistance(actualEndKm);
  const avgSlope = ((endEle - startEle) / distanceRun) * 100.0;

  return {
    distances: previewDistances,
    elevations: previewElevations,
    avgSlope: avgSlope,
  };
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

  const preview = getUpcomingSegmentData(SLOPE_PREVIEW_LONG_METERS, distKm);
  if (!preview) return;

  const slope = preview.avgSlope;
  const slopeEl = document.getElementById("metrics-slope");
  if (slopeEl) {
    slopeEl.textContent = `⛰️ ${slope >= 0 ? "+" : ""}${slope.toFixed(1)}%`;
    if (slope > 5) {
      slopeEl.style.background = "rgba(239, 68, 68, 0.92)";
    } else if (slope > 2) {
      slopeEl.style.background = "rgba(249, 115, 22, 0.92)";
    } else if (slope < -2) {
      slopeEl.style.background = "rgba(16, 185, 129, 0.92)";
    } else {
      slopeEl.style.background = "rgba(255, 68, 68, 0.9)";
    }
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
      if (!state.ghostMarker) {
        // Create green neon icon or marker for rival ghost
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

// --- GPX DOWNLOAD EXPORTER TRIGGER ---
async function handleSessionExport() {
  if (!state.currentSessionId && !state.lastSavedSessionId) return;
  const sId = state.currentSessionId || state.lastSavedSessionId;

  try {
    const session = await DbManager.getSessionById(sId);
    const data = await DbManager.getSensorDataForSession(sId);

    if (session && data.length > 0) {
      const uName = state.currentUser ? state.currentUser.name : "Usuario";
      GpxManager.exportSession(session, data, uName);
    } else {
      alert("Error: No hay datos de telemetría válidos para exportar.");
    }
  } catch (e) {
    console.error(e);
  }
}

// --- HISTORY AND STATISTICS SCREENS ---
async function loadHistoryList() {
  if (!state.currentUser) return;

  try {
    const sessions = await DbManager.getAllSessions(state.currentUser.id);
    const container = document.getElementById("history-items-container");
    container.innerHTML = "";

    if (sessions.length === 0) {
      container.innerHTML = `
        <div class="glass-card" style="text-align: center; padding: 40px; color: var(--text-secondary);">
          No se han registrado sesiones de entrenamiento en tu perfil.
        </div>
      `;
      return;
    }

    sessions.forEach((s) => {
      const date = new Date(s.startTime).toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const duration = s.endTime
        ? new Date(s.endTime - s.startTime).toISOString().substr(11, 8)
        : "00:00:00";

      const modeText = s.gpxPath ? "Ruta" : "Manual";
      const modeClass = s.gpxPath ? "route" : "manual";

      const card = document.createElement("div");
      card.className = "glass-card history-item";

      card.innerHTML = `
        <div class="history-date-box">
          <span class="history-date">${date}</span>
          <span class="history-type ${modeClass}">Modo: ${modeText} ${s.gpxPath ? `(${s.gpxPath})` : ""}</span>
        </div>

        <div class="history-stats-row">
          <div class="history-stat-unit">
            <span class="history-stat-label">Distancia</span>
            <span class="history-stat-value">${s.totalDistance.toFixed(2)} km</span>
          </div>
          <div class="history-stat-unit">
            <span class="history-stat-label">Duración</span>
            <span class="history-stat-value">${duration}</span>
          </div>
          <div class="history-stat-unit">
            <span class="history-stat-label">Pot. Media</span>
            <span class="history-stat-value">${s.averagePower} W</span>
          </div>
          <button class="btn btn-danger" style="padding: 6px 12px; font-size: 11px; border-radius: 8px;" id="btn-del-${s.id}">❌</button>
          </div>
        `;

      card.querySelector(`#btn-del-${s.id}`).onclick = (e) => {
        e.stopPropagation();
        deleteHistorySession(s.id);
      };

      // Let user download GPX of this specific session when clicking the card
      card.onclick = () => downloadSpecificHistoryGpx(s.id);

      container.appendChild(card);
    });
  } catch (e) {
    console.error(e);
  }
}

async function deleteHistorySession(id) {
  const confirmDel = confirm(
    "¿Quieres eliminar permanentemente esta sesión de tu historial?",
  );
  if (confirmDel) {
    try {
      await DbManager.deleteSession(id);
      await DbManager.deleteDataForSession(id);
      loadHistoryList();
    } catch (e) {
      console.error(e);
    }
  }
}

async function downloadSpecificHistoryGpx(id) {
  try {
    const session = await DbManager.getSessionById(id);
    const data = await DbManager.getSensorDataForSession(id);
    if (session && data.length > 0) {
      const uName = state.currentUser ? state.currentUser.name : "Usuario";
      GpxManager.exportSession(session, data, uName);
    } else {
      alert("Esta sesión no posee datos de telemetría exportables.");
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadProgressStats() {
  if (!state.currentUser) return;

  try {
    const sessions = await DbManager.getAllSessions(state.currentUser.id);

    let totalSessions = sessions.length;
    let totalDist = 0.0;
    let totalMillis = 0;
    let maxPowerVal = 0;

    for (const s of sessions) {
      totalDist += s.totalDistance;
      if (s.endTime) {
        totalMillis += s.endTime - s.startTime;
      }

      // Query sensor max power
      const data = await DbManager.getSensorDataForSession(s.id);
      const powers = data.map((d) => d.power || 0);
      if (powers.length > 0) {
        const localMax = Math.max(...powers);
        if (localMax > maxPowerVal) maxPowerVal = localMax;
      }
    }

    // Format times
    const totalHours = Math.floor(totalMillis / 3600000);
    const totalMinutes = Math.floor((totalMillis % 3600000) / 60000);

    document.getElementById("stats-total-sessions").textContent = totalSessions;
    document.getElementById("stats-total-distance").textContent =
      `${totalDist.toFixed(1)} km`;
    document.getElementById("stats-total-time").textContent =
      `${totalHours}h ${totalMinutes}m`;
    document.getElementById("stats-max-power").textContent = `${maxPowerVal} W`;
  } catch (e) {
    console.error(e);
  }
}
