import { showModal, hideModal } from "./ui.js";
import {
  openAddUserModal,
  closeAddUserModal,
  openImportUserModal,
  closeImportUserModal,
  openEditUserModal,
  closeEditUserModal,
  openSettingsModal,
  closeSettingsModal,
  openRouteModal,
  closeRouteModal,
} from "../ui/modals.js";
import { state, saveStateToLocalStorage } from "./state.js";
import { exportAllData, importAllData } from "../db.js";

export function bindEvents(handlers) {
  const {
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
    setWorkoutFontScale,
    startSession,
  } = handlers;

  // Add user form submission
  const addUserForm = document.getElementById("form-add-user");
  if (addUserForm) {
    addUserForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleAddUserSubmit(e);
    });
  }

  document.body.addEventListener("click", (e) => {
    const target = e.target.closest(
      "button, .glass-card, #btn-show-add-user, #btn-show-import-user, #btn-summary-close, #mode-route, #mode-manual, #mode-traditional, #btn-workout-pause, #btn-workout-stop, #btn-slope-minus, #btn-slope-plus, #btn-export-gpx, [id^='btn-connect-'], #btn-toggle-sim, #btn-connections-continue, #btn-modal-cancel, #btn-modal-confirm, #btn-stats-back, #btn-dashboard-settings, #btn-open-user-profile-trigger, #btn-close-settings, #btn-save-settings, #btn-toggle-3d",
    );

    if (!target) return;
    const id = target.id;

    setTimeout(() => {
      // Modales y Navegación
      if (id === "btn-show-add-user") openAddUserModal();
      if (id === "btn-show-import-user") openImportUserModal();
      if (id === "btn-close-add-user") closeAddUserModal();
      if (id === "btn-close-import-user") closeImportUserModal();
      if (id === "btn-close-edit-user") closeEditUserModal();
      const openUserProfile = () => {
        const u = state.currentUser;
        if (u) {
          document.getElementById("edit-user-name").value = u.name || "";
          document.getElementById("edit-user-weight").value = u.weight || "";
          document.getElementById("edit-user-ftp").value = u.ftp || "";
          document.getElementById("edit-user-maxhr").value =
            u.maxHeartRate || "";
          document.getElementById("edit-user-age").value = u.age || "";
          document.getElementById("edit-user-height").value = u.height || "";
        }
        openEditUserModal();
      };

      const openSettingsModalHandler = () => {
        openSettingsModal();
      };

      if (id === "btn-open-user-profile-trigger") {
        openUserProfile();
      }
      if (id === "btn-dashboard-settings") {
        openSettingsModal();
        setTimeout(() => {
          document.getElementById("setting-map-type").value = state.mapType || 'maplibre';
          document.getElementById("setting-font-scale").value = state.fontScale || 1.0;
          
          const realismSlider = document.getElementById("setting-realism");
          const realismDisplay = document.getElementById("realism-val-display");
          realismSlider.value = Math.round(state.realismFactor * 100) || 100;
          realismDisplay.textContent = realismSlider.value;
          
          // Actualizar display al mover el slider
          realismSlider.oninput = (e) => realismDisplay.textContent = e.target.value;

          document.getElementById("setting-power-zones").value = state.powerZones ? state.powerZones.join(',') : "55,75,88,95,106";
          
          document.querySelectorAll('.btn-smoothing').forEach(btn => {
            btn.style.background = btn.getAttribute('data-val') == (state.sensorSmoothing || 3000) ? '#10b981' : '#333';
          });
        }, 250);
      }
      if (id === "btn-save-settings") {
        state.mapType = document.getElementById("setting-map-type").value;
        state.fontScale = parseFloat(document.getElementById("setting-font-scale").value);
        state.realismFactor = parseInt(document.getElementById("setting-realism").value) / 100;
        state.powerZones = document.getElementById("setting-power-zones").value.split(',').map(Number);
        
        saveStateToLocalStorage();
        closeSettingsModal();
      }
      if (e.target.classList.contains('btn-smoothing')) {
        state.sensorSmoothing = parseInt(e.target.getAttribute('data-val'));
        document.querySelectorAll('.btn-smoothing').forEach(btn => {
          btn.style.background = btn === e.target ? '#10b981' : '#333';
        });
      }
      if (id === "btn-backup-data") {
        exportAllData();
      }

      if (id === "btn-dashboard-connections") navigateTo("connections");
      if (id === "btn-summary-close") navigateTo("dashboard");
      if (id === "btn-go-history") navigateTo("history");
      if (id === "btn-history-back") navigateTo("dashboard");
      if (id === "btn-go-progress") navigateTo("stats");
      if (id === "btn-logout") handleLogout();
      if (id === "btn-connections-back") navigateTo("dashboard");
      if (id === "btn-stats-back") navigateTo("dashboard");

      // Modos
      if (id === "mode-route") {
        state.currentMode = "ROUTE";
        navigateTo("connections");
      }
      if (id === "mode-manual") {
        state.currentMode = "MANUAL";
        navigateTo("connections");
      }
      if (id === "mode-traditional") {
        state.currentMode = "TRADITIONAL";
        navigateTo("connections");
      }

      // Controles entrenamiento
      if (id === "btn-workout-pause") togglePause();
      if (id === "btn-workout-stop") stopSessionFlow();
      if (id === "btn-toggle-3d") {
        const btn = document.getElementById("btn-toggle-3d");
        if (typeof window.toggleMapEngine === "function") {
          window.toggleMapEngine(btn);
        }
      }
      // Control de fuentes
      if (e.target.classList.contains("btn-font-scale")) {
        const scale = e.target.getAttribute("data-scale");
        const increment = scale === "sm" ? -0.1 : scale === "lg" ? 0.1 : 0;
        if (increment !== 0) {
          setWorkoutFontScale(increment);
          // Actualizar visualmente la clase active
          document.querySelectorAll(".btn-font-scale").forEach((btn) => {
            btn.classList.remove("active");
          });
          e.target.classList.add("active");
        }
      }
      if (id === "btn-slope-minus") adjustManualSlope(-0.5);
      if (id === "btn-slope-plus") adjustManualSlope(0.5);
      if (id === "btn-export-gpx") handleSessionExport();

      // Bluetooth
      if (id && id.startsWith("btn-connect-")) {
        triggerBleConnection(id.replace("btn-connect-", ""));
      }

      // Simulador - Toggle
      if (id === "btn-toggle-sim") {
        if (typeof BleManager !== "undefined") {
          const btn = document.getElementById("btn-toggle-sim");
          if (BleManager.simulator.isActive) {
            BleManager.stopSimulator();
            const sensors = ["TRAINER", "POWER", "CSC"];
            sensors.forEach((type) => {
              const status = BleManager.connections[type].device
                ? "CONECTADO"
                : "DESCONECTADO";
              if (typeof updateStatus !== "undefined")
                updateStatus(type, status);
            });
            btn.textContent = "Activar Rodillo Virtual";
            btn.className = "btn btn-secondary";
            document.getElementById("virtual-trainer-panel").style.display =
              "none";
          } else {
            const weight = state.currentUser ? state.currentUser.weight : 75.0;
            BleManager.startSimulator(weight);
            btn.textContent = "Desactivar Rodillo Virtual";
            btn.className = "btn btn-danger";
            // No mostrar el panel aquí, se mostrará en enterWorkoutScreen
            document.getElementById("virtual-trainer-panel").style.display =
              "none";
          }
        }
      }

      // Simulador - Enlace de sliders
      const powerSlider = document.getElementById("sim-power-slider");
      const cadenceSlider = document.getElementById("sim-cadence-slider");
      const hrSlider = document.getElementById("sim-hr-slider");

      const updateSim = () => {
        const p = powerSlider.value;
        const c = cadenceSlider.value;
        const h = hrSlider.value;

        document.getElementById("sim-power-val").textContent = `${p} W`;
        document.getElementById("sim-cadence-val").textContent = `${c} rpm`;
        document.getElementById("sim-hr-val").textContent = `${h} bpm`;

        if (typeof BleManager !== "undefined") {
          BleManager.setSimulatedMetrics(p, h, c);
        }
      };

      if (powerSlider) powerSlider.oninput = updateSim;
      if (cadenceSlider) cadenceSlider.oninput = updateSim;
      if (hrSlider) hrSlider.oninput = updateSim;

      // Flujo de continuación
      if (id === "btn-connections-continue") {
        const ble = window.BleManager;
        const isVirtual = ble?.simulator?.isActive;
        const hasControllable = ble?.connections?.TRAINER?.status === "CONECTADO";
        const hasPower = ble?.connections?.POWER?.status === "CONECTADO";
        const hasSpeed = ble?.connections?.CSC?.status === "CONECTADO";
        if (isVirtual || hasControllable || hasPower || hasSpeed) {
          if (state.currentMode === "ROUTE") {
            openRouteModal();
          } else {
            navigateTo("workout");
          }
        } else {
          alert(
            "Debes conectar al menos un sensor (Rodillo, Potencia o Velocidad) o activar el Rodillo Virtual para continuar.",
          );
        }
      }

      // Sesión GPX
      if (id === "btn-modal-cancel") {
        closeRouteModal();
        navigateTo("dashboard");
      }
      if (id === "btn-modal-confirm") {
        if (state.routePoints.length === 0) {
          alert("Selecciona un archivo GPX/TCX antes de empezar.");
        } else {
          closeRouteModal();
          navigateTo("workout");
          if (!state.isSessionActive) startSession();
        }
      }
    }, 0);
  });

  // Eventos específicos (formularios, GPX, fuentes)
  document.getElementById("btn-submit-import-user").onclick =
    handleImportUserSubmit;
  document.getElementById("btn-delete-profile").onclick = handleDeleteProfile;
  document.getElementById("btn-export-profile").onclick = handleExportProfile;

  // Manejador GPX - Único y centralizado
  const gpxInput = document.getElementById("gpx-file-input");
  const gpxTrigger = document.getElementById("btn-trigger-gpx-pick");
  if (gpxTrigger && gpxInput) {
    gpxTrigger.onclick = () => {
      gpxInput.value = "";
      gpxInput.click();
    };
    gpxInput.removeEventListener("change", handleGpxUpload);
    gpxInput.addEventListener("change", handleGpxUpload);
  }

  // Restaurar backup
  const backupInput = document.getElementById("backup-file-input");
  const backupTrigger = document.getElementById("btn-trigger-import-backup");
  if (backupTrigger && backupInput) {
    backupTrigger.onclick = () => {
      backupInput.value = "";
      backupInput.click();
    };
    backupInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        importAllData(e.target.files[0]);
      }
    });
  }
}
