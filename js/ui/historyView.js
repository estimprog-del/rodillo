/**
 * historyView.js - Pantalla de Historial de Entrenamientos, resumen y exportación histórica
 */

import { state } from "../modules/state.js";
import { showToast, showConfirm } from "../modules/toast.js";
import { calculateNormalizedPowerFromValues } from "../core/physics.js";

let _navigateTo = null;
let _renderSummaryMetrics = null;
let _renderSummaryRoute = null;
let _setSessionSaveStatus = null;

export function initHistoryView(deps = {}) {
  if (deps.navigateTo) _navigateTo = deps.navigateTo;
  if (deps.renderSummaryMetrics) _renderSummaryMetrics = deps.renderSummaryMetrics;
  if (deps.renderSummaryRoute) _renderSummaryRoute = deps.renderSummaryRoute;
  if (deps.setSessionSaveStatus) _setSessionSaveStatus = deps.setSessionSaveStatus;
}

export function computeTotalAscent(elevations) {
  if (!Array.isArray(elevations) || elevations.length < 2) return 0;
  let ascent = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) ascent += diff;
  }
  return Math.round(ascent);
}

export async function renameHistoryRoute(id) {
  try {
    const session = await DbManager.getSessionById(id);
    if (!session || !session.gpxPath) return;
    const currentName = session.routeName || session.gpxPath;
    const newName = prompt("Nombre de la ruta:", currentName);
    if (newName === null) return;
    const routeName = newName.trim();
    if (!routeName) {
      showToast("El nombre de la ruta no puede estar vacío.", "warning");
      return;
    }
    await DbManager.updateSession({ ...session, routeName });
    await loadHistoryList();
  } catch (error) {
    console.error("Error renombrando la ruta histórica:", error);
    showToast("No se pudo cambiar el nombre de la ruta.", "error");
  }
}

export async function loadHistoryList() {
  if (!state.currentUser) return;

  try {
    const sessions = await DbManager.getAllSessions(state.currentUser.id);
    const container = document.getElementById("history-items-container");
    if (!container) return;
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

      const totalDuration = s.endTime
        ? new Date(s.endTime - s.startTime).toISOString().substr(11, 8)
        : "00:00:00";
      const activeDuration = Number.isFinite(Number(s.activeDuration))
        ? new Date(Number(s.activeDuration) * 1000)
            .toISOString()
            .substr(11, 8)
        : totalDuration;

      const modeText = s.gpxPath ? "Ruta" : "Manual";
      const modeClass = s.gpxPath ? "route" : "manual";
      const routeName = s.routeName || s.gpxPath || "Ruta";

      const card = document.createElement("div");
      card.className = "glass-card history-item";

      card.innerHTML = `
        <div class="history-date-box">
          <span class="history-date">${date}</span>
          <span class="history-type ${modeClass}">Modo: ${modeText} <span class="history-route-name" id="history-route-name-${s.id}"></span></span>
        </div>

        <div class="history-stats-row">
          <div class="history-stat-unit">
            <span class="history-stat-label">Distancia</span>
            <span class="history-stat-value">${(Number(s.totalDistance) || 0).toFixed(2)} km</span>
          </div>
          <div class="history-stat-unit">
            <span class="history-stat-label">Actividad</span>
            <span class="history-stat-value">${activeDuration}</span>
          </div>
          <div class="history-stat-unit">
            <span class="history-stat-label">Total sesión</span>
            <span class="history-stat-value">${totalDuration}</span>
          </div>
          <div class="history-stat-unit">
            <span class="history-stat-label">Pot. Media</span>
            <span class="history-stat-value">${s.averagePower || 0} W</span>
          </div>
          ${Array.isArray(s.routePoints) && s.routePoints.length > 0
            ? `<button class="btn btn-primary history-repeat-route" id="btn-repeat-${s.id}">Repetir ruta</button>`
            : ""}
          ${s.gpxPath ? `<button class="btn btn-dark history-rename-route" id="btn-rename-${s.id}">Renombrar</button>` : ""}
          <button class="btn btn-secondary" id="btn-export-csv-${s.id}">CSV</button>
          <button class="btn btn-primary" style="padding: 6px 12px; font-size: 11px; border-radius: 8px; background: #6366f1;" id="btn-export-fit-${s.id}">FIT</button>
          <button class="btn btn-danger" style="padding: 6px 12px; font-size: 11px; border-radius: 8px;" id="btn-del-${s.id}">❌</button>
        </div>
      `;

      const routeNameElement = card.querySelector(`#history-route-name-${s.id}`);
      if (routeNameElement) routeNameElement.textContent = `(${routeName})`;

      const delBtn = card.querySelector(`#btn-del-${s.id}`);
      if (delBtn) {
        delBtn.onclick = (e) => {
          e.stopPropagation();
          deleteHistorySession(s.id);
        };
      }

      const repeatButton = card.querySelector(`#btn-repeat-${s.id}`);
      if (repeatButton) {
        repeatButton.onclick = (e) => {
          e.stopPropagation();
          repeatRouteFromHistory(s.id);
        };
      }

      const csvButton = card.querySelector(`#btn-export-csv-${s.id}`);
      if (csvButton) {
        csvButton.onclick = (e) => {
          e.stopPropagation();
          downloadSpecificHistoryCsv(s.id);
        };
      }

      const fitButton = card.querySelector(`#btn-export-fit-${s.id}`);
      if (fitButton) {
        fitButton.onclick = (e) => {
          e.stopPropagation();
          downloadSpecificHistoryFit(s.id);
        };
      }

      const renameButton = card.querySelector(`#btn-rename-${s.id}`);
      if (renameButton) {
        renameButton.onclick = (e) => {
          e.stopPropagation();
          renameHistoryRoute(s.id);
        };
      }

      card.onclick = () => openHistoricalSessionSummary(s.id, "history");
      container.appendChild(card);
    });
  } catch (e) {
    console.error("Error cargando historial de sesiones:", e);
  }
}

export async function repeatRouteFromHistory(id) {
  try {
    const session = await DbManager.getSessionById(id);
    if (!session || !Array.isArray(session.routePoints) || session.routePoints.length === 0) {
      showToast("Esta sesión no contiene una copia reutilizable de la ruta.", "info");
      return;
    }

    state.currentMode = "ROUTE";
    state.gpxFilename = session.gpxPath || `Ruta histórica ${id}.gpx`;
    state.routeName = session.routeName || session.gpxPath || `Ruta histórica ${id}`;
    state.routePoints = session.routePoints.map((point) => ({
      lat: Number(point.lat),
      lon: Number(point.lon),
    }));
    state.routeElevations = Array.isArray(session.routeElevations)
      ? session.routeElevations.map(Number)
      : state.routePoints.map(() => 0);
    state.routeDistances = Array.isArray(session.routeDistances)
      ? session.routeDistances.map(Number)
      : [];
    state.routeTotalAscent = Number(session.routeTotalAscent) || computeTotalAscent(state.routeElevations);
    state.currentRouteIndex = 0;
    state.routeLoadedFromHistory = true;

    if (typeof _navigateTo === "function") {
      _navigateTo("connections");
    }
  } catch (error) {
    console.error("Error al repetir la ruta histórica:", error);
    showToast("No se pudo cargar la ruta seleccionada.", "error");
  }
}

export async function openHistoricalSessionSummary(id, returnScreen = "history") {
  try {
    const session = await DbManager.getSessionById(id);
    const telemetry = await DbManager.getSensorDataForSession(id);

    if (!session) {
      showToast("No se encontró la sesión seleccionada.", "error");
      return;
    }

    const totalDurationSeconds = session.endTime
      ? Math.max(0, (session.endTime - session.startTime) / 1000)
      : 0;
    const activeDurationSeconds =
      Number.isFinite(Number(session.activeDuration)) &&
      Number(session.activeDuration) >= 0
        ? Number(session.activeDuration)
        : totalDurationSeconds;
    const duration = new Date(activeDurationSeconds * 1000)
      .toISOString()
      .substr(11, 8);
    const totalDuration = new Date(totalDurationSeconds * 1000)
      .toISOString()
      .substr(11, 8);
    const powers = telemetry.map((point) => Number(point.power) || 0);
    const speeds = telemetry.map((point) => Number(point.speed) || 0);
    const heartRates = telemetry
      .map((point) => Number(point.heartRate) || 0)
      .filter((value) => value > 0);

    const avgPower = Number(session.averagePower) || 0;
    let maxPower = Number.isFinite(Number(session.maxPower)) ? Number(session.maxPower) : 0;
    if (!maxPower && powers.length > 0) {
      for (let i = 0; i < powers.length; i++) {
        if (powers[i] > maxPower) maxPower = powers[i];
      }
    }

    const avgHr = Number(session.averageHeartRate) || 0;
    let maxHr = Number.isFinite(Number(session.maxHeartRate)) ? Number(session.maxHeartRate) : 0;
    if (!maxHr && heartRates.length > 0) {
      for (let i = 0; i < heartRates.length; i++) {
        if (heartRates[i] > maxHr) maxHr = heartRates[i];
      }
    }

    const distance = Number(session.totalDistance) || 0;
    const avgSpeed = Number.isFinite(Number(session.averageSpeed))
      ? Number(session.averageSpeed)
      : activeDurationSeconds > 0
        ? distance / (activeDurationSeconds / 3600)
        : 0;

    let maxSpeed = Number.isFinite(Number(session.maxSpeed)) ? Number(session.maxSpeed) : 0;
    if (!maxSpeed && speeds.length > 0) {
      for (let i = 0; i < speeds.length; i++) {
        if (speeds[i] > maxSpeed) maxSpeed = speeds[i];
      }
    }

    const ftp = state.currentUser ? state.currentUser.ftp : 200;
    const np = Number.isFinite(Number(session.normalizedPower))
      ? Number(session.normalizedPower)
      : Math.round(calculateNormalizedPowerFromValues(powers));
    const intensityFactor = Number.isFinite(Number(session.intensityFactor))
      ? Number(session.intensityFactor)
      : ftp > 0
        ? parseFloat((np / ftp).toFixed(2))
        : 0;
    const tss = Number.isFinite(Number(session.tss))
      ? Number(session.tss)
      : ftp > 0
        ? Math.round((activeDurationSeconds * np * intensityFactor) / (ftp * 36))
        : 0;

    const timeInPowerZones = [0, 0, 0, 0, 0, 0];
    const z = state.powerZones || [55, 75, 88, 95, 106];

    powers.forEach((power) => {
      const thresholds = z.map((value) => ftp * (value / 100));
      let zone = thresholds.findIndex((threshold) => power < threshold);
      if (zone === -1) zone = 5;
      timeInPowerZones[zone]++;
    });

    state.lastSavedSessionId = id;
    state.summaryReturnScreen = returnScreen;

    if (typeof _setSessionSaveStatus === "function") {
      _setSessionSaveStatus("Sesión guardada correctamente", "var(--accent-green)");
    }

    if (typeof _renderSummaryMetrics === "function") {
      _renderSummaryMetrics({
        duration,
        totalDuration,
        distance,
        np,
        tss,
        intensityFactor,
        calories: Number.isFinite(Number(session.calories))
          ? Number(session.calories)
          : Math.round(avgPower * (activeDurationSeconds / 3600) * 3.6),
        kilojoules: Number.isFinite(Number(session.kilojoules))
          ? Number(session.kilojoules)
          : (Number.isFinite(Number(session.calories))
              ? Math.round(Number(session.calories) * 1.05)
              : Math.round(avgPower * (activeDurationSeconds / 1000))),
        avgPower,
        maxPower,
        avgSpeed,
        maxSpeed,
        avgHr,
        maxHr,
        timeInPowerZones,
      });
    }

    if (typeof _navigateTo === "function") {
      _navigateTo("summary");
    }

    if (typeof _renderSummaryRoute === "function") {
      _renderSummaryRoute(session, distance);
    }
  } catch (e) {
    console.error("Error loading historical session summary:", e);
    showToast("No se pudo abrir el resumen de la sesión.", "error");
  }
}
window.openHistoricalSessionSummary = openHistoricalSessionSummary;

export async function deleteHistorySession(id) {
  const confirmDel = await showConfirm(
    "¿Quieres eliminar permanentemente esta sesión de tu historial?",
  );
  if (confirmDel) {
    try {
      await DbManager.deleteSession(id);
      await DbManager.deleteDataForSession(id);
      await loadHistoryList();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function downloadSpecificHistoryGpx(id) {
  try {
    const session = await DbManager.getSessionById(id);
    const data = await DbManager.getSensorDataForSession(id);
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
      showToast("Esta sesión no posee datos de telemetría exportables.", "warning");
    }
  } catch (e) {
    console.error(e);
  }
}

export async function downloadSpecificHistoryCsv(id) {
  try {
    const session = await DbManager.getSessionById(id);
    const data = await DbManager.getSensorDataForSession(id);
    if (!session || data.length === 0) {
      showToast("Esta sesión no posee datos de telemetría exportables.", "warning");
      return;
    }

    const userName = state.currentUser ? state.currentUser.name : "Usuario";
    if (!GpxManager.exportSessionCsv(session, data, userName)) {
      showToast("No se pudo generar el archivo CSV de esta sesión.", "error");
    }
  } catch (error) {
    console.error("Error exportando CSV histórico:", error);
    showToast("No se pudo exportar el CSV de esta sesión.", "error");
  }
}
window.downloadSpecificHistoryCsv = downloadSpecificHistoryCsv;

export async function downloadSpecificHistoryFit(id) {
  try {
    const session = await DbManager.getSessionById(id);
    const data = await DbManager.getSensorDataForSession(id);
    if (!session || data.length === 0) {
      showToast("Esta sesión no posee datos de telemetría exportables.", "warning");
      return;
    }

    const userName = state.currentUser ? state.currentUser.name : "Usuario";
    if (!GpxManager.exportSessionFit(session, data, userName)) {
      showToast("No se pudo generar el archivo FIT de esta sesión.", "error");
    }
  } catch (error) {
    console.error("Error exportando FIT histórico:", error);
    showToast("No se pudo exportar el FIT de esta sesión.", "error");
  }
}
window.downloadSpecificHistoryFit = downloadSpecificHistoryFit;

export async function checkPendingSessions() {
  if (!state.currentUser) return;
  const sessions = await DbManager.getAllSessions(state.currentUser.id);
  const pending = sessions.find((s) => !s.endTime);

  if (pending) {
    if (
      await showConfirm(
        "Parece que tienes una sesión de entrenamiento incompleta. ¿Quieres recuperarla y guardarla?",
        "Recuperar sesión",
        "primary"
      )
    ) {
      pending.endTime = Date.now();
      await DbManager.updateSession(pending);
      showToast("Sesión recuperada con éxito.", "success");
    } else {
      await DbManager.deleteSession(pending.id);
      await DbManager.deleteDataForSession(pending.id);
    }
  }
}
