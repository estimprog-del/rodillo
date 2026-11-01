/**
 * routesView.js - Catálogo de rutas, visor de perfiles y biblioteca de rutas guardadas para RodilloInt
 */

import { state } from "../modules/state.js";
import { showToast, showConfirm } from "../modules/toast.js";

let _routeLibraryFilter = "all";
let _navigateTo = null;

export function initRoutesView({ navigateTo }) {
  _navigateTo = navigateTo;
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function _computeAscent(elevations) {
  let total = 0;
  for (let i = 1; i < elevations.length; i++) {
    const d = elevations[i] - elevations[i - 1];
    if (d > 0) total += d;
  }
  return total;
}

export function _buildTrackSvg(points) {
  const W = 100, H = 56, pad = 5;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const rangeW = (maxLon - minLon) || 1;
  const rangeH = (maxLat - minLat) || 1;
  const scale = Math.min((W - pad * 2) / rangeW, (H - pad * 2) / rangeH);
  function toX(lon) { return pad + (lon - minLon) * scale; }
  function toY(lat) { return H - pad - (lat - minLat) * scale; }
  const step = Math.max(1, Math.floor(points.length / 250));
  const parts = [];
  for (let i = 0; i < points.length; i += step) {
    parts.push((i === 0 ? "M" : "L") + toX(points[i].lon).toFixed(1) + "," + toY(points[i].lat).toFixed(1));
  }
  const p0 = points[0], pN = points[points.length - 1];
  return '<svg class="rl-track-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="100" height="56" fill="rgba(0,0,0,0.25)" rx="6"/>' +
    '<path d="' + parts.join(" ") + '" fill="none" stroke="#60a5fa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + toX(p0.lon).toFixed(1) + '" cy="' + toY(p0.lat).toFixed(1) + '" r="2.5" fill="#4ade80"/>' +
    '<circle cx="' + toX(pN.lon).toFixed(1) + '" cy="' + toY(pN.lat).toFixed(1) + '" r="2.5" fill="#f87171"/>' +
  '</svg>';
}

export function _buildElevSvg(distances, elevations) {
  const W = 100, H = 56, pad = 5;
  const minE = Math.min(...elevations);
  const maxE = Math.max(...elevations);
  const rangeE = (maxE - minE) || 1;
  const maxD = distances[distances.length - 1] || 1;
  const step = Math.max(1, Math.floor(distances.length / 180));
  const pts = [];
  for (let i = 0; i < distances.length; i += step) {
    const x = (pad + (distances[i] / maxD) * (W - pad * 2)).toFixed(1);
    const y = (H - pad - ((elevations[i] - minE) / rangeE) * (H - pad * 2)).toFixed(1);
    pts.push(x + "," + y);
  }
  const lineD = pts.map((p, i) => (i === 0 ? "M" : "L") + p).join(" ");
  const first = pts[0] ? pts[0].split(",")[0] : pad;
  const last = pts[pts.length - 1] ? pts[pts.length - 1].split(",")[0] : W - pad;
  const areaD = lineD + " L" + last + "," + (H - pad) + " L" + first + "," + (H - pad) + " Z";
  return '<svg class="rl-elev-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="100" height="56" fill="rgba(0,0,0,0.25)" rx="6"/>' +
    '<path d="' + areaD + '" fill="rgba(16,185,129,0.18)"/>' +
    '<path d="' + lineD + '" fill="none" stroke="#10b981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';
}

export function buildRouteCardEl(route) {
  const card = document.createElement("div");
  card.className = "route-library-card glass-card";
  const isApp = route.source === "app";
  const routeName = route.name || route.fileName || "Ruta sin nombre";
  const sourceLabel = isApp ? "Rutas de la app" : "Mis rutas";

  card.innerHTML =
    '<div class="route-library-graphs">' +
      '<svg class="rl-track-svg" viewBox="0 0 100 56" xmlns="http://www.w3.org/2000/svg">' +
        '<rect width="100" height="56" fill="rgba(0,0,0,0.2)" rx="6"/>' +
        '<text x="50" y="32" text-anchor="middle" fill="#666" font-size="9" font-family="sans-serif">Cargando...</text>' +
      "</svg>" +
      '<svg class="rl-elev-svg" viewBox="0 0 100 56" xmlns="http://www.w3.org/2000/svg">' +
        '<rect width="100" height="56" fill="rgba(0,0,0,0.2)" rx="6"/>' +
        '<text x="50" y="32" text-anchor="middle" fill="#666" font-size="9" font-family="sans-serif">Cargando...</text>' +
      "</svg>" +
    "</div>" +
    '<div class="route-library-details">' +
      '<div class="route-library-heading">' +
        '<strong class="route-library-name">' + escapeHtml(routeName) + "</strong>" +
      "</div>" +
      '<dl class="route-library-stats">' +
        "<dt>Distancia</dt><dd>--</dd>" +
        "<dt>Desnivel +</dt><dd>--</dd>" +
        "<dt>Alt. min</dt><dd>--</dd>" +
        "<dt>Alt. max</dt><dd>--</dd>" +
      "</dl>" +
      '<span class="route-library-source">' + escapeHtml(sourceLabel) + "</span>" +
      '<div style="display:flex;gap:8px;margin-top:auto;padding-top:6px;">' +
        '<button class="route-library-select" type="button">▶ Usar ruta</button>' +
        (isApp ? "" : '<button class="route-library-delete" type="button" title="Eliminar">🗑️</button>') +
      "</div>" +
    "</div>";

  return card;
}

export async function loadRouteCardData(card, route) {
  const isApp = route.source === "app";
  const routeName = route.name || route.fileName || "Ruta sin nombre";

  try {
    let gpxText;
    if (isApp) {
      const res = await fetch(route.gpxUrl);
      if (!res.ok) throw new Error("HTTP " + res.status);
      gpxText = await res.text();
    } else {
      gpxText = route.gpxText;
    }

    const parsed = GpxManager.parseRoute(gpxText);
    if (!parsed || !parsed.points || parsed.points.length < 2) throw new Error("Sin puntos validos");

    const { points, elevations, distances } = parsed;
    route._parsed = { points, elevations, distances };
    if (isApp) route._gpxText = gpxText;

    const totalKm = distances[distances.length - 1] || 0;
    const ascent = _computeAscent(elevations);
    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);

    // Actualizar stats
    const statsDd = card.querySelectorAll(".route-library-stats dd");
    if (statsDd.length >= 4) {
      statsDd[0].textContent = totalKm.toFixed(1) + " km";
      statsDd[1].textContent = Math.round(ascent) + " m";
      statsDd[2].textContent = Math.round(minElev) + " m";
      statsDd[3].textContent = Math.round(maxElev) + " m";
    }

    // SVG Traza
    const trackSvg = card.querySelector(".rl-track-svg");
    if (trackSvg) {
      trackSvg.outerHTML = _buildTrackSvg(points);
    }

    // SVG Elevacion
    const elevSvg = card.querySelector(".rl-elev-svg");
    if (elevSvg) {
      elevSvg.outerHTML = _buildElevSvg(distances, elevations);
    }

  } catch (e) {
    console.warn("Error procesando ruta \"" + routeName + "\":", e);
    const statsDd = card.querySelectorAll(".route-library-stats dd");
    if (statsDd.length > 0) statsDd[0].textContent = "Error";
  }

  // Botón usar ruta
  const selectBtn = card.querySelector(".route-library-select");
  if (selectBtn) {
    selectBtn.addEventListener("click", async () => {
      selectBtn.disabled = true;
      selectBtn.textContent = "Cargando...";
      try {
        if (!route._parsed) {
          let gpxText = route._gpxText || route.gpxText;
          if (!gpxText && isApp) {
            const res = await fetch(route.gpxUrl);
            gpxText = await res.text();
            route._gpxText = gpxText;
          }
          const parsed = GpxManager.parseRoute(gpxText);
          if (!parsed || !parsed.points || !parsed.points.length)
            throw new Error("Sin puntos validos");
          route._parsed = parsed;
        }
        const { points, elevations, distances } = route._parsed;
        state.routePoints = points;
        state.routeElevations = elevations;
        state.routeDistances = distances;
        state.gpxFilename = route.file || route.fileName || route.name;
        state.routeName = route.name || route.file || route.fileName;
        state.routeSelectedFromLibrary = true;
        state.currentMode = "ROUTE";
        if (typeof _navigateTo === "function") {
          _navigateTo("connections");
        }
      } catch (err) {
        console.error("Error cargando ruta:", err);
        showToast("No se pudo cargar la ruta. Comprueba el archivo.", "error");
        selectBtn.disabled = false;
        selectBtn.textContent = "Usar ruta";
      }
    });
  }

  // Botón eliminar (solo rutas de usuario)
  const deleteBtn = card.querySelector(".route-library-delete");
  if (deleteBtn) {
    const routeName2 = route.name || route.fileName || "Ruta";
    deleteBtn.addEventListener("click", async () => {
      if (!await showConfirm('¿Eliminar la ruta "' + routeName2 + '"?', 'Eliminar', 'danger')) return;
      try {
        await DbManager.deleteSavedRoute(route.id);
        await renderRouteLibrary();
      } catch (err) {
        console.error("Error eliminando ruta:", err);
        showToast("No se pudo eliminar la ruta.", "error");
      }
    });
  }
}

export async function renderRouteLibrary() {
  const container = document.getElementById("route-library-list");
  if (!container) return;
  container.innerHTML = "<p class='route-library-empty'>Cargando rutas...</p>";

  try {
    const userId = state.currentUser?.id;
    const filter = _routeLibraryFilter;

    // --- Rutas de la app desde catalog.json ---
    let appRoutes = [];
    if (filter !== "user") {
      try {
        const res = await fetch("/rodillo/rutas/catalog.json");
        if (res.ok) {
          const catalog = await res.json();
          appRoutes = (catalog.routes || []).map((r) => ({
            ...r,
            source: "app",
            gpxUrl: "/rodillo/rutas/" + encodeURIComponent(r.file),
          }));
        }
      } catch (e) {
        console.warn("No se pudo cargar el catalogo de rutas de la app:", e);
      }
    }

    // --- Rutas del usuario desde IndexedDB ---
    let userRoutes = [];
    if (filter !== "app" && userId) {
      userRoutes = (await DbManager.getSavedRoutes(userId)).map((r) => ({
        ...r,
        source: "user",
      }));
    }

    const allRoutes =
      filter === "app"
        ? appRoutes
        : filter === "user"
        ? userRoutes
        : [...appRoutes, ...userRoutes];

    if (allRoutes.length === 0) {
      container.innerHTML =
        "<p class='route-library-empty'>No hay rutas. Usa el boton Añadir ruta GPX/TCX para guardar una.</p>";
      return;
    }

    container.innerHTML = "";
    for (const route of allRoutes) {
      const card = buildRouteCardEl(route);
      container.appendChild(card);
      loadRouteCardData(card, route);
    }
  } catch (err) {
    console.error("Error cargando biblioteca de rutas:", err);
    container.innerHTML =
      "<p class='route-library-error'>Error al cargar las rutas. Intentalo de nuevo.</p>";
  }
}

export function setRouteLibraryFilter(value) {
  _routeLibraryFilter = value || "all";
  renderRouteLibrary();
}

export async function saveUserRoute(file) {
  const statusEl = document.getElementById("saved-route-library-status");
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
  if (!state.currentUser) {
    setStatus("Selecciona un perfil antes de guardar rutas.");
    return;
  }
  setStatus("Guardando ruta...");
  try {
    const gpxText = await file.text();
    const parsed = GpxManager.parseRoute(gpxText);
    if (!parsed || !parsed.points || !parsed.points.length) {
      setStatus("El archivo no es valido o no contiene puntos de ruta.");
      return;
    }
    const routeName = file.name.replace(/\.(gpx|tcx|xml)$/i, "");
    await DbManager.saveRoute({
      userId: state.currentUser.id,
      name: routeName,
      fileName: file.name,
      gpxText,
    });
    setStatus("Ruta \"" + routeName + "\" guardada correctamente.");
    await renderRouteLibrary();
  } catch (err) {
    console.error("Error guardando ruta:", err);
    setStatus("Error al guardar la ruta.");
  }
}

export async function populateSessionSavedRoutes() {
  const select = document.getElementById("session-saved-route-select");
  const statusEl = document.getElementById("session-saved-route-status");
  if (!select) return;
  select.innerHTML = "<option value=''>Cargando rutas...</option>";
  if (statusEl) statusEl.textContent = "";
  try {
    // Rutas de la app
    let appRoutes = [];
    try {
      const res = await fetch("/rodillo/rutas/catalog.json");
      if (res.ok) {
        const catalog = await res.json();
        appRoutes = catalog.routes || [];
      }
    } catch (e) {}
    // Rutas del usuario
    const userId = state.currentUser?.id;
    const userRoutes = userId ? await DbManager.getSavedRoutes(userId) : [];
    const allRoutes = [
      ...appRoutes.map((r) => ({ id: "app:" + r.file, name: r.name, file: r.file, source: "app" })),
      ...userRoutes.map((r) => ({ ...r, source: "user" })),
    ];
    if (allRoutes.length === 0) {
      select.innerHTML = "<option value=''>No hay rutas disponibles</option>";
      if (statusEl) statusEl.textContent = "Guarda rutas GPX/TCX en la seccion Rutas guardadas.";
      return;
    }
    select.innerHTML = "<option value=''>-- Seleccionar ruta --</option>";
    for (const route of allRoutes) {
      const opt = document.createElement("option");
      opt.value = String(route.id);
      opt.textContent = (route.source === "app" ? "[App] " : "") + (route.name || route.fileName || ("Ruta " + route.id));
      opt.dataset.source = route.source;
      if (route.file) opt.dataset.file = route.file;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error("Error cargando rutas en el modal:", err);
    select.innerHTML = "<option value=''>Error al cargar rutas</option>";
  }
}

export async function loadSavedRouteInSessionModal(button) {
  const select = document.getElementById("session-saved-route-select");
  const statusEl = document.getElementById("session-saved-route-status");
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
  const routeId = select?.value;
  if (!routeId) {
    setStatus("Elige una ruta de la lista primero.");
    return;
  }
  if (button) button.disabled = true;
  setStatus("Cargando ruta...");
  try {
    const selectedOpt = select.options[select.selectedIndex];
    const isApp = selectedOpt?.dataset.source === "app";
    let gpxText, routeName;
    if (isApp) {
      const file = selectedOpt.dataset.file;
      const res = await fetch("/rodillo/rutas/" + encodeURIComponent(file));
      if (!res.ok) throw new Error("No se pudo descargar el archivo de ruta.");
      gpxText = await res.text();
      routeName = selectedOpt.textContent.replace(/^\[App\] /, "");
    } else {
      const userId = state.currentUser?.id;
      const routes = userId ? await DbManager.getSavedRoutes(userId) : [];
      const route = routes.find((r) => String(r.id) === String(routeId));
      if (!route) { setStatus("Ruta no encontrada."); return; }
      gpxText = route.gpxText;
      routeName = route.name || route.fileName;
    }
    const parsed = GpxManager.parseRoute(gpxText);
    if (!parsed || !parsed.points || !parsed.points.length) {
      setStatus("El archivo de ruta es invalido o esta corrupto.");
      return;
    }
    state.routePoints = parsed.points;
    state.routeElevations = parsed.elevations;
    state.routeDistances = parsed.distances;
    state.gpxFilename = routeName;
    state.routeName = routeName;
    state.routeSelectedFromLibrary = true;
    const label = document.getElementById("gpx-filename-label");
    if (label) label.textContent = "Ruta cargada: " + routeName;
    setStatus("Ruta \"" + routeName + "\" cargada correctamente.");
  } catch (err) {
    console.error("Error cargando ruta desde el modal:", err);
    setStatus("Error al cargar la ruta.");
  } finally {
    if (button) button.disabled = false;
  }
}
