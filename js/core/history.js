/* js/core/history.js
 * Historial de sesiones, estadísticas y calendario de entrenamiento.
 * Extraído de app.js para reducir su tamaño (Fix 1 - God File).
 */

import { state } from '../modules/state.js';
import { showToast, showConfirm } from '../modules/toast.js';

// ──────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getSessionDurationSeconds(session) {
  const activeDuration = Number(session.activeDuration);
  if (Number.isFinite(activeDuration) && activeDuration >= 0) return activeDuration;
  return Math.max(0, (Number(session.endTime) - Number(session.startTime)) / 1000);
}

function getCompletedSessions(sessions) {
  return (sessions || []).filter((s) => {
    const startTime = Number(s.startTime);
    return Boolean(s.endTime) && Number.isFinite(startTime);
  });
}

function aggregateSessionMetrics(sessions) {
  return sessions.reduce(
    (acc, session) => {
      acc.sessions += 1;
      acc.distance += Math.max(0, Number(session.totalDistance) || 0);
      acc.duration += getSessionDurationSeconds(session);
      acc.ascent += Math.max(0, Number(session.totalAscent) || 0);
      return acc;
    },
    { sessions: 0, distance: 0, duration: 0, ascent: 0 }
  );
}

function formatActiveDuration(durationSeconds) {
  const totalMinutes = Math.floor(Math.max(0, durationSeconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function getWeekStartMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function calculateNormalizedPowerFromValues(values) {
  if (values.length < 30) {
    return values.reduce((a, b) => a + b, 0) / values.length || 0.0;
  }
  const rollingAverages = [];
  for (let i = 29; i < values.length; i++) {
    const sum = values.slice(i - 29, i + 1).reduce((a, b) => a + b, 0);
    rollingAverages.push(Math.pow(sum / 30.0, 4.0));
  }
  const avgPowers4 = rollingAverages.reduce((a, b) => a + b, 0) / rollingAverages.length;
  return Math.pow(avgPowers4, 0.25);
}

// ──────────────────────────────────────────────
// Calendario (estado local)
// ──────────────────────────────────────────────

let calendarCurrentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = formatDateKey(new Date());
let calendarSessions = [];
let selectedComparisonIds = [];

const SESSION_COMPARISON_METRICS = [
  { key: 'totalDistance', label: 'Distancia', unit: ' km', decimals: 2 },
  { key: 'activeDuration', label: 'Tiempo activo', unit: ' s', decimals: 0 },
  { key: 'averagePower', label: 'Potencia media', unit: ' W', decimals: 0 },
  { key: 'normalizedPower', label: 'Potencia normalizada', unit: ' W', decimals: 0 },
  { key: 'averageHeartRate', label: 'Pulso medio', unit: ' bpm', decimals: 0 },
  { key: 'tss', label: 'Carga (TSS)', unit: '', decimals: 0 },
  { key: 'ascent', label: 'Desnivel positivo', unit: ' m', decimals: 0 },
];

function getComparisonMetricValue(session, key) {
  if (key === 'activeDuration') return getSessionDurationSeconds(session);
  if (key === 'ascent') {
    const value = Number(session.routeTotalAscent ?? session.totalAscent);
    return Number.isFinite(value) ? value : null;
  }
  const value = Number(session[key]);
  return Number.isFinite(value) ? value : null;
}

function formatComparisonValue(value, metric) {
  if (value === null) return '—';
  if (metric.key === 'activeDuration') {
    const total = Math.floor(Math.max(0, value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${value.toFixed(metric.decimals)}${metric.unit}`;
}

function formatComparisonDifference(value, metric) {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  if (metric.key === 'activeDuration') {
    const total = Math.floor(Math.abs(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${sign}${Math.abs(value).toFixed(metric.decimals)}${metric.unit}`;
}

function renderHistoryComparison(sessions) {
  const panel = document.getElementById('history-comparison');
  if (!panel) return;

  const selected = selectedComparisonIds
    .map((id) => sessions.find((session) => String(session.id) === id))
    .filter((session) => session && session.endTime);
  selectedComparisonIds = selected.map((session) => String(session.id));
  panel.replaceChildren();

  if (selected.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const heading = document.createElement('div');
  heading.className = 'history-comparison-heading';
  const title = document.createElement('h3');
  title.textContent = 'Comparación de sesiones';
  const clearButton = document.createElement('button');
  clearButton.className = 'btn btn-dark btn-sm';
  clearButton.type = 'button';
  clearButton.textContent = 'Quitar selección';
  clearButton.addEventListener('click', () => {
    selectedComparisonIds = [];
    void loadHistoryList();
  });
  heading.append(title, clearButton);
  panel.appendChild(heading);

  if (selected.length === 1) {
    const hint = document.createElement('p');
    hint.textContent = 'Selecciona otra sesión finalizada para ver las diferencias.';
    panel.appendChild(hint);
    return;
  }

  const table = document.createElement('table');
  table.className = 'history-comparison-table';
  const header = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Métrica', ...selected.map((session) =>
    new Date(session.startTime).toLocaleString('es-ES', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  ), 'Diferencia'].forEach((label) => {
    const cell = document.createElement('th');
    cell.textContent = label;
    headerRow.appendChild(cell);
  });
  header.appendChild(headerRow);
  table.appendChild(header);

  const body = document.createElement('tbody');
  SESSION_COMPARISON_METRICS.forEach((metric) => {
    const values = selected.map((session) =>
      getComparisonMetricValue(session, metric.key)
    );
    const row = document.createElement('tr');
    const labelCell = document.createElement('th');
    labelCell.scope = 'row';
    labelCell.textContent = metric.label;
    row.appendChild(labelCell);
    values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = formatComparisonValue(value, metric);
      row.appendChild(cell);
    });
    const differenceCell = document.createElement('td');
    const difference = values.every((value) => value !== null)
      ? values[1] - values[0]
      : null;
    differenceCell.textContent =
      formatComparisonDifference(difference, metric);
    row.appendChild(differenceCell);
    body.appendChild(row);
  });
  table.appendChild(body);
  panel.appendChild(table);
}

// ──────────────────────────────────────────────
// Historial
// ──────────────────────────────────────────────

export async function loadHistoryList() {
  if (!state.currentUser) return;
  try {
    const sessions = await DbManager.getAllSessions(state.currentUser.id);
    const container = document.getElementById('history-items-container');
    if (!container) return;
    container.innerHTML = '';
    renderHistoryComparison(sessions);

    if (sessions.length === 0) {
      container.innerHTML = `
        <div class="glass-card" style="text-align: center; padding: 40px; color: var(--text-secondary);">
          No se han registrado sesiones de entrenamiento en tu perfil.
        </div>
      `;
      return;
    }

    sessions.forEach((s) => {
      const date = new Date(s.startTime).toLocaleDateString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const totalDuration = s.endTime
        ? new Date(s.endTime - s.startTime).toISOString().substr(11, 8)
        : '00:00:00';
      const activeDuration = Number.isFinite(Number(s.activeDuration))
        ? new Date(Number(s.activeDuration) * 1000).toISOString().substr(11, 8)
        : totalDuration;
      const sessionMode = s.mode || (s.gpxPath ? 'ROUTE' : 'MANUAL');
      const modeDetails = {
        ROUTE: { label: 'Ruta', className: 'route' },
        MANUAL: { label: 'Manual', className: 'manual' },
        ERG: { label: 'Entrenamiento ERG', className: 'erg' },
        TRADITIONAL: { label: 'Tradicional', className: 'traditional' },
      };
      const { label: modeText, className: modeClass } =
        modeDetails[sessionMode] || modeDetails.MANUAL;
      const routeName = s.routeName || s.gpxPath || 'Ruta';
      const isSelectedForComparison =
        selectedComparisonIds.includes(String(s.id));

      const card = document.createElement('div');
      card.className = 'glass-card history-item';
      card.innerHTML = `
        <div class="history-date-box">
          <span class="history-date">${date}</span>
          <span class="history-type ${modeClass}">Modo: ${modeText}${s.gpxPath ? ` <span class="history-route-name" id="history-route-name-${s.id}"></span>` : ''}</span>
        </div>
        <div class="history-details-row">
          <div class="history-stats-row">
            <div class="history-stat-unit">
              <span class="history-stat-label">Distancia</span>
              <span class="history-stat-value">${s.totalDistance.toFixed(2)} km</span>
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
              <span class="history-stat-value">${s.averagePower} W</span>
            </div>
          </div>
          <div class="history-actions">
            ${Array.isArray(s.routePoints) && s.routePoints.length > 0
              ? `<button class="btn btn-primary history-repeat-route" id="btn-repeat-${s.id}">Repetir ruta</button>`
              : ''}
            ${s.endTime
              ? `<button class="btn btn-secondary history-compare-session" data-session-id="${s.id}" aria-pressed="${isSelectedForComparison}">${isSelectedForComparison ? '✓ Comparando' : 'Comparar'}</button>`
              : ''}
            ${s.gpxPath ? `<button class="btn btn-dark history-rename-route" id="btn-rename-${s.id}">Renombrar</button>` : ''}
            <button class="btn btn-secondary" id="btn-export-csv-${s.id}">CSV</button>
            <button class="btn btn-primary history-export-fit" id="btn-export-fit-${s.id}">FIT</button>
            <button class="btn btn-danger history-delete-session" id="btn-del-${s.id}" aria-label="Eliminar sesión">×</button>
          </div>
        </div>
      `;

      const routeNameEl = card.querySelector(`#history-route-name-${s.id}`);
      if (routeNameEl) routeNameEl.textContent = `(${routeName})`;

      card.querySelector(`#btn-del-${s.id}`).onclick = (e) => {
        e.stopPropagation();
        deleteHistorySession(s.id);
      };
      const repeatButton = card.querySelector(`#btn-repeat-${s.id}`);
      if (repeatButton) {
        repeatButton.onclick = (e) => { e.stopPropagation(); repeatRouteFromHistory(s.id); };
      }
      card.querySelector(`#btn-export-csv-${s.id}`).onclick = (e) => {
        e.stopPropagation(); downloadSpecificHistoryCsv(s.id);
      };
      const fitButton = card.querySelector(`#btn-export-fit-${s.id}`);
      if (fitButton) {
        fitButton.onclick = (e) => { e.stopPropagation(); downloadSpecificHistoryFit(s.id); };
      }
      const renameButton = card.querySelector(`#btn-rename-${s.id}`);
      if (renameButton) {
        renameButton.onclick = (e) => { e.stopPropagation(); renameHistoryRoute(s.id); };
      }
      const compareButton = card.querySelector('.history-compare-session');
      if (compareButton) {
        compareButton.onclick = (event) => {
          event.stopPropagation();
          const sessionId = String(s.id);
          if (selectedComparisonIds.includes(sessionId)) {
            selectedComparisonIds =
              selectedComparisonIds.filter((id) => id !== sessionId);
          } else if (selectedComparisonIds.length >= 2) {
            showToast('Puedes comparar hasta dos sesiones a la vez.', 'info');
            return;
          } else {
            selectedComparisonIds.push(sessionId);
          }
          void loadHistoryList();
        };
      }
      card.onclick = () => openHistoricalSessionSummary(s.id, 'history');
      container.appendChild(card);
    });
  } catch (e) {
    console.error(e);
  }
}

async function renameHistoryRoute(id) {
  try {
    const session = await DbManager.getSessionById(id);
    if (!session || !session.gpxPath) return;
    const currentName = session.routeName || session.gpxPath;
    const newName = prompt('Nombre de la ruta:', currentName);
    if (newName === null) return;
    const routeName = newName.trim();
    if (!routeName) { showToast('El nombre de la ruta no puede estar vacío.', 'warning'); return; }
    await DbManager.updateSession({ ...session, routeName });
    await loadHistoryList();
  } catch (error) {
    console.error('Error renombrando la ruta histórica:', error);
    showToast('No se pudo cambiar el nombre de la ruta.', 'error');
  }
}

export async function deleteHistorySession(id) {
  const confirmDel = await showConfirm('¿Quieres eliminar permanentemente esta sesión de tu historial?');
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

export async function repeatRouteFromHistory(id) {
  try {
    const session = await DbManager.getSessionById(id);
    if (!session || !Array.isArray(session.routePoints) || session.routePoints.length === 0) {
      showToast('Esta sesión no contiene una copia reutilizable de la ruta.', 'info');
      return;
    }
    state.currentMode = 'ROUTE';
    state.gpxFilename = session.gpxPath || `Ruta histórica ${id}.gpx`;
    state.routeName = session.routeName || session.gpxPath || `Ruta histórica ${id}`;
    state.routePoints = session.routePoints.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }));
    state.routeElevations = Array.isArray(session.routeElevations)
      ? session.routeElevations.map(Number)
      : state.routePoints.map(() => 0);
    state.routeDistances = Array.isArray(session.routeDistances)
      ? session.routeDistances.map(Number)
      : [];
    state.routeTotalAscent = Number(session.routeTotalAscent) || 0;
    state.currentRouteIndex = 0;
    state.routeLoadedFromHistory = true;
    if (window._navigateTo) window._navigateTo('connections');
  } catch (error) {
    console.error('Error al repetir la ruta histórica:', error);
    showToast('No se pudo cargar la ruta seleccionada.', 'error');
  }
}

export async function openHistoricalSessionSummary(id, returnScreen = 'history') {
  try {
    const session = await DbManager.getSessionById(id);
    const telemetry = await DbManager.getSensorDataForSession(id);

    if (!session) { showToast('No se encontró la sesión seleccionada.', 'error'); return; }

    const totalDurationSeconds = session.endTime
      ? Math.max(0, (session.endTime - session.startTime) / 1000) : 0;
    const activeDurationSeconds = Number.isFinite(Number(session.activeDuration)) && Number(session.activeDuration) >= 0
      ? Number(session.activeDuration) : totalDurationSeconds;
    const duration = new Date(activeDurationSeconds * 1000).toISOString().substr(11, 8);
    const totalDuration = new Date(totalDurationSeconds * 1000).toISOString().substr(11, 8);

    const powers = telemetry.map((p) => Number(p.power) || 0);
    const speeds = telemetry.map((p) => Number(p.speed) || 0);
    const heartRates = telemetry.map((p) => Number(p.heartRate) || 0).filter((v) => v > 0);

    const avgPower = Number(session.averagePower) || 0;
    const maxPower = Number.isFinite(Number(session.maxPower)) ? Number(session.maxPower) : (powers.length > 0 ? Math.max(...powers) : 0);
    const avgHr = Number(session.averageHeartRate) || 0;
    const maxHr = Number.isFinite(Number(session.maxHeartRate)) ? Number(session.maxHeartRate) : (heartRates.length > 0 ? Math.max(...heartRates) : 0);
    const distance = Number(session.totalDistance) || 0;
    const avgSpeed = Number.isFinite(Number(session.averageSpeed)) ? Number(session.averageSpeed) : (activeDurationSeconds > 0 ? distance / (activeDurationSeconds / 3600) : 0);
    const maxSpeed = Number.isFinite(Number(session.maxSpeed)) ? Number(session.maxSpeed) : (speeds.length > 0 ? Math.max(...speeds) : 0);

    const ftp = state.currentUser ? state.currentUser.ftp : 200;
    const np = Number.isFinite(Number(session.normalizedPower))
      ? Number(session.normalizedPower)
      : Math.round(calculateNormalizedPowerFromValues(powers));
    const intensityFactor = Number.isFinite(Number(session.intensityFactor))
      ? Number(session.intensityFactor)
      : (ftp > 0 ? parseFloat((np / ftp).toFixed(2)) : 0);
    const tss = Number.isFinite(Number(session.tss))
      ? Number(session.tss)
      : (ftp > 0 ? Math.round((activeDurationSeconds * np * intensityFactor) / (ftp * 36)) : 0);

    const timeInPowerZones = [0, 0, 0, 0, 0, 0];
    const z = state.powerZones || [55, 75, 88, 95, 106];
    powers.forEach((power) => {
      const thresholds = z.map((v) => ftp * (v / 100));
      let zone = thresholds.findIndex((t) => power < t);
      if (zone === -1) zone = 5;
      timeInPowerZones[zone]++;
    });

    state.lastSavedSessionId = id;
    state.summaryReturnScreen = returnScreen;

    // Delegamos el render al app.js que tiene acceso a ChartsManager
    if (window._renderSummaryMetrics) {
      window._renderSummaryMetrics({
        duration, totalDuration, distance, np, tss, intensityFactor,
        calories: Number.isFinite(Number(session.calories)) ? Number(session.calories) : Math.round(avgPower * (activeDurationSeconds / 3600) * 3.6),
        kilojoules: Number.isFinite(Number(session.kilojoules)) ? Number(session.kilojoules) : Math.round(avgPower * (activeDurationSeconds / 1000)),
        avgPower, maxPower, avgSpeed, maxSpeed, avgHr, maxHr, timeInPowerZones,
      });
    }
    if (window._navigateTo) window._navigateTo('summary');
    if (window._renderSummaryRoute) window._renderSummaryRoute(session, distance);
  } catch (e) {
    console.error('Error loading historical session summary:', e);
    showToast('No se pudo abrir el resumen de la sesión.', 'error');
  }
}

export async function checkPendingSessions() {
  if (!state.currentUser) return;
  const sessions = await DbManager.getAllSessions(state.currentUser.id);
  const pending = sessions.find((s) => !s.endTime);
  if (pending) {
    if (await showConfirm(
      'Parece que tienes una sesión de entrenamiento incompleta. ¿Quieres recuperarla y guardarla?',
      'Recuperar sesión', 'primary'
    )) {
      pending.endTime = Date.now();
      await DbManager.updateSession(pending);
      showToast('Sesión recuperada con éxito.', 'success');
    } else {
      await DbManager.deleteSession(pending.id);
      await DbManager.deleteDataForSession(pending.id);
    }
  }
}

// ──────────────────────────────────────────────
// Descargas desde historial
// ──────────────────────────────────────────────

export async function downloadSpecificHistoryCsv(id) {
  try {
    const session = await DbManager.getSessionById(id);
    const data = await DbManager.getSensorDataForSession(id);
    if (!session || data.length === 0) { showToast('Esta sesión no posee datos de telemetría exportables.', 'warning'); return; }
    const userName = state.currentUser ? state.currentUser.name : 'Usuario';
    if (!GpxManager.exportSessionCsv(session, data, userName)) {
      showToast('No se pudo generar el archivo CSV de esta sesión.', 'error');
    }
  } catch (error) {
    console.error('Error exportando CSV histórico:', error);
    showToast('No se pudo exportar el CSV de esta sesión.', 'error');
  }
}

export async function downloadSpecificHistoryFit(id) {
  try {
    const session = await DbManager.getSessionById(id);
    const data = await DbManager.getSensorDataForSession(id);
    if (!session || data.length === 0) { showToast('Esta sesión no posee datos de telemetría exportables.', 'warning'); return; }
    const userName = state.currentUser ? state.currentUser.name : 'Usuario';
    if (!GpxManager.exportSessionFit(session, data, userName)) {
      showToast('No se pudo generar el archivo FIT de esta sesión.', 'error');
    }
  } catch (error) {
    console.error('Error exportando FIT histórico:', error);
    showToast('No se pudo exportar el FIT de esta sesión.', 'error');
  }
}

// ──────────────────────────────────────────────
// Estadísticas y Calendario de Entrenamiento
// ──────────────────────────────────────────────

function renderPeriodSummaryMetrics(container, sessions) {
  if (!container) return;
  const metrics = aggregateSessionMetrics(sessions);
  container.replaceChildren();
  [
    ['Sesiones', String(metrics.sessions)],
    ['Distancia', `${metrics.distance.toFixed(1)} km`],
    ['Tiempo activo', formatActiveDuration(metrics.duration)],
    ['Desnivel +', `${Math.round(metrics.ascent)} m`],
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'training-summary-metric';
    const strong = document.createElement('strong');
    strong.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    item.append(strong, span);
    container.append(item);
  });
}

function renderSelectedDaySessions(sessions) {
  const heading = document.getElementById('training-selected-day-heading');
  const container = document.getElementById('training-selected-day-sessions');
  if (!heading || !container) return;

  const [y, m, d] = selectedCalendarDate.split('-').map(Number);
  const selectedDateObj = new Date(y, m - 1, d);
  heading.textContent = `Sesiones del ${selectedDateObj.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })}`;

  const daySessions = sessions
    .filter((s) => formatDateKey(new Date(Number(s.startTime))) === selectedCalendarDate)
    .sort((a, b) => Number(a.startTime) - Number(b.startTime));

  container.replaceChildren();
  if (daySessions.length === 0) {
    const p = document.createElement('p');
    p.className = 'training-calendar-empty';
    p.textContent = 'No hay sesiones finalizadas en este día.';
    container.append(p);
    return;
  }

  daySessions.forEach((session) => {
    const article = document.createElement('article');
    article.className = 'training-day-session';
    article.style.cursor = 'pointer';
    article.setAttribute('role', 'button');
    article.setAttribute('tabindex', '0');
    article.title = 'Haz clic para ver el resumen de esta sesión';

    const details = document.createElement('div');
    details.className = 'training-day-session-details';
    const strong = document.createElement('strong');
    strong.textContent = session.routeName || (session.gpxPath ? 'Ruta' : 'Sesión manual');
    const timeSpan = document.createElement('span');
    timeSpan.textContent = new Date(Number(session.startTime)).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    details.append(strong, timeSpan);

    const metricsDiv = document.createElement('div');
    metricsDiv.className = 'training-day-session-metrics';
    [
      `${(Number(session.totalDistance) || 0).toFixed(2)} km`,
      formatActiveDuration(getSessionDurationSeconds(session)),
      `${Math.round(Number(session.totalAscent) || 0)} m+`,
    ].forEach((text) => {
      const sp = document.createElement('span');
      sp.textContent = text;
      metricsDiv.append(sp);
    });

    const actionSpan = document.createElement('span');
    actionSpan.style.color = 'var(--accent-green, #10b981)';
    actionSpan.style.fontWeight = '600';
    actionSpan.style.marginLeft = 'auto';
    actionSpan.textContent = 'Ver detalle →';
    metricsDiv.append(actionSpan);
    article.append(details, metricsDiv);

    const openSummary = () => openHistoricalSessionSummary(session.id, 'stats');
    article.addEventListener('click', openSummary);
    article.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSummary(); }
    });
    container.append(article);
  });
}

function renderTrainingCalendar() {
  const grid = document.getElementById('training-calendar-grid');
  const monthLabel = document.getElementById('training-calendar-month');
  if (!grid || !monthLabel) return;

  const year = calendarCurrentMonth.getFullYear();
  const month = calendarCurrentMonth.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const firstDayWeekdayOffset = (firstDayOfMonth.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - firstDayWeekdayOffset);
  const totalDaysToShow = Math.ceil((firstDayWeekdayOffset + lastDayOfMonth.getDate()) / 7) * 7;
  const completedSessions = getCompletedSessions(calendarSessions);

  const rawMonthName = firstDayOfMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  monthLabel.textContent = rawMonthName.charAt(0).toLocaleUpperCase('es-ES') + rawMonthName.slice(1);

  const monthSessions = completedSessions.filter((s) => {
    const d = new Date(Number(s.startTime));
    return d.getFullYear() === year && d.getMonth() === month;
  });
  renderPeriodSummaryMetrics(document.getElementById('training-month-summary'), monthSessions);

  const [y, m, d] = selectedCalendarDate.split('-').map(Number);
  const selectedDateObj = new Date(y, m - 1, d);
  const weekStart = getWeekStartMonday(selectedDateObj);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const weekSessions = completedSessions.filter((s) => {
    const startTime = Number(s.startTime);
    return startTime >= weekStart.getTime() && startTime <= weekEnd.getTime();
  });
  const weekHeading = document.getElementById('training-week-heading');
  if (weekHeading) {
    weekHeading.textContent = `Semana ${weekStart.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`;
  }
  renderPeriodSummaryMetrics(document.getElementById('training-week-summary'), weekSessions);

  grid.replaceChildren();
  ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach((weekday) => {
    const sp = document.createElement('span');
    sp.className = 'training-calendar-weekday';
    sp.setAttribute('aria-hidden', 'true');
    sp.textContent = weekday;
    grid.append(sp);
  });

  const todayKey = formatDateKey(new Date());
  for (let i = 0; i < totalDaysToShow; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateKey = formatDateKey(date);
    const daySessions = completedSessions.filter(
      (s) => formatDateKey(new Date(Number(s.startTime))) === dateKey
    );
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'training-calendar-day';
    btn.dataset.calendarDate = dateKey;
    btn.setAttribute('aria-pressed', String(dateKey === selectedCalendarDate));
    btn.setAttribute('aria-label', `${date.toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })}${daySessions.length ? `, ${daySessions.length} sesiones` : ''}`);

    if (date.getMonth() !== month) btn.classList.add('outside-month');
    if (dateKey === selectedCalendarDate) btn.classList.add('selected');
    if (dateKey === todayKey) btn.classList.add('today');

    const numSpan = document.createElement('span');
    numSpan.className = 'training-calendar-day-number';
    numSpan.textContent = String(date.getDate());
    btn.append(numSpan);

    if (daySessions.length > 0) {
      const actSpan = document.createElement('span');
      actSpan.className = 'training-calendar-day-activity';
      const totalKm = daySessions.reduce((acc, s) => acc + (Number(s.totalDistance) || 0), 0);
      actSpan.textContent = `${daySessions.length} ses. · ${totalKm.toFixed(0)} km`;
      btn.append(actSpan);
    }
    btn.addEventListener('click', () => selectTrainingCalendarDate(dateKey));
    grid.append(btn);
  }
  renderSelectedDaySessions(completedSessions);
}

export function changeTrainingCalendarMonth(delta) {
  const [y, m, d] = selectedCalendarDate.split('-').map(Number);
  const currentSelDate = new Date(y, m - 1, d);
  calendarCurrentMonth = new Date(calendarCurrentMonth.getFullYear(), calendarCurrentMonth.getMonth() + delta, 1);
  const maxDaysInNewMonth = new Date(calendarCurrentMonth.getFullYear(), calendarCurrentMonth.getMonth() + 1, 0).getDate();
  currentSelDate.setFullYear(calendarCurrentMonth.getFullYear(), calendarCurrentMonth.getMonth(), Math.min(currentSelDate.getDate(), maxDaysInNewMonth));
  selectedCalendarDate = formatDateKey(currentSelDate);
  renderTrainingCalendar();
}

export function selectTrainingCalendarDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  selectedCalendarDate = dateKey;
  calendarCurrentMonth = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
  renderTrainingCalendar();
}

export function goToTrainingCalendarToday() {
  selectTrainingCalendarDate(formatDateKey(new Date()));
}

export async function loadProgressStats() {
  if (!state.currentUser) return;
  try {
    const sessions = await DbManager.getAllSessions(state.currentUser.id);
    calendarSessions = sessions;
    renderTrainingCalendar();

    let totalDist = 0.0;
    let totalMillis = 0;
    let maxPowerVal = 0;

    for (const s of sessions) {
      totalDist += s.totalDistance;
      if (s.endTime) totalMillis += s.endTime - s.startTime;
      const data = await DbManager.getSensorDataForSession(s.id);
      const powers = data.map((d) => d.power || 0);
      if (powers.length > 0) {
        const localMax = Math.max(...powers);
        if (localMax > maxPowerVal) maxPowerVal = localMax;
      }
    }

    const totalHours = Math.floor(totalMillis / 3600000);
    const totalMinutes = Math.floor((totalMillis % 3600000) / 60000);
    document.getElementById('stats-total-sessions').textContent = sessions.length;
    document.getElementById('stats-total-distance').textContent = `${totalDist.toFixed(1)} km`;
    document.getElementById('stats-total-time').textContent = `${totalHours}h ${totalMinutes}m`;
    document.getElementById('stats-max-power').textContent = `${maxPowerVal} W`;
  } catch (e) {
    console.error(e);
  }
}

// Exponer descarga desde historial globalmente (acceso desde index.html onclick)
window.downloadSpecificHistoryCsv = downloadSpecificHistoryCsv;
window.downloadSpecificHistoryFit = downloadSpecificHistoryFit;
