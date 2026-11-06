import { showModal, hideModal } from "../modules/ui.js";
import { state, saveStateToLocalStorage } from "../modules/state.js";
import { showToast } from "../modules/toast.js";
import { resetAddUserAvatar, prepareEditUserAvatar } from "./userView.js";
import { sliceRouteSegment } from "../core/routeLibrary.js";

/**
 * UI Modal Manager
 * Encapsulates showing and hiding application modals
 */

export function openAddUserModal() {
  resetAddUserAvatar();
  showModal("add-user");
}

export function closeAddUserModal() {
  hideModal("add-user");
}

export function openImportUserModal() {
  showModal("import-user");
}

export function closeImportUserModal() {
  hideModal("import-user");
}

export function openEditUserModal() {
  prepareEditUserAvatar();
  showModal("edit-user");
}

export function closeEditUserModal() {
  hideModal("edit-user");
}

/**
 * Gráfico interactivo de altimetría con selector de rango (dual-slider visual)
 */
function initInteractiveSegmentChart(distances, elevations, totalKm, onRangeChange) {
  const container = document.getElementById("route-segment-svg-container");
  const hoverLabel = document.getElementById("route-segment-chart-hover");
  if (!container || !distances || distances.length < 2) return null;

  const W = 380, H = 85;
  const padL = 12, padR = 12, padT = 8, padB = 18;
  const drawW = W - padL - padR;
  const drawH = H - padT - padB;

  const minE = Math.min(...elevations);
  const maxE = Math.max(...elevations);
  const rangeE = (maxE - minE) || 1;
  const maxD = totalKm || distances[distances.length - 1] || 1;

  // Submuestreo uniforme de puntos para SVG fluido
  const step = Math.max(1, Math.floor(distances.length / 150));
  const pts = [];
  for (let i = 0; i < distances.length; i += step) {
    const x = padL + (distances[i] / maxD) * drawW;
    const y = (padT + drawH) - ((elevations[i] - minE) / rangeE) * drawH;
    pts.push({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), km: distances[i], ele: elevations[i] });
  }
  const lastD = distances[distances.length - 1];
  const lastE = elevations[elevations.length - 1];
  pts.push({
    x: padL + drawW,
    y: (padT + drawH) - ((lastE - minE) / rangeE) * drawH,
    km: lastD,
    ele: lastE,
  });

  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const firstX = pts[0].x;
  const lastX = pts[pts.length - 1].x;
  const bottomY = padT + drawH;
  const areaD = `${lineD} L${lastX},${bottomY} L${firstX},${bottomY} Z`;

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" style="overflow: visible;">
      <defs>
        <linearGradient id="seg-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.32" />
          <stop offset="100%" stop-color="#10b981" stop-opacity="0.04" />
        </linearGradient>
        <linearGradient id="seg-sel-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.4" />
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.08" />
        </linearGradient>
      </defs>
      <!-- Perfil base de la ruta completa -->
      <path d="${areaD}" fill="url(#seg-grad)" />
      <path d="${lineD}" fill="none" stroke="rgba(16, 185, 129, 0.45)" stroke-width="1.5" />

      <!-- Ventana de selección activa -->
      <rect id="seg-sel-rect" x="${padL}" y="${padT}" width="${drawW}" height="${drawH}" fill="url(#seg-sel-grad)" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="3,3" />

      <!-- Guía de cursor hover -->
      <line id="seg-hover-line" x1="0" y1="${padT}" x2="0" y2="${bottomY}" stroke="rgba(255, 255, 255, 0.55)" stroke-width="1" stroke-dasharray="2,2" style="display:none;" />

      <!-- Marcador Inicio -->
      <g id="seg-handle-start" class="route-segment-handle-start" style="cursor: ew-resize;">
        <line id="seg-line-start" x1="${padL}" y1="${padT}" x2="${padL}" y2="${bottomY}" stroke="#38bdf8" stroke-width="2.2" />
        <circle id="seg-circle-start" cx="${padL}" cy="${padT + 5}" r="5.5" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5" />
        <text id="seg-text-start" x="${padL}" y="${H - 3}" text-anchor="middle" fill="#38bdf8" font-size="9" font-weight="700">0.0k</text>
      </g>

      <!-- Marcador Fin -->
      <g id="seg-handle-end" class="route-segment-handle-end" style="cursor: ew-resize;">
        <line id="seg-line-end" x1="${lastX}" y1="${padT}" x2="${lastX}" y2="${bottomY}" stroke="#34d399" stroke-width="2.2" />
        <circle id="seg-circle-end" cx="${lastX}" cy="${padT + 5}" r="5.5" fill="#34d399" stroke="#ffffff" stroke-width="1.5" />
        <text id="seg-text-end" x="${lastX}" y="${H - 3}" text-anchor="middle" fill="#34d399" font-size="9" font-weight="700">${totalKm.toFixed(1)}k</text>
      </g>
    </svg>
  `;

  const selRect = container.querySelector("#seg-sel-rect");
  const lineStart = container.querySelector("#seg-line-start");
  const circleStart = container.querySelector("#seg-circle-start");
  const textStart = container.querySelector("#seg-text-start");
  const lineEnd = container.querySelector("#seg-line-end");
  const circleEnd = container.querySelector("#seg-circle-end");
  const textEnd = container.querySelector("#seg-text-end");
  const hoverLine = container.querySelector("#seg-hover-line");

  function kmToX(km) {
    const ratio = Math.max(0, Math.min(1, km / maxD));
    return padL + ratio * drawW;
  }

  function xToKm(pixelX) {
    const rect = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (pixelX - rect.left - (padL / W) * rect.width) / ((drawW / W) * rect.width)));
    return ratio * maxD;
  }

  function getElevationAt(km) {
    if (km <= distances[0]) return Math.round(elevations[0]);
    if (km >= distances[distances.length - 1]) return Math.round(elevations[elevations.length - 1]);
    const idx = distances.findIndex((d) => d >= km);
    if (idx <= 0) return Math.round(elevations[0]);
    const d0 = distances[idx - 1], d1 = distances[idx];
    const e0 = elevations[idx - 1], e1 = elevations[idx];
    const span = d1 - d0;
    if (span < 1e-6) return Math.round(e0);
    return Math.round(e0 + ((km - d0) / span) * (e1 - e0));
  }

  function updateHandles(sKm, eKm) {
    const xs = kmToX(sKm);
    const xe = kmToX(eKm);
    const xMin = Math.min(xs, xe);
    const w = Math.max(2, Math.abs(xe - xs));

    if (selRect) {
      selRect.setAttribute("x", xMin.toFixed(1));
      selRect.setAttribute("width", w.toFixed(1));
    }
    if (lineStart) {
      lineStart.setAttribute("x1", xs.toFixed(1));
      lineStart.setAttribute("x2", xs.toFixed(1));
    }
    if (circleStart) {
      circleStart.setAttribute("cx", xs.toFixed(1));
    }
    if (textStart) {
      textStart.setAttribute("x", xs.toFixed(1));
      textStart.textContent = `${sKm.toFixed(1)}k`;
    }
    if (lineEnd) {
      lineEnd.setAttribute("x1", xe.toFixed(1));
      lineEnd.setAttribute("x2", xe.toFixed(1));
    }
    if (circleEnd) {
      circleEnd.setAttribute("cx", xe.toFixed(1));
    }
    if (textEnd) {
      textEnd.setAttribute("x", xe.toFixed(1));
      textEnd.textContent = `${eKm.toFixed(1)}k`;
    }
  }

  // Interacción pointer (ratón y táctil)
  let isDragging = false;
  let dragMode = null; // 'start' | 'end' | 'range'
  let anchorKm = 0;

  function onPointerDown(e) {
    container.setPointerCapture(e.pointerId);
    isDragging = true;
    const clickedKm = xToKm(e.clientX);
    const startInput = document.getElementById("route-segment-start");
    const endInput = document.getElementById("route-segment-end");
    const currentStart = parseFloat(startInput?.value) || 0;
    const currentEnd = parseFloat(endInput?.value) || maxD;

    const xs = kmToX(currentStart);
    const xe = kmToX(currentEnd);
    const rect = container.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * W;

    // Detectar si se pulsa cerca de los tiradores
    if (Math.abs(clickX - xs) <= 18) {
      dragMode = "start";
    } else if (Math.abs(clickX - xe) <= 18) {
      dragMode = "end";
    } else {
      dragMode = "range";
      anchorKm = clickedKm;
      onRangeChange(clickedKm, clickedKm);
    }
  }

  function onPointerMove(e) {
    const currentKm = xToKm(e.clientX);
    const elev = getElevationAt(currentKm);
    if (hoverLabel) {
      hoverLabel.textContent = `Km ${currentKm.toFixed(1)} • ${elev} m`;
    }
    if (hoverLine) {
      const hx = kmToX(currentKm);
      hoverLine.setAttribute("x1", hx.toFixed(1));
      hoverLine.setAttribute("x2", hx.toFixed(1));
      hoverLine.style.display = "block";
    }

    if (!isDragging) return;

    const startInput = document.getElementById("route-segment-start");
    const endInput = document.getElementById("route-segment-end");
    let currentStart = parseFloat(startInput?.value) || 0;
    let currentEnd = parseFloat(endInput?.value) || maxD;

    if (dragMode === "start") {
      currentStart = Math.max(0, Math.min(currentKm, currentEnd - 0.2));
      onRangeChange(currentStart, currentEnd);
    } else if (dragMode === "end") {
      currentEnd = Math.max(currentStart + 0.2, Math.min(currentKm, maxD));
      onRangeChange(currentStart, currentEnd);
    } else if (dragMode === "range") {
      const s = Math.max(0, Math.min(anchorKm, currentKm));
      const end = Math.min(maxD, Math.max(anchorKm, currentKm));
      onRangeChange(s, Math.max(s + 0.2, end));
    }
  }

  function onPointerUp(e) {
    if (isDragging) {
      try { container.releasePointerCapture(e.pointerId); } catch (_) {}
      isDragging = false;
      dragMode = null;
    }
  }

  function onPointerLeave() {
    if (!isDragging && hoverLine) {
      hoverLine.style.display = "none";
    }
  }

  container.onpointerdown = onPointerDown;
  container.onpointermove = onPointerMove;
  container.onpointerup = onPointerUp;
  container.onpointercancel = onPointerUp;
  container.onpointerleave = onPointerLeave;

  return { updateHandles };
}

export function updateRouteSegmentControls() {
  const section = document.getElementById("route-segment-section");
  const startInput = document.getElementById("route-segment-start");
  const endInput = document.getElementById("route-segment-end");
  const origDistEl = document.getElementById("route-segment-orig-dist");
  const origElevEl = document.getElementById("route-segment-orig-elev");
  const summaryEl = document.getElementById("route-segment-summary");

  if (!section) return;

  const points = state.originalRoute?.points || state.routePoints;
  const distances = state.originalRoute?.distances || state.routeDistances;
  const elevations = state.originalRoute?.elevations || state.routeElevations;

  if (!points || !distances || distances.length < 2) {
    section.style.display = "none";
    return;
  }

  // Ensure originalRoute is cached
  if (!state.originalRoute || state.originalRoute.points !== points) {
    state.originalRoute = {
      points: [...points],
      elevations: [...elevations],
      distances: [...distances],
      name: state.routeName || "Ruta",
    };
  }

  const totalKm = distances.length > 0 ? distances[distances.length - 1] : 0;
  let totalAscent = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) totalAscent += diff;
  }

  section.style.display = "block";
  if (origDistEl) origDistEl.textContent = `${totalKm.toFixed(1)} km`;
  if (origElevEl) origElevEl.textContent = `+${Math.round(totalAscent)} m`;

  if (startInput) {
    startInput.min = "0";
    startInput.max = Math.max(0, totalKm - 0.2).toFixed(1);
    startInput.value = "0";
  }

  if (endInput) {
    endInput.min = "0.2";
    endInput.max = totalKm.toFixed(1);
    endInput.value = totalKm.toFixed(1);
  }

  let chartController = initInteractiveSegmentChart(
    state.originalRoute.distances,
    state.originalRoute.elevations,
    totalKm,
    (newStart, newEnd) => {
      if (startInput) startInput.value = newStart.toFixed(1);
      if (endInput) endInput.value = newEnd.toFixed(1);
      updateSummary(true);
    }
  );

  const updateSummary = (syncChart = true) => {
    const sKm = Math.max(0, Math.min(parseFloat(startInput?.value) || 0, totalKm));
    const eKm = Math.max(sKm + 0.1, Math.min(parseFloat(endInput?.value) || totalKm, totalKm));
    const preview = sliceRouteSegment({
      points: state.originalRoute.points,
      elevations: state.originalRoute.elevations,
      distances: state.originalRoute.distances,
      startKm: sKm,
      endKm: eKm,
    });

    if (syncChart && chartController) {
      chartController.updateHandles(sKm, eKm);
    }

    if (summaryEl && preview) {
      const isFull = sKm <= 0.05 && eKm >= totalKm - 0.05;
      summaryEl.textContent = isFull
        ? `Ruta completa: ${preview.segmentDistance.toFixed(1)} km • +${Math.round(preview.totalAscent)} m`
        : `Tramo: ${preview.segmentDistance.toFixed(1)} km (Km ${preview.startKm.toFixed(1)} → ${preview.endKm.toFixed(1)}) • +${Math.round(preview.totalAscent)} m`;
    }
  };

  updateSummary(true);

  if (startInput) startInput.oninput = () => updateSummary(true);
  if (endInput) endInput.oninput = () => updateSummary(true);

  const warmupToggle = document.getElementById("route-warmup-toggle");
  if (warmupToggle) warmupToggle.checked = Boolean(state.routeWarmupEnabled);

  const resetBtn = document.getElementById("btn-route-segment-reset");
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (startInput) startInput.value = "0";
      if (endInput) endInput.value = totalKm.toFixed(1);
      if (warmupToggle) warmupToggle.checked = false;
      state.routeWarmupEnabled = false;
      updateSummary(true);
    };
  }
}

export function applyRouteSegmentSelection() {
  if (!state.originalRoute || !state.originalRoute.points || state.originalRoute.points.length < 2) {
    if (state.routePoints && state.routePoints.length >= 2) {
      state.originalRoute = {
        points: [...state.routePoints],
        elevations: [...state.routeElevations],
        distances: [...state.routeDistances],
        name: state.routeName || "Ruta",
      };
    } else {
      return;
    }
  }
  const startInput = document.getElementById("route-segment-start");
  const endInput = document.getElementById("route-segment-end");
  if (!startInput || !endInput) return;

  const warmupToggle = document.getElementById("route-warmup-toggle");
  state.routeWarmupEnabled = Boolean(warmupToggle?.checked);

  const { points, elevations, distances, name } = state.originalRoute;
  const totalKm = distances.length > 0 ? distances[distances.length - 1] : 0;
  const sKm = Math.max(0, parseFloat(startInput.value) || 0);
  const eKm = Math.max(sKm + 0.1, parseFloat(endInput.value) || totalKm);

  // If user selected a sub-segment (not the full route)
  if (sKm > 0.05 || eKm < totalKm - 0.05) {
    const segment = sliceRouteSegment({
      points,
      elevations,
      distances,
      startKm: sKm,
      endKm: eKm,
    });
    if (segment && segment.points.length >= 2) {
      state.routePoints = segment.points;
      state.routeElevations = segment.elevations;
      state.routeDistances = segment.distances;
      state.routeTotalAscent = segment.totalAscent;
      state.routeName = `${name} (Km ${segment.startKm.toFixed(1)} → ${segment.endKm.toFixed(1)})`;
      state.currentRouteIndex = 0;
      state.routeSegmentOffsetKm = segment.startKm;
      state.routeOriginalTotalKm = segment.originalTotalKm;
      showToast(`Tramo activado: ${segment.segmentDistance.toFixed(1)} km (+${Math.round(segment.totalAscent)} m)`, "info");
    }
  } else {
    // Full route
    state.routePoints = points;
    state.routeElevations = elevations;
    state.routeDistances = distances;
    let totalAscent = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) totalAscent += diff;
    }
    state.routeTotalAscent = totalAscent;
    state.routeName = name;
    state.currentRouteIndex = 0;
    state.routeSegmentOffsetKm = 0;
    state.routeOriginalTotalKm = null;
  }
}

export function openRouteModal() {
  const routeModal = document.getElementById("route-modal");
  if (routeModal) {
    routeModal.classList.add("active");
    updateRouteSegmentControls();

    const realismSlider = document.getElementById("realism-slider");
    const realismValueSpan = document.getElementById("realism-value");

    if (realismSlider && realismValueSpan) {
      realismSlider.value = Math.round(state.realismFactor * 100); // Guardado como 0.3-1.5, mostrado como 30-150%
      realismValueSpan.textContent = `${realismSlider.value}%`;

      realismSlider.oninput = (e) => {
        const value = e.target.value;
        realismValueSpan.textContent = `${value}%`;
        state.realismFactor = parseFloat(value) / 100;
        saveStateToLocalStorage();
      };
    }
  }
}

export function closeRouteModal() {
  const routeModal = document.getElementById("route-modal");
  if (routeModal) routeModal.classList.remove("active");
}

export function promptResumeRoute({ routeName, completedKm, totalRouteKm }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-resume-route");
    const titleEl = document.getElementById("resume-route-title");
    const descEl = document.getElementById("resume-route-desc");
    const continueBtn = document.getElementById("btn-resume-route-continue");
    const restartBtn = document.getElementById("btn-resume-route-restart");
    const cancelBtn = document.getElementById("btn-resume-route-cancel");

    if (!modal) {
      resolve("restart");
      return;
    }

    const pct = totalRouteKm > 0 ? Math.round((completedKm / totalRouteKm) * 100) : 0;
    if (titleEl) titleEl.textContent = `Ruta Inconclusa: ${routeName}`;
    if (descEl) {
      descEl.innerHTML = `En tu sesión anterior recorriste <strong>${completedKm.toFixed(1)} km</strong> de los <strong>${totalRouteKm.toFixed(1)} km</strong> totales (<strong>${pct}%</strong>).<br>¿Cómo quieres entrenar hoy?`;
    }
    if (continueBtn) {
      continueBtn.textContent = `⏩ Continuar desde el Km ${completedKm.toFixed(1)}`;
    }

    const cleanup = () => {
      hideModal("resume-route");
      continueBtn?.removeEventListener("click", onContinue);
      restartBtn?.removeEventListener("click", onRestart);
      cancelBtn?.removeEventListener("click", onCancel);
    };

    const onContinue = () => {
      const warmupCb = document.getElementById("resume-route-warmup");
      state.routeWarmupEnabled = Boolean(warmupCb?.checked);
      cleanup();
      resolve("continue");
    };
    const onRestart = () => {
      state.routeWarmupEnabled = false;
      cleanup();
      resolve("restart");
    };
    const onCancel = () => {
      cleanup();
      resolve("cancel");
    };

    continueBtn?.addEventListener("click", onContinue);
    restartBtn?.addEventListener("click", onRestart);
    cancelBtn?.addEventListener("click", onCancel);

    showModal("resume-route");
  });
}

// Global bridges
if (typeof window !== "undefined") {
  window.openRouteModal = openRouteModal;
  window.updateRouteSegmentControls = updateRouteSegmentControls;
  window.promptResumeRoute = promptResumeRoute;
}

export function openRadarOverlay() {
  const radar = document.getElementById("radar-scan-overlay");
  if (radar) radar.classList.add("active");
}

export function openSettingsModal() {
  showModal("settings");
}

export function closeSettingsModal() {
  hideModal("settings");
}
