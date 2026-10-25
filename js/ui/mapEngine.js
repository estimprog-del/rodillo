// js/ui/mapEngine.js - Motor de mapas (Leaflet 2D, MapLibre 3D y cámara FPV)
import { state, saveStateToLocalStorage } from "../modules/state.js";
import { showToast } from "../modules/toast.js";

export const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY || "";
export const MAP_VIEW_MODES = ["2D", "3D_AEREO", "3D_FPV"];

let fpvZoomLevel = 25;
let fpvAnimationFrame = null;
let lastFpvDebugState = "";
let mapReadyInstance = null;
let mapControlsResizeObserver = null;
let observedMapControls = null;
let observedMapHudGroup = null;

export function logFpvDebug(message, details = {}) {
  const stateKey = `${message}:${JSON.stringify(details)}`;
  if (stateKey === lastFpvDebugState) return;
  lastFpvDebugState = stateKey;
  console.debug(`[FPV] ${message}`, details);
}

export function getMapSdk() {
  return (
    [globalThis.maptilersdk, globalThis.maplibregl].find(
      (sdk) => sdk?.Map && sdk?.MercatorCoordinate,
    ) || null
  );
}

export function isMapReady(map) {
  return Boolean(
    map &&
      (map === mapReadyInstance ||
        typeof map.isStyleLoaded !== "function" ||
        map.isStyleLoaded()),
  );
}

export function positionMapNavigationControls() {
  const mapContainer = document.getElementById("workout-map");
  const hudGroup = document.querySelector(".hud-bottom-right-group");
  const controls = mapContainer?.querySelector(
    ".maplibregl-ctrl-top-right, .leaflet-top.leaflet-right",
  );
  if (!mapContainer || !hudGroup || !controls) return;

  const mapRect = mapContainer.getBoundingClientRect();
  const hudRect = hudGroup.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();
  if (!controlsRect.height || !mapRect.height) return;

  const top = Math.max(
    80,
    hudRect.top - mapRect.top - controlsRect.height - 10,
  );
  const right = Math.max(8, mapRect.right - hudRect.right);
  controls.style.setProperty("top", `${top}px`, "important");
  controls.style.setProperty("right", `${right}px`, "important");

  if (typeof ResizeObserver !== "undefined") {
    if (!mapControlsResizeObserver) {
      mapControlsResizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(positionMapNavigationControls);
      });
    }
    if (controls !== observedMapControls || hudGroup !== observedMapHudGroup) {
      mapControlsResizeObserver.disconnect();
      mapControlsResizeObserver.observe(hudGroup);
      mapControlsResizeObserver.observe(controls);
      observedMapControls = controls;
      observedMapHudGroup = hudGroup;
    }
  }
}

export function initConfiguredMap() {
  const configuredMode = MAP_VIEW_MODES.includes(state.mapViewMode)
    ? state.mapViewMode
    : state.mapType === "leaflet"
      ? "2D"
      : "3D_AEREO";
  const toggleButton = document.getElementById("btn-toggle-3d");

  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  mapReadyInstance = null;

  if (configuredMode === "2D") {
    state.mapViewMode = "2D";
    state.mapType = "leaflet";
    initLeafletMap();
    drawRouteOnMap();
    createOrientationToggleButton();
    return;
  }

  if (!toggleButton || typeof window.toggleMapEngine !== "function") {
    console.error("No se pudo inicializar el mapa 3D: falta el control del motor.");
    return;
  }

  state.mapViewMode = "2D";
  state.mapType = "leaflet";
  window.toggleMapEngine(toggleButton);

  if (configuredMode === "3D_FPV") {
    window.toggleMapEngine(toggleButton);
  }
}

export function initLeafletMap() {
  if (state.map) return;

  // Vista inicial en Madrid por defecto
  state.map = L.map("workout-map", {
    zoomControl: false,
    attributionControl: false,
  }).setView([40.4168, -3.7038], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(state.map);

  const zoomControl = L.control.zoom({ position: "topright" });
  zoomControl.addTo(state.map);
  requestAnimationFrame(positionMapNavigationControls);
}

export function drawRouteOnMap() {
  if (!state.map || state.routePoints.length === 0) return;

  const firstPoint = state.routePoints[0];
  if (!firstPoint || isNaN(firstPoint.lat) || isNaN(firstPoint.lon)) return;

  // Si existe addSource es MapLibre (3D)
  if (state.map.addSource) {
    if (!isMapReady(state.map)) {
      return;
    }

    const geojson = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: state.routePoints.map((p) => [p.lon, p.lat]),
      },
    };

    if (state.map.getSource("route")) {
      state.map.getSource("route").setData(geojson);
    } else {
      state.map.addSource("route", { type: "geojson", data: geojson });
      state.map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ff5722", "line-width": 6 },
      });
    }

    state.map.jumpTo({
      center: [firstPoint.lon, firstPoint.lat],
      zoom: state.mapViewMode === "3D_FPV" ? 20 : 14,
      pitch: state.mapViewMode === "3D_FPV" ? 82 : 60,
    });
  } else {
    // Modo 2D Leaflet
    if (state.routePolyline) state.map.removeLayer(state.routePolyline);
    if (state.userMarker) state.map.removeLayer(state.userMarker);
    if (state.ghostMarker) state.map.removeLayer(state.ghostMarker);

    const latLngs = state.routePoints.map((p) => [p.lat, p.lon]);

    state.routePolyline = L.polyline(latLngs, {
      color: "#ff5722",
      weight: 6,
      opacity: 0.85,
    }).addTo(state.map);

    const userIcon = L.divIcon({
      className: "custom-user-marker",
      html: '<div class="user-marker-core"><div class="user-marker-pulse"></div></div>',
      iconSize: [14, 14],
    });

    state.userMarker = L.marker(latLngs[0], {
      icon: userIcon,
      title: "Tú",
    }).addTo(state.map);

    state.map.fitBounds(state.routePolyline.getBounds(), { padding: [20, 20] });
  }
}

export function createOrientationToggleButton() {
  const btn = document.getElementById("btn-orient-toggle");
  if (!btn) return;

  btn.textContent = state.isMapFollowingRoute ? "⬆️ Ruta" : "🗺️ Norte";

  btn.onclick = () => {
    state.isMapFollowingRoute = !state.isMapFollowingRoute;
    btn.textContent = state.isMapFollowingRoute ? "⬆️ Ruta" : "🗺️ Norte";
  };
}

export function getMapViewLabel(mode) {
  return (
    {
      "2D": "🗺️ 2D",
      "3D_AEREO": "🗺️ 3D Aéreo",
      "3D_FPV": "🚴 3D FPV",
    }[mode] || "🗺️ 3D Aéreo"
  );
}

export function toggleMapEngine(btn) {
  stopFpvCameraLoop();
  const container = document.getElementById("workout-map");
  const currentMode =
    state.mapViewMode || (state.mapType === "leaflet" ? "2D" : "3D_AEREO");
  const nextMode =
    MAP_VIEW_MODES[(MAP_VIEW_MODES.indexOf(currentMode) + 1) % MAP_VIEW_MODES.length];
  state.mapViewMode = nextMode;
  state.mapType = nextMode === "2D" ? "leaflet" : "maplibre";
  if (nextMode === "3D_FPV") {
    state.isMapFollowingRoute = true;
  }
  saveStateToLocalStorage();

  if (nextMode === "2D") {
    if (state.map) {
      state.map.remove();
      state.map = null;
    }
    mapReadyInstance = null;
    if (container) {
      container.className = "workout-map-fullscreen";
      container.style.height = "100%";
      container.style.width = "100%";
    }

    if (btn) btn.textContent = getMapViewLabel(nextMode);
    initLeafletMap();
    drawRouteOnMap();
    createOrientationToggleButton();
  } else {
    if (!MAPTILER_API_KEY) {
      showToast("El mapa 3D no está configurado: falta la clave de MapTiler.", "warning");
      return;
    }

    if (state.map) {
      state.map.remove();
      state.map = null;
    }
    mapReadyInstance = null;
    if (btn) btn.textContent = getMapViewLabel(nextMode);

    if (container) {
      container.className = "workout-map-fullscreen";
      container.style.height = "100%";
      container.style.width = "100%";
    }

    try {
      const mapSdk = getMapSdk();
      if (!mapSdk?.Map) {
        throw new Error("El SDK 3D no está disponible.");
      }

      state.map = new mapSdk.Map({
        container: "workout-map",
        style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`,
        center:
          state.routePoints.length > 0
            ? [state.routePoints[0].lon, state.routePoints[0].lat]
            : [-1.9297, 43.3178],
        zoom: 14,
        pitch: nextMode === "3D_FPV" ? 82 : 60,
        maxPitch: 85,
        antialias: true,
      });
      const mapInstance = state.map;

      state.map.addControl(
        new mapSdk.NavigationControl({
          showCompass: true,
          showZoom: true,
        }),
        "top-right",
      );

      state.map.on("load", () => {
        if (state.map !== mapInstance) return;
        mapReadyInstance = mapInstance;
        logFpvDebug("Mapa cargado", {
          mode: nextMode,
          routePoints: state.routePoints.length,
          currentRouteIndex: state.currentRouteIndex,
          hasFreeCamera:
            typeof state.map.getFreeCameraOptions === "function" &&
            typeof state.map.setFreeCameraOptions === "function",
          sdk: getMapSdk()?.version || "desconocido",
        });
        if (typeof state.map.setFog === "function") {
          state.map.setFog({
            range: [0.5, 10],
            color: "#ffffff",
            "horizon-blend": 0.1,
          });
        }
        state.map.setMaxPitch(85);
        if (nextMode === "3D_FPV") state.map.setPitch(85);
        if (nextMode === "3D_FPV" && !state.map.getSource("terrain")) {
          state.map.addSource("terrain", {
            type: "raster-dem",
            url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_API_KEY}`,
            tileSize: 256,
            encoding: "mapbox",
          });
          state.map.setTerrain({ source: "terrain", exaggeration: 1 });
        }
        state.map.resize();
        requestAnimationFrame(positionMapNavigationControls);
        drawRouteOnMap();
        createOrientationToggleButton();

        if (nextMode === "3D_FPV" && state.routePoints.length > 0) {
          const point = state.routePoints[state.currentRouteIndex];
          const nextPoint =
            state.routePoints[
              Math.min(state.currentRouteIndex + 1, state.routePoints.length - 1)
            ];
          updateFpvCamera(
            [point.lon, point.lat],
            [nextPoint.lon, nextPoint.lat],
            state.isMapFollowingRoute,
          );
          startFpvCameraLoop();
        }
      });

      let mapErrorAlertShown = false;
      const reportedMapErrors = new Set();
      state.map.on("error", (e) => {
        const mapError = e?.error;
        const status = e?.error?.status;
        if (!mapErrorAlertShown && (status === 401 || status === 403)) {
          mapErrorAlertShown = true;
          showToast("Error de autorización del mapa 3D. Revisa la clave de MapTiler.", "error");
        }
        const errorMessage = mapError?.message || String(mapError || "");
        if (errorMessage && !reportedMapErrors.has(errorMessage)) {
          reportedMapErrors.add(errorMessage);
          console.warn("MapLibre notificó un recurso no disponible:", errorMessage);
        }
      });
    } catch (err) {
      console.error("Error inicialización MapLibre:", err);
      state.mapViewMode = "3D_AEREO";
      state.mapType = "maplibre";
      if (btn) btn.textContent = getMapViewLabel(state.mapViewMode);
    }
  }
}

export function obtenerPuntoPorDistancia(puntos, distanciaObjetivoKm) {
  if (!puntos || puntos.length === 0) return null;
  const distancias = state.routeDistances;
  if (!distancias || distancias.length === 0) return [puntos[0].lon, puntos[0].lat];

  if (distanciaObjetivoKm <= 0) return [puntos[0].lon, puntos[0].lat];
  if (distanciaObjetivoKm >= distancias[distancias.length - 1])
    return [puntos[puntos.length - 1].lon, puntos[puntos.length - 1].lat];

  for (let i = 0; i < distancias.length - 1; i++) {
    if (
      distanciaObjetivoKm >= distancias[i] &&
      distanciaObjetivoKm <= distancias[i + 1]
    ) {
      const p1 = puntos[i];
      const p2 = puntos[i + 1];
      const distTramo = distancias[i + 1] - distancias[i];
      const t = distTramo > 0 ? (distanciaObjetivoKm - distancias[i]) / distTramo : 0;

      const lng = p1.lon + (p2.lon - p1.lon) * t;
      const lat = p1.lat + (p2.lat - p1.lat) * t;
      return [lng, lat];
    }
  }
  return [puntos[puntos.length - 1].lon, puntos[puntos.length - 1].lat];
}

export function getCameraElevation(position, fallbackElevation = 0) {
  const fallback = Number.isFinite(Number(fallbackElevation))
    ? Number(fallbackElevation)
    : 0;
  if (!state.map || typeof state.map.queryTerrainElevation !== "function") {
    return fallback;
  }

  const terrainElevation = Number(state.map.queryTerrainElevation(position));
  return Number.isFinite(terrainElevation) && (terrainElevation !== 0 || fallback === 0)
    ? terrainElevation
    : fallback;
}

export function isValidLngLat(position) {
  return (
    Array.isArray(position) &&
    position.length === 2 &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    position[0] >= -180 &&
    position[0] <= 180 &&
    position[1] >= -90 &&
    position[1] <= 90
  );
}

export function normalizeLngLat(position) {
  if (Array.isArray(position)) {
    const lng = Number(position[0]);
    const lat = Number(position[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  if (position && typeof position === "object") {
    const lng = Number(position.lng ?? position.lon ?? position.longitude);
    const lat = Number(position.lat ?? position.latitude);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  return null;
}

export function updateFpvCamera(point, nextPoint, followRoute = true) {
  if (!state.map || !isMapReady(state.map)) return;

  const mapSdk = getMapSdk();
  if (!mapSdk?.MercatorCoordinate) return;

  let currentLngLat, targetLngLat;

  if (state.currentMode === "ROUTE" && state.routePoints.length > 0) {
    const metrosRecorridosKm = state.totalDistance;
    currentLngLat = obtenerPuntoPorDistancia(state.routePoints, metrosRecorridosKm);
    targetLngLat = obtenerPuntoPorDistancia(
      state.routePoints,
      metrosRecorridosKm + 0.015,
    );
  } else {
    currentLngLat = normalizeLngLat(point);
    targetLngLat = normalizeLngLat(nextPoint) || currentLngLat;
  }

  if (!currentLngLat || !targetLngLat) return;

  // FreeCameraOptions
  if (typeof state.map.getFreeCameraOptions === "function") {
    try {
      const camera = state.map.getFreeCameraOptions();
      const elevation = getCameraElevation(currentLngLat, 0);
      const targetElevation = getCameraElevation(targetLngLat, 0);

      camera.position = mapSdk.MercatorCoordinate.fromLngLat(
        currentLngLat,
        elevation + 1.7,
      );
      camera.lookAtPoint(
        mapSdk.MercatorCoordinate.fromLngLat(targetLngLat, targetElevation + 1.2),
      );

      state.map.setFreeCameraOptions(camera);
      return;
    } catch (errFPV) {
      console.error("Error en estabilización FreeCamera:", errFPV);
    }
  }

  // Respaldo: jumpTo
  if (typeof state.map.jumpTo === "function") {
    const deltaLat = targetLngLat[1] - currentLngLat[1];
    const deltaLng = targetLngLat[0] - currentLngLat[0];
    const rumboEstabilizado =
      ((Math.atan2(deltaLng, deltaLat) * 180) / Math.PI + 360) % 360;

    state.map.jumpTo({
      center: currentLngLat,
      pitch: 85,
      bearing: rumboEstabilizado,
      zoom: fpvZoomLevel,
    });
  }
}

export function startFpvCameraLoop() {
  stopFpvCameraLoop();

  if (
    !state.map ||
    typeof state.map.getFreeCameraOptions !== "function" ||
    typeof state.map.setFreeCameraOptions !== "function"
  ) {
    return;
  }

  const render = () => {
    fpvAnimationFrame = null;
    if (state.mapViewMode !== "3D_FPV" || !state.map) return;
    if (state.routePoints.length === 0) {
      fpvAnimationFrame = requestAnimationFrame(render);
      return;
    }
    if (!isMapReady(state.map)) {
      fpvAnimationFrame = requestAnimationFrame(render);
      return;
    }

    const point = state.routePoints[state.currentRouteIndex];
    if (!point) {
      fpvAnimationFrame = requestAnimationFrame(render);
      return;
    }
    const nextPoint =
      state.routePoints[
        Math.min(state.currentRouteIndex + 1, state.routePoints.length - 1)
      ] || point;
    updateFpvCamera(
      [point.lon, point.lat],
      [nextPoint.lon, nextPoint.lat],
      state.isMapFollowingRoute,
    );
    fpvAnimationFrame = requestAnimationFrame(render);
  };

  fpvAnimationFrame = requestAnimationFrame(render);
}

export function stopFpvCameraLoop() {
  if (fpvAnimationFrame !== null) {
    cancelAnimationFrame(fpvAnimationFrame);
    fpvAnimationFrame = null;
  }
}

export function isFpvCameraLoopRunning() {
  return fpvAnimationFrame !== null;
}

export function changeFpvZoom(delta) {
  fpvZoomLevel = Math.max(1, Math.min(32, fpvZoomLevel + delta));
  console.log("Nuevo nivel de zoom:", fpvZoomLevel);

  if (state.map && typeof state.map.setZoom === "function") {
    state.map.setZoom(fpvZoomLevel);
  }
}

// Window bindings
window.toggleMapEngine = toggleMapEngine;
window.changeFpvZoom = changeFpvZoom;

window.addEventListener("keydown", (e) => {
  if (e.key === "+") {
    changeFpvZoom(1);
  } else if (e.key === "-") {
    changeFpvZoom(-1);
  }
});
