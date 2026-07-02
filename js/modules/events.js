import { showModal, hideModal } from "./ui.js";
import { state } from "./state.js";

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
      "button, .glass-card, #btn-show-add-user, #btn-show-import-user, #btn-summary-close, #mode-route, #mode-manual, #mode-traditional, #btn-workout-pause, #btn-workout-stop, #btn-slope-minus, #btn-slope-plus, #btn-export-gpx, [id^='btn-connect-'], #btn-toggle-sim, #btn-connections-continue, #btn-modal-cancel, #btn-modal-confirm",
    );

    if (!target) return;
    const id = target.id;

    setTimeout(() => {
      // Modales y Navegación
      if (id === "btn-show-add-user") showModal("add-user");
      if (id === "btn-show-import-user") showModal("import-user");
      if (id === "btn-close-add-user") hideModal("add-user");
      if (id === "btn-close-import-user") hideModal("import-user");
      if (id === "btn-close-edit-user") hideModal("edit-user");
      if (id === "btn-dashboard-settings") {
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
        showModal("edit-user");
      }

      if (id === "btn-dashboard-connections") navigateTo("connections");
      if (id === "btn-summary-close") navigateTo("dashboard");
      if (id === "btn-go-history") navigateTo("history");
      if (id === "btn-history-back") navigateTo("dashboard");
      if (id === "btn-go-progress") navigateTo("stats");
      if (id === "btn-logout") handleLogout();
      if (id === "btn-connections-back") navigateTo("dashboard");

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
      if (id === "btn-slope-minus") adjustManualSlope(-0.5);
      if (id === "btn-slope-plus") adjustManualSlope(0.5);
      if (id === "btn-export-gpx") handleExportProfile();

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
        const hasControllable =
          ble?.connections?.TRAINER?.status === "CONECTADO";
        const hasPower = ble?.connections?.POWER?.status === "CONECTADO";
        const hasSpeed = ble?.connections?.CSC?.status === "CONECTADO";
        if (isVirtual || hasControllable || hasPower || hasSpeed) {
          navigateTo("workout");
        } else {
          alert(
            "Debes conectar al menos un sensor (Rodillo, Potencia o Velocidad) o activar el Rodillo Virtual para continuar.",
          );
        }
      }

      // Sesión GPX
      if (id === "btn-modal-cancel") {
        document.getElementById("route-modal").classList.remove("active");
        navigateTo("dashboard");
      }
      if (id === "btn-modal-confirm") {
        if (state.routePoints.length === 0) {
          alert("Selecciona un archivo GPX/TCX antes de empezar.");
        } else {
          document.getElementById("route-modal").classList.remove("active");
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

  document.querySelectorAll(".btn-font-scale").forEach((btn) => {
    const scaleType = btn.getAttribute("data-scale");
    btn.onclick = (e) => {
      const inc = scaleType === "lg" ? 0.25 : -0.25;
      setWorkoutFontScale(inc);
    };
  });
}
