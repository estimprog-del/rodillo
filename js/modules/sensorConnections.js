import { state } from "./state.js";
import { setElDisplay } from "./ui.js";

export function createSensorConnectionsController() {
  const bleManager = () => window.BleManager;
  const metricSignalTimes = {
    power: null,
    heartRate: null,
    cadence: null,
    speed: null,
  };
  const metricIndicators = {
    power: { id: "indicator-PWR", label: "Potencia" },
    heartRate: { id: "indicator-HR", label: "Pulso" },
    cadence: { id: "indicator-CAD", label: "Cadencia" },
    speed: { id: "indicator-SPD", label: "Velocidad" },
  };
  let metricQualityInterval = null;

  function isMetricConnected(metric) {
    const connections = bleManager().connections;
    if (bleManager().simulator.isActive) return true;
    if (metric === "power") {
      return connections.TRAINER.status === "CONECTADO" ||
        connections.POWER.status === "CONECTADO";
    }
    if (metric === "heartRate") return connections.HRM.status === "CONECTADO";
    return connections.TRAINER.status === "CONECTADO" ||
      connections.CSC.status === "CONECTADO";
  }

  function refreshMetricQuality() {
    const status = document.getElementById("sensor-quality-status");
    const activeSignals = [];
    const staleSignals = [];
    const now = Date.now();

    Object.entries(metricIndicators).forEach(([metric, indicator]) => {
      const icon = document.getElementById(indicator.id);
      if (!icon) return;

      const connected = isMetricConnected(metric);
      const isFresh = connected &&
        metricSignalTimes[metric] !== null &&
        now - metricSignalTimes[metric] <= 5000;
      icon.classList.toggle("data-fresh", isFresh);
      icon.classList.toggle("data-stale", connected && !isFresh);

      if (!connected) return;
      const signalLabel = metric === "heartRate" ? "Pulso" : indicator.label;
      if (isFresh) {
        activeSignals.push(signalLabel);
        icon.title = `${signalLabel}: conectado, datos recientes`;
      } else {
        staleSignals.push(signalLabel);
        icon.title = `${signalLabel}: conectado, sin datos recientes`;
      }
      icon.setAttribute("aria-label", icon.title);
    });

    if (!status) return;
    if (!state.isSessionActive) {
      status.textContent = "La señal de los sensores se comprueba durante la sesión.";
      status.dataset.quality = "";
    } else if (staleSignals.length > 0) {
      status.textContent = `Sin datos recientes: ${staleSignals.join(", ")}.`;
      status.dataset.quality = "warning";
    } else if (activeSignals.length > 0) {
      status.textContent = `Señal correcta: ${activeSignals.join(", ")}.`;
      status.dataset.quality = "good";
    } else {
      status.textContent = "Sin sensores conectados; conecta sensores o activa el Rodillo Virtual.";
      status.dataset.quality = "warning";
    }
  }

  function onMetricReceived(metric) {
    if (!(metric in metricSignalTimes)) return;
    metricSignalTimes[metric] = Date.now();
    refreshMetricQuality();
  }

  function resetMetricQuality() {
    Object.keys(metricSignalTimes).forEach((metric) => {
      metricSignalTimes[metric] = null;
    });
    refreshMetricQuality();
  }

  function startMetricQualityMonitoring() {
    if (metricQualityInterval !== null) {
      clearInterval(metricQualityInterval);
    }
    refreshMetricQuality();
    metricQualityInterval = setInterval(refreshMetricQuality, 1000);
  }

  function stopMetricQualityMonitoring() {
    if (metricQualityInterval !== null) {
      clearInterval(metricQualityInterval);
      metricQualityInterval = null;
    }
    refreshMetricQuality();
  }

  // --- BLUETOOTH CONNECTION CENTER ---
  function syncBluetoothScreenStatus() {
    const hasBluetooth = !!navigator.bluetooth;
    setElDisplay("bluetooth-support-warning", hasBluetooth ? "none" : "block");

    for (const type in bleManager().connections) {
      const conn = bleManager().connections[type];
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
    if (bleManager().simulator.isActive) {
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
      bleManager().connections.TRAINER.status === "DESCONECTADO" &&
      trainerLabel
    ) {
      trainerLabel.textContent = `Último: ${lastTrainer} (pulsa Conectar)`;
    }
    if (
      lastHrm &&
      bleManager().connections.HRM.status === "DESCONECTADO" &&
      hrmLabel
    ) {
      hrmLabel.textContent = `Último: ${lastHrm} (pulsa Conectar)`;
    }

    syncDashboardSensorStatus();
  }

  async function triggerBleConnection(type) {
    const conn = bleManager().connections[type];
    if (conn.status === "CONECTADO") {
      bleManager().disconnectDevice(type);
      // Clear saved name if user manually disconnects
      if (type === "TRAINER")
        localStorage.removeItem("rodilloint_lastTrainerName");
      if (type === "HRM") localStorage.removeItem("rodilloint_lastHrmName");
      syncBluetoothScreenStatus();
    } else {
      try {
        showRadarOverlay(type);
        const name = await bleManager().connectDevice(type);
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
    document.getElementById("radar-scan-overlay").className = "radar-overlay active";
  }
  function hideRadarOverlay() {
    document.getElementById("radar-scan-overlay").className = "radar-overlay";
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
        const isConnected = bleManager().simulator.isActive || status === "CONECTADO";
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
        if (bleManager().simulator.isActive) {
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
    refreshMetricQuality();
  }

  function syncDashboardSensorStatus() {
    const btn = document.getElementById("btn-dashboard-sensors");
    if (!btn) return;

    const connections = bleManager().connections;
    const hasAnyConnected =
      connections.TRAINER.status === "CONECTADO" ||
      connections.HRM.status === "CONECTADO" ||
      connections.POWER.status === "CONECTADO" ||
      connections.CSC.status === "CONECTADO";

    const hasAnyConnecting =
      connections.TRAINER.status === "CONECTANDO" ||
      connections.TRAINER.status === "BUSCANDO" ||
      connections.HRM.status === "CONECTANDO" ||
      connections.HRM.status === "BUSCANDO" ||
      connections.POWER.status === "CONECTANDO" ||
      connections.POWER.status === "BUSCANDO" ||
      connections.CSC.status === "CONECTANDO" ||
      connections.CSC.status === "BUSCANDO";

    btn.classList.remove("connected", "connecting");
    if (hasAnyConnected) {
      btn.classList.add("connected");
      btn.title = "Sensores: alguno conectado";
      btn.setAttribute("aria-label", "Sensores: alguno conectado");
    } else if (hasAnyConnecting) {
      btn.classList.add("connecting");
      btn.title = "Sensores: conectando...";
      btn.setAttribute("aria-label", "Sensores: conectando...");
    } else {
      btn.title = "Sensores: sin conectar";
      btn.setAttribute("aria-label", "Sensores: sin conectar");
    }

    const openConnections = () => {
      if (typeof window._navigateTo === "function") {
        window._navigateTo("connections");
      }
    };

    btn.onclick = openConnections;
    btn.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openConnections();
      }
    };
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
          bleManager().connections.TRAINER.device &&
          bleManager().connections.TRAINER.status === "DESCONECTADO";
        const connectionType = trainerDisconnected ? "TRAINER" : type;
        if (bleManager().connections[connectionType]?.status !== "DESCONECTADO") return;
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

  return {
    syncBluetoothScreenStatus,
    syncDashboardSensorStatus,
    triggerBleConnection,
    onStatusChanged,
    onMetricReceived,
    refreshMetricQuality,
    resetMetricQuality,
    startMetricQualityMonitoring,
    stopMetricQualityMonitoring,
    initSensorReconnectControls,
  };
}
