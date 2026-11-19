// js/ui/uiHelpers.js
import { setElText } from "../modules/ui.js";

export function updateClock() {
  const now = new Date();
  setElText(
    "clock",
    now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
  );
}

export function updatePauseButton(label, variant = "default") {
  const btn = document.getElementById("btn-workout-pause");
  if (!btn) return;
  btn.textContent = label;
  btn.className =
    variant === "resume"
      ? "btn-control btn-pause is-resume"
      : "btn-control btn-pause";
}

export function updateRouteProgressHud(state) {
  // state.totalDistance is stored in km across the app
  const totalKm = state.totalDistance.toFixed(2);
  const routeDist = state.routeWarmupActive
    ? 0
    : Math.max(0, state.totalDistance - (state.routeWarmupDistanceKm || 0));
  const remainingKm = state.routeTotalDistance
    ? Math.max(0, state.routeTotalDistance - routeDist).toFixed(2)
    : "--";

  setElText("submetrics-distance", `${totalKm} km`);
  setElText(
    "submetrics-remaining",
    state.routeTotalDistance ? `${remainingKm} km` : "--",
  );

  const remainingAscent = state.routeTotalAscent
    ? (state.routeTotalAscent - state.totalAscent).toFixed(0)
    : "--";
  setElText("submetrics-ascent", `${state.totalAscent.toFixed(0)} m`);
  setElText(
    "submetrics-remaining-ascent",
    remainingAscent !== "--" ? `${remainingAscent} m` : "--",
  );

  // Punto real en ruta (si es un tramo recortado o reanudado)
  const isSegment = Boolean(
    (state.routeSegmentOffsetKm && state.routeSegmentOffsetKm > 0.05) ||
    (state.routeOriginalTotalKm && state.routeDistances && state.routeOriginalTotalKm > (state.routeDistances[state.routeDistances.length - 1] || 0) + 0.1)
  );

  const realKmRow = document.getElementById("hud-progress-real-km-row");
  const realKmPoint = document.getElementById("metrics-route-real-point");

  if (isSegment && state.routeOriginalTotalKm) {
    const currentRealKm = (state.routeSegmentOffsetKm || 0) + routeDist;
    const realText = `Km ${currentRealKm.toFixed(1)} / ${state.routeOriginalTotalKm.toFixed(1)}`;

    if (realKmRow) realKmRow.style.display = "flex";
    setElText("submetrics-real-km", realText);

    if (realKmPoint) {
      realKmPoint.style.display = "block";
      realKmPoint.textContent = `📍 ${realText}`;
    }
  } else {
    if (realKmRow) realKmRow.style.display = "none";
    if (realKmPoint) realKmPoint.style.display = "none";
  }
}
