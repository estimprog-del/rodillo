// js/ui/routeOverviewSvg.js - Vista general SVG de la ruta y perfil predictivo
import { state } from "../modules/state.js";

export const SLOPE_AVERAGE_METERS = 10;
export const SLOPE_PREVIEW_LONG_METERS = 500;

/**
 * Variables de escala calculadas una vez al iniciar la ruta.
 * Reutilizadas en cada actualización de posición.
 */
let _overviewScale = null;

/**
 * Dibuja la traza completa de la ruta en el SVG de vista general.
 * Llamar al inicio de la sesión en modo ROUTE.
 */
export function initRouteOverviewSvg() {
  const svg = document.getElementById("route-overview-svg");
  const trackPath = document.getElementById("route-overview-track");
  const completedPath = document.getElementById("route-overview-completed");
  const startCircle = document.getElementById("route-overview-start");
  const endCircle = document.getElementById("route-overview-end");
  const posCircle = document.getElementById("route-overview-position");

  if (!svg || !trackPath || !posCircle) return;
  if (!state.routePoints || state.routePoints.length < 2) return;

  const points = state.routePoints;
  const W = 100, H = 100, pad = 7;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const rangeW = (maxLon - minLon) || 1e-9;
  const rangeH = (maxLat - minLat) || 1e-9;
  const scale = Math.min((W - pad * 2) / rangeW, (H - pad * 2) / rangeH);
  const offX = pad + ((W - pad * 2) - rangeW * scale) / 2;
  const offY = pad + ((H - pad * 2) - rangeH * scale) / 2;

  // Guardamos la escala para actualizar la posición eficientemente
  _overviewScale = { minLat, minLon, scale, offX, offY, H };

  function toX(lon) { return offX + (lon - minLon) * scale; }
  function toY(lat) { return H - offY - (lat - minLat) * scale; }

  // Sample points (max 400 for performance)
  const step = Math.max(1, Math.floor(points.length / 400));
  const pathParts = [];
  for (let i = 0; i < points.length; i += step) {
    pathParts.push((i === 0 ? "M" : "L") + toX(points[i].lon).toFixed(2) + "," + toY(points[i].lat).toFixed(2));
  }
  const d = pathParts.join(" ");

  trackPath.setAttribute("d", d);
  if (completedPath) completedPath.setAttribute("d", "");

  // Inicio (verde) y fin (rojo)
  const p0 = points[0], pN = points[points.length - 1];
  if (startCircle) {
    startCircle.setAttribute("cx", toX(p0.lon).toFixed(2));
    startCircle.setAttribute("cy", toY(p0.lat).toFixed(2));
  }
  if (endCircle) {
    endCircle.setAttribute("cx", toX(pN.lon).toFixed(2));
    endCircle.setAttribute("cy", toY(pN.lat).toFixed(2));
  }

  // Posición inicial al inicio
  posCircle.setAttribute("cx", toX(p0.lon).toFixed(2));
  posCircle.setAttribute("cy", toY(p0.lat).toFixed(2));
}

/**
 * Actualiza la posición actual del ciclista y el tramo completado en el SVG.
 * Llamar en cada tick del loop de sesión.
 * @param {number} currentIndex  Índice actual en state.routePoints
 */
export function updateRouteOverviewPosition(currentIndex) {
  if (!_overviewScale || !state.routePoints || state.routePoints.length === 0) return;

  const posCircle = document.getElementById("route-overview-position");
  const completedPath = document.getElementById("route-overview-completed");
  if (!posCircle) return;

  const { minLat, minLon, scale, offX, offY, H } = _overviewScale;
  function toX(lon) { return offX + (lon - minLon) * scale; }
  function toY(lat) { return H - offY - (lat - minLat) * scale; }

  const idx = Math.max(0, Math.min(currentIndex, state.routePoints.length - 1));
  const pt = state.routePoints[idx];
  posCircle.setAttribute("cx", toX(pt.lon).toFixed(2));
  posCircle.setAttribute("cy", toY(pt.lat).toFixed(2));

  // Tramo completado (trazo verde hasta la posición actual)
  if (completedPath && idx > 0) {
    const step = Math.max(1, Math.floor(state.routePoints.length / 400));
    const parts = [];
    for (let i = 0; i <= idx; i += step) {
      parts.push((i === 0 ? "M" : "L") + toX(state.routePoints[i].lon).toFixed(2) + "," + toY(state.routePoints[i].lat).toFixed(2));
    }
    // Asegurar que el último punto es exactamente la posición actual
    if (parts.length > 0) {
      parts.push("L" + toX(pt.lon).toFixed(2) + "," + toY(pt.lat).toFixed(2));
    }
    completedPath.setAttribute("d", parts.join(" "));
  }
}

/**
 * Calcula el desnivel positivo acumulado total de la ruta actual
 */
export function calculateTotalRouteAscent() {
  if (!state.routeElevations || state.routeElevations.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < state.routeElevations.length; i++) {
    const diff = state.routeElevations[i] - state.routeElevations[i - 1];
    if (diff > 0) total += diff;
  }
  return total;
}

/**
 * Interpola la elevación en una distancia dada (km) a lo largo de la ruta
 */
export function getElevationAtDistance(distKm) {
  if (!state.routeElevations || state.routeElevations.length === 0) return 0;
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

/**
 * Obtiene los datos del próximo segmento de la ruta para previsualización
 */
export function getUpcomingSegmentData(
  previewDistanceMeters = SLOPE_PREVIEW_LONG_METERS,
  currentDistKm = null,
) {
  if (!state.routePoints || state.routePoints.length === 0) return null;

  const currentDistanceKm =
    currentDistKm !== null
      ? currentDistKm
      : state.routeDistances[state.currentRouteIndex];

  const targetDistanceKm = currentDistanceKm + previewDistanceMeters / 1000.0;
  const routeEndKm = state.routeDistances[state.routeDistances.length - 1];
  const actualEndKm = Math.min(targetDistanceKm, routeEndKm);

  const previewDistances = [];
  const previewElevations = [];

  for (let i = 0; i < state.routeDistances.length; i++) {
    if (state.routeDistances[i] < currentDistanceKm) continue;

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

/**
 * Aplica el estilo y flecha a los indicadores de pendiente
 */
export function applySlopeTrendStyle(slope, slopeLabel, arrowLabel) {
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

/**
 * Refresca la gráfica predictiva y etiqueta de los próximos 500m
 */
export function refreshUpcomingPreview(currentDistKm = null) {
  const distKm =
    currentDistKm !== null
      ? currentDistKm
      : state.routeDistances[state.currentRouteIndex] || 0;

  const preview = getUpcomingSegmentData(SLOPE_PREVIEW_LONG_METERS, distKm);
  if (!preview) return;

  const slope = preview.avgSlope;
  const upcomingSlopeLabel = document.getElementById("upcoming-slope-label");
  if (upcomingSlopeLabel) {
    upcomingSlopeLabel.textContent =
      `⛰️ ${slope >= 0 ? "+" : ""}${slope.toFixed(1)}%`;
  }

  const chartsManager = window.ChartsManager;
  if (chartsManager && typeof chartsManager.updateUpcomingChart === "function") {
    chartsManager.updateUpcomingChart(
      preview.distances,
      preview.elevations,
      slope,
    );
  }
}
