import { state } from "./state.js";
import { getVirtualGearRatio } from "./virtualGears.js";

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
    await window.DbManager.insertSensorDataBulk(pointsToSave);
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
        await window.DbManager.insertSensorDataBulk(backup);
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

export {
  flushTelemetryBuffer,
  recoverTelemetryBackup,
  saveTelemetryPoint,
};

