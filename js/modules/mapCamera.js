export function createMapCameraController({
  state,
  getMapSdk,
  isMapReady,
  logFpvDebug,
}) {
  let zoomLevel = 25;
  let animationFrame = null;

  function getMapViewLabel(mode) {
    return {
      "2D": "🗺️ 2D",
      "3D_AEREO": "🗺️ 3D Aéreo",
      "3D_FPV": "🚴 3D FPV",
    }[mode] || "🗺️ 3D Aéreo";
  }

  function interpolateRoutePoint(points, distanceKm) {
    if (!points?.length) return null;

    const distances = state.routeDistances;
    if (distanceKm <= 0) return [points[0].lon, points[0].lat];
    if (distanceKm >= distances[distances.length - 1]) {
      return [points[points.length - 1].lon, points[points.length - 1].lat];
    }

    for (let index = 0; index < distances.length - 1; index += 1) {
      if (distanceKm < distances[index] || distanceKm > distances[index + 1]) {
        continue;
      }

      const start = points[index];
      const end = points[index + 1];
      const segmentDistance = distances[index + 1] - distances[index];
      const progress = segmentDistance > 0
        ? (distanceKm - distances[index]) / segmentDistance
        : 0;
      return [
        start.lon + (end.lon - start.lon) * progress,
        start.lat + (end.lat - start.lat) * progress,
      ];
    }

    const lastPoint = points[points.length - 1];
    return [lastPoint.lon, lastPoint.lat];
  }

  function normalizeLngLat(position) {
    if (Array.isArray(position)) {
      const longitude = Number(position[0]);
      const latitude = Number(position[1]);
      return Number.isFinite(longitude) && Number.isFinite(latitude)
        ? [longitude, latitude]
        : null;
    }
    if (position && typeof position === "object") {
      const longitude = Number(
        position.lng ?? position.lon ?? position.longitude,
      );
      const latitude = Number(position.lat ?? position.latitude);
      return Number.isFinite(longitude) && Number.isFinite(latitude)
        ? [longitude, latitude]
        : null;
    }
    return null;
  }

  function isValidLngLat(position) {
    return Array.isArray(position) &&
      position.length === 2 &&
      Number.isFinite(position[0]) &&
      Number.isFinite(position[1]) &&
      position[0] >= -180 &&
      position[0] <= 180 &&
      position[1] >= -90 &&
      position[1] <= 90;
  }

  function getCameraElevation(position, fallbackElevation = 0) {
    const fallback = Number.isFinite(Number(fallbackElevation))
      ? Number(fallbackElevation)
      : 0;
    if (!state.map || typeof state.map.queryTerrainElevation !== "function") {
      return fallback;
    }

    const terrainElevation = Number(state.map.queryTerrainElevation(position));
    return Number.isFinite(terrainElevation) &&
      (terrainElevation !== 0 || fallback === 0)
      ? terrainElevation
      : fallback;
  }

  function updateFpvCamera(point, nextPoint, followRoute = true) {
    if (!state.map || !isMapReady(state.map)) return;

    const mapSdk = getMapSdk();
    if (!mapSdk?.MercatorCoordinate) return;

    let currentLngLat;
    let targetLngLat;
    if (state.currentMode === "ROUTE" && state.routePoints.length > 0) {
      currentLngLat = interpolateRoutePoint(
        state.routePoints,
        state.totalDistance,
      );
      targetLngLat = interpolateRoutePoint(
        state.routePoints,
        state.totalDistance + 0.015,
      );
    } else {
      currentLngLat = normalizeLngLat(point);
      targetLngLat = normalizeLngLat(nextPoint) || currentLngLat;
    }
    if (!currentLngLat || !targetLngLat) return;

    if (typeof state.map.getFreeCameraOptions === "function") {
      try {
        const camera = state.map.getFreeCameraOptions();
        const elevation = getCameraElevation(currentLngLat);
        const targetElevation = getCameraElevation(targetLngLat);
        camera.position = mapSdk.MercatorCoordinate.fromLngLat(
          currentLngLat,
          elevation + 1.7,
        );
        camera.lookAtPoint(mapSdk.MercatorCoordinate.fromLngLat(
          targetLngLat,
          targetElevation + 1.2,
        ));
        state.map.setFreeCameraOptions(camera);
        return;
      } catch (error) {
        console.error("Error en estabilización FreeCamera:", error);
      }
    }

    if (typeof state.map.jumpTo === "function") {
      const deltaLatitude = targetLngLat[1] - currentLngLat[1];
      const deltaLongitude = targetLngLat[0] - currentLngLat[0];
      const bearing = (
        Math.atan2(deltaLongitude, deltaLatitude) * 180 / Math.PI + 360
      ) % 360;
      state.map.jumpTo({
        center: currentLngLat,
        pitch: 85,
        bearing,
        zoom: zoomLevel,
      });
    }
  }

  function stopFpvCameraLoop() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  function startFpvCameraLoop() {
    stopFpvCameraLoop();
    if (
      !state.map ||
      typeof state.map.getFreeCameraOptions !== "function" ||
      typeof state.map.setFreeCameraOptions !== "function"
    ) {
      return;
    }

    const render = () => {
      animationFrame = null;
      if (state.mapViewMode !== "3D_FPV" || !state.map) return;
      if (state.routePoints.length === 0 || !isMapReady(state.map)) {
        animationFrame = requestAnimationFrame(render);
        return;
      }

      const point = state.routePoints[state.currentRouteIndex];
      if (!point) {
        animationFrame = requestAnimationFrame(render);
        return;
      }
      const nextPoint = state.routePoints[
        Math.min(state.currentRouteIndex + 1, state.routePoints.length - 1)
      ] || point;
      updateFpvCamera(
        [point.lon, point.lat],
        [nextPoint.lon, nextPoint.lat],
        state.isMapFollowingRoute,
      );
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
  }

  function changeZoom(delta) {
    zoomLevel = Math.max(1, Math.min(32, zoomLevel + delta));
    console.log("Nuevo nivel de zoom:", zoomLevel);
    if (state.map && typeof state.map.setZoom === "function") {
      state.map.setZoom(zoomLevel);
    }
  }

  return {
    changeZoom,
    getMapViewLabel,
    isAnimationFrameActive: () => animationFrame !== null,
    isValidLngLat,
    normalizeLngLat,
    startFpvCameraLoop,
    stopFpvCameraLoop,
    updateFpvCamera,
  };
}
