/**
 * calendarView.js - Pantalla de Calendario y Estadísticas de Progreso para RodilloInt
 * Muestra el historial mensual, volumen semanal y métricas agrupadas por día.
 */

import { state } from "../modules/state.js";

let calendarCurrentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = formatDateKey(new Date());
let calendarSessions = [];

export function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getSessionDurationSeconds(session) {
  const activeDuration = Number(session.activeDuration);
  if (Number.isFinite(activeDuration) && activeDuration >= 0) {
    return activeDuration;
  }
  return Math.max(0, (Number(session.endTime) - Number(session.startTime)) / 1000);
}

export function getCompletedSessions(sessions) {
  return (sessions || []).filter((s) => {
    const startTime = Number(s.startTime);
    return Boolean(s.endTime) && Number.isFinite(startTime);
  });
}

export function aggregateSessionMetrics(sessions) {
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

export function formatActiveDuration(durationSeconds) {
  const totalMinutes = Math.floor(Math.max(0, durationSeconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export function renderPeriodSummaryMetrics(container, sessions) {
  if (!container) return;
  const metrics = aggregateSessionMetrics(sessions);
  container.replaceChildren();
  [
    ["Sesiones", String(metrics.sessions)],
    ["Distancia", `${metrics.distance.toFixed(1)} km`],
    ["Tiempo activo", formatActiveDuration(metrics.duration)],
    ["Desnivel +", `${Math.round(metrics.ascent)} m`],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "training-summary-metric";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    item.append(strong, span);
    container.append(item);
  });
}

export function getWeekStartMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

export function renderSelectedDaySessions(sessions) {
  const heading = document.getElementById("training-selected-day-heading");
  const container = document.getElementById("training-selected-day-sessions");
  if (!heading || !container) return;

  const [y, m, d] = selectedCalendarDate.split("-").map(Number);
  const selectedDateObj = new Date(y, m - 1, d);
  heading.textContent = `Sesiones del ${selectedDateObj.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;

  const daySessions = sessions
    .filter((s) => formatDateKey(new Date(Number(s.startTime))) === selectedCalendarDate)
    .sort((a, b) => Number(a.startTime) - Number(b.startTime));

  container.replaceChildren();
  if (daySessions.length === 0) {
    const p = document.createElement("p");
    p.className = "training-calendar-empty";
    p.textContent = "No hay sesiones finalizadas en este día.";
    container.append(p);
    return;
  }

  daySessions.forEach((session) => {
    const article = document.createElement("article");
    article.className = "training-day-session";
    article.style.cursor = "pointer";
    article.setAttribute("role", "button");
    article.setAttribute("tabindex", "0");
    article.title = "Haz clic para ver el resumen de esta sesión";

    const details = document.createElement("div");
    details.className = "training-day-session-details";
    const strong = document.createElement("strong");
    strong.textContent = session.routeName || (session.gpxPath ? "Ruta" : "Sesión manual");
    const timeSpan = document.createElement("span");
    timeSpan.textContent = new Date(Number(session.startTime)).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    details.append(strong, timeSpan);

    const metricsDiv = document.createElement("div");
    metricsDiv.className = "training-day-session-metrics";
    [
      `${(Number(session.totalDistance) || 0).toFixed(2)} km`,
      formatActiveDuration(getSessionDurationSeconds(session)),
      `${Math.round(Number(session.totalAscent) || 0)} m+`,
    ].forEach((text) => {
      const sp = document.createElement("span");
      sp.textContent = text;
      metricsDiv.append(sp);
    });

    const actionSpan = document.createElement("span");
    actionSpan.style.color = "var(--accent-green, #10b981)";
    actionSpan.style.fontWeight = "600";
    actionSpan.style.marginLeft = "auto";
    actionSpan.textContent = "Ver detalle →";
    metricsDiv.append(actionSpan);

    article.append(details, metricsDiv);

    const openSummary = () => {
      if (typeof window.openHistoricalSessionSummary === "function") {
        window.openHistoricalSessionSummary(session.id, "stats");
      }
    };

    article.addEventListener("click", openSummary);
    article.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openSummary();
      }
    });

    container.append(article);
  });
}

export function renderTrainingCalendar() {
  const grid = document.getElementById("training-calendar-grid");
  const monthLabel = document.getElementById("training-calendar-month");
  if (!grid || !monthLabel) return;

  const year = calendarCurrentMonth.getFullYear();
  const month = calendarCurrentMonth.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  const firstDayWeekdayOffset = (firstDayOfMonth.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - firstDayWeekdayOffset);
  const totalDaysToShow = Math.ceil((firstDayWeekdayOffset + lastDayOfMonth.getDate()) / 7) * 7;
  const completedSessions = getCompletedSessions(calendarSessions);

  const rawMonthName = firstDayOfMonth.toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  monthLabel.textContent =
    rawMonthName.charAt(0).toLocaleUpperCase("es-ES") + rawMonthName.slice(1);

  // Resumen del mes mostrado
  const monthSessions = completedSessions.filter((s) => {
    const d = new Date(Number(s.startTime));
    return d.getFullYear() === year && d.getMonth() === month;
  });
  renderPeriodSummaryMetrics(
    document.getElementById("training-month-summary"),
    monthSessions
  );

  // Resumen de la semana de la fecha seleccionada
  const [y, m, d] = selectedCalendarDate.split("-").map(Number);
  const selectedDateObj = new Date(y, m - 1, d);
  const weekStart = getWeekStartMonday(selectedDateObj);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const weekSessions = completedSessions.filter((s) => {
    const startTime = Number(s.startTime);
    return startTime >= weekStart.getTime() && startTime <= weekEnd.getTime();
  });

  const weekHeading = document.getElementById("training-week-heading");
  if (weekHeading) {
    weekHeading.textContent = `Semana ${weekStart.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
    })} – ${weekEnd.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
    })}`;
  }
  renderPeriodSummaryMetrics(
    document.getElementById("training-week-summary"),
    weekSessions
  );

  // Cuadrícula de días
  grid.replaceChildren();
  ["L", "M", "X", "J", "V", "S", "D"].forEach((weekday) => {
    const sp = document.createElement("span");
    sp.className = "training-calendar-weekday";
    sp.setAttribute("aria-hidden", "true");
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

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "training-calendar-day";
    btn.dataset.calendarDate = dateKey;
    btn.setAttribute("aria-pressed", String(dateKey === selectedCalendarDate));
    btn.setAttribute(
      "aria-label",
      `${date.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })}${daySessions.length ? `, ${daySessions.length} sesiones` : ""}`
    );

    if (date.getMonth() !== month) btn.classList.add("outside-month");
    if (dateKey === selectedCalendarDate) btn.classList.add("selected");
    if (dateKey === todayKey) btn.classList.add("today");

    const numSpan = document.createElement("span");
    numSpan.className = "training-calendar-day-number";
    numSpan.textContent = String(date.getDate());
    btn.append(numSpan);

    if (daySessions.length > 0) {
      const actSpan = document.createElement("span");
      actSpan.className = "training-calendar-day-activity";
      const totalKm = daySessions.reduce(
        (acc, s) => acc + (Number(s.totalDistance) || 0),
        0
      );
      actSpan.textContent = `${daySessions.length} ses. · ${totalKm.toFixed(0)} km`;
      btn.append(actSpan);
    }

    btn.addEventListener("click", () => selectTrainingCalendarDate(dateKey));
    grid.append(btn);
  }

  renderSelectedDaySessions(completedSessions);
}

export function changeTrainingCalendarMonth(delta) {
  const [y, m, d] = selectedCalendarDate.split("-").map(Number);
  const currentSelDate = new Date(y, m - 1, d);
  calendarCurrentMonth = new Date(
    calendarCurrentMonth.getFullYear(),
    calendarCurrentMonth.getMonth() + delta,
    1
  );
  const maxDaysInNewMonth = new Date(
    calendarCurrentMonth.getFullYear(),
    calendarCurrentMonth.getMonth() + 1,
    0
  ).getDate();
  currentSelDate.setFullYear(
    calendarCurrentMonth.getFullYear(),
    calendarCurrentMonth.getMonth(),
    Math.min(currentSelDate.getDate(), maxDaysInNewMonth)
  );
  selectedCalendarDate = formatDateKey(currentSelDate);
  renderTrainingCalendar();
}

export function selectTrainingCalendarDate(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
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

    let totalSessions = sessions.length;
    let totalDist = 0.0;
    let totalMillis = 0;
    let maxPowerVal = 0;

    for (const s of sessions) {
      totalDist += Number(s.totalDistance) || 0;
      if (s.endTime) {
        totalMillis += s.endTime - s.startTime;
      }

      // Query sensor max power
      const data = await DbManager.getSensorDataForSession(s.id);
      const powers = data.map((d) => d.power || 0);
      if (powers.length > 0) {
        let localMax = 0;
        for (let i = 0; i < powers.length; i++) {
          if (powers[i] > localMax) localMax = powers[i];
        }
        if (localMax > maxPowerVal) maxPowerVal = localMax;
      }
    }

    // Format times
    const totalHours = Math.floor(totalMillis / 3600000);
    const totalMinutes = Math.floor((totalMillis % 3600000) / 60000);

    const sCountEl = document.getElementById("stats-total-sessions");
    if (sCountEl) sCountEl.textContent = totalSessions;
    const sDistEl = document.getElementById("stats-total-distance");
    if (sDistEl) sDistEl.textContent = `${totalDist.toFixed(1)} km`;
    const sTimeEl = document.getElementById("stats-total-time");
    if (sTimeEl) sTimeEl.textContent = `${totalHours}h ${totalMinutes}m`;
    const sPowerEl = document.getElementById("stats-max-power");
    if (sPowerEl) sPowerEl.textContent = `${maxPowerVal} W`;
  } catch (e) {
    console.error("Error cargando estadísticas de progreso:", e);
  }
}
