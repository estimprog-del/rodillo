let summaryRouteMap = null;
let summaryRouteRenderId = 0;

function renderSummaryMetrics(metrics) {
  document.getElementById("summary-duration").textContent = metrics.duration;
  document.getElementById("summary-total-duration").textContent =
    metrics.totalDuration;
  document.getElementById("summary-distance").textContent =
    `${metrics.distance.toFixed(2)} km`;
  document.getElementById("summary-np").textContent = `${metrics.np} W`;
  document.getElementById("summary-tss").textContent = metrics.tss;
  document.getElementById("summary-if").textContent =
    metrics.intensityFactor.toFixed(2);
  document.getElementById("summary-calories").textContent =
    `${metrics.calories} kcal`;
  const summaryKjEl = document.getElementById("summary-kilojoules");
  if (summaryKjEl) {
    const kjVal = Number.isFinite(Number(metrics.kilojoules))
      ? Math.round(Number(metrics.kilojoules))
      : (metrics.calories ? Math.round(metrics.calories * 1.05) : 0);
    summaryKjEl.textContent = `${kjVal} kJ`;
  }
  document.getElementById("summary-power-stats").textContent =
    `${metrics.avgPower} / ${metrics.maxPower} W`;
  document.getElementById("summary-speed-stats").textContent =
    `${metrics.avgSpeed.toFixed(1)} / ${metrics.maxSpeed.toFixed(1)} km/h`;
  document.getElementById("summary-hr-stats").textContent =
    `${metrics.avgHr} / ${metrics.maxHr} bpm`;
  const adherenceCard = document.getElementById("summary-erg-adherence-card");
  if (adherenceCard) {
    adherenceCard.hidden = !metrics.workoutAdherence;
    if (metrics.workoutAdherence) {
      document.getElementById("summary-erg-adherence").textContent =
        `${metrics.workoutAdherence.percent}%`;
      document.getElementById("summary-erg-adherence-detail").textContent =
        `${metrics.workoutAdherence.inRangeSeconds} de ${metrics.workoutAdherence.sampleCount} s · margen ±5% (mín. 5 W)`;
    }
  }

  ChartsManager.initZonesChart(
    "summary-zones-chart",
    metrics.timeInPowerZones,
  );
}

function getWorkoutPowerAdherence(samples) {
  const validSamples = samples.filter((sample) =>
    Number.isFinite(sample.watts) &&
    Number.isFinite(sample.targetWatts) &&
    sample.targetWatts > 0
  );
  if (validSamples.length === 0) return null;
  const inRangeSeconds = validSamples.filter((sample) =>
    Math.abs(sample.watts - sample.targetWatts) <= Math.max(5, sample.targetWatts * 0.05)
  ).length;
  return {
    sampleCount: validSamples.length,
    inRangeSeconds,
    percent: Math.round((inRangeSeconds / validSamples.length) * 100),
  };
}

function renderSummaryRoute(session, distanceKm = 0) {
  const renderId = ++summaryRouteRenderId;
  const grid = document.getElementById("summary-route-grid");
  const elevationCard = document.getElementById("summary-elevation-card");
  const mapCard = document.getElementById("summary-map-card");
  const mapContainer = document.getElementById("summary-route-map");
  const points = Array.isArray(session?.routePoints)
    ? session.routePoints.map((point) => ({
        lat: Number(point?.lat),
        lon: Number(point?.lon),
      }))
    : [];
  const routePoints = points.filter(
    (point) =>
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lon) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      point.lon >= -180 &&
      point.lon <= 180,
  );
  const hasRoute = routePoints.length >= 2;
  const distances = Array.isArray(session?.routeDistances)
    ? session.routeDistances.map(Number)
    : [];
  const elevations = Array.isArray(session?.routeElevations)
    ? session.routeElevations.map(Number)
    : [];
  const hasProfile =
    hasRoute &&
    routePoints.length === points.length &&
    distances.length === routePoints.length &&
    elevations.length === routePoints.length &&
    distances.every(Number.isFinite) &&
    elevations.every(Number.isFinite) &&
    distances.every((distance, index) => index === 0 || distance >= distances[index - 1]) &&
    elevations.some((elevation) => elevation !== 0);

  if (!grid || !elevationCard || !mapCard || !mapContainer) return;
  elevationCard.hidden = !hasProfile;
  mapCard.hidden = !hasRoute;
  grid.hidden = !hasRoute && !hasProfile;

  if (summaryRouteMap) {
    summaryRouteMap.remove();
    summaryRouteMap = null;
  }
  mapContainer.replaceChildren();
  if (!hasRoute) return;

  requestAnimationFrame(() => {
    if (
      renderId !== summaryRouteRenderId ||
      !document.getElementById("screen-summary")?.classList.contains("active")
    ) {
      return;
    }

    if (hasProfile) {
      ChartsManager.initElevationChart(
        "summary-elevation-chart",
        distances,
        elevations,
      );
    }

    if (typeof L === "undefined") {
      console.error("Leaflet no está disponible para mostrar el mapa del resumen.");
      mapContainer.textContent = "No se pudo cargar el mapa en este navegador.";
      return;
    }

    try {
      const latLngs = routePoints.map((point) => [point.lat, point.lon]);
      summaryRouteMap = L.map(mapContainer, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(summaryRouteMap);

      L.polyline(latLngs, {
        color: "#3b82f6",
        opacity: 0.85,
        weight: 5,
      }).addTo(summaryRouteMap);

      const startPoint = latLngs[0];
      const endPoint = latLngs[latLngs.length - 1];
      L.circleMarker(startPoint, {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#10b981",
        fillOpacity: 1,
      }).bindTooltip("Inicio").addTo(summaryRouteMap);
      L.circleMarker(endPoint, {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 1,
      }).bindTooltip("Fin de la ruta").addTo(summaryRouteMap);

      const routeDistance = Number(distanceKm);
      if (
        distances.length === routePoints.length &&
        distances.every(Number.isFinite) &&
        Number.isFinite(routeDistance)
      ) {
        const nextIndex = distances.findIndex(
          (distance) => distance >= routeDistance,
        );
        const currentIndex = Math.max(
          0,
          Math.min(
            nextIndex < 0 ? distances.length - 1 : nextIndex,
            routePoints.length - 1,
          ),
        );
        if (currentIndex > 0) {
          L.polyline(latLngs.slice(0, currentIndex + 1), {
            color: "#10b981",
            opacity: 0.95,
            weight: 6,
          }).addTo(summaryRouteMap);
        }
        L.circleMarker(latLngs[currentIndex], {
          radius: 8,
          color: "#ffffff",
          weight: 3,
          fillColor: "#f59e0b",
          fillOpacity: 1,
        }).bindTooltip("Progreso estimado").addTo(summaryRouteMap);
      }

      summaryRouteMap.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24] });
      requestAnimationFrame(() => summaryRouteMap?.invalidateSize());
    } catch (error) {
      console.error("No se pudo mostrar el mapa del resumen:", error);
      mapContainer.textContent = "No se pudo mostrar el mapa de esta ruta.";
    }
  });
}

function setSessionSaveStatus(message, color = "var(--text-secondary)") {
  const status = document.getElementById("session-save-status");
  if (status) {
    status.textContent = message;
    status.style.color = color;
  }
}

export {
  getWorkoutPowerAdherence,
  renderSummaryMetrics,
  renderSummaryRoute,
  setSessionSaveStatus,
};
