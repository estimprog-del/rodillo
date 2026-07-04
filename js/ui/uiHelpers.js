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
  const totalKm = (state.totalDistance / 1000).toFixed(2);
  const remainingKm = state.routeTotalDistance
    ? (state.routeTotalDistance / 1000 - totalKm).toFixed(2)
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
}
