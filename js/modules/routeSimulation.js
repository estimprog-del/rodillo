import {
  calculateVirtualResistanceSlope,
  DEFAULT_VIRTUAL_GEAR,
} from "./virtualGears.js";

const SLOPE_AVERAGE_METERS = 10;

export function getElevationAtDistance(distances, elevations, distanceKm) {
  if (elevations.length === 0) return 0;
  if (distanceKm <= distances[0]) return elevations[0];

  const lastIndex = distances.length - 1;
  if (distanceKm >= distances[lastIndex]) return elevations[lastIndex];

  const index = distances.findIndex((distance) => distance >= distanceKm);
  if (index <= 0) return elevations[0];

  const startDistance = distances[index - 1];
  const endDistance = distances[index];
  const span = endDistance - startDistance;
  if (span < 0.00001) return elevations[index - 1];

  const progress = (distanceKm - startDistance) / span;
  return elevations[index - 1] +
    (elevations[index] - elevations[index - 1]) * progress;
}

export function getUpcomingSegmentData(
  routePoints,
  routeDistances,
  routeElevations,
  currentRouteIndex,
  previewDistanceMeters,
  currentDistanceKm = null,
) {
  if (routePoints.length === 0 || routeDistances.length === 0) return null;

  const startDistanceKm = currentDistanceKm !== null
    ? currentDistanceKm
    : routeDistances[currentRouteIndex];
  const targetDistanceKm = startDistanceKm + previewDistanceMeters / 1000;
  const routeEndKm = routeDistances[routeDistances.length - 1];
  const actualEndKm = Math.min(targetDistanceKm, routeEndKm);
  const previewDistances = [];
  const previewElevations = [];

  for (let index = 0; index < routeDistances.length; index += 1) {
    if (routeDistances[index] < startDistanceKm) continue;

    previewDistances.push((routeDistances[index] - startDistanceKm) * 1000);
    previewElevations.push(routeElevations[index]);
    if (routeDistances[index] >= actualEndKm) break;
  }

  const distanceRun = (actualEndKm - startDistanceKm) * 1000;
  if (distanceRun < 3) return null;

  const startElevation = getElevationAtDistance(
    routeDistances,
    routeElevations,
    startDistanceKm,
  );
  const endElevation = getElevationAtDistance(
    routeDistances,
    routeElevations,
    actualEndKm,
  );

  return {
    distances: previewDistances,
    elevations: previewElevations,
    avgSlope: ((endElevation - startElevation) / distanceRun) * 100,
  };
}

export function createRouteSimulationController(state) {
  function coerceSlope(slope) {
    const minSlope = Number.isFinite(state.virtualSlopeMin)
      ? state.virtualSlopeMin
      : -15;
    const maxSlope = Number.isFinite(state.virtualSlopeMax)
      ? state.virtualSlopeMax
      : 20;
    return Math.max(
      Math.min(minSlope, maxSlope),
      Math.min(Math.max(minSlope, maxSlope), slope),
    );
  }

  function getUpcoming(distanceMeters, currentDistanceKm = null) {
    return getUpcomingSegmentData(
      state.routePoints,
      state.routeDistances,
      state.routeElevations,
      state.currentRouteIndex,
      distanceMeters,
      currentDistanceKm,
    );
  }

  function getRouteSlopeAtDistance(distanceKm) {
    if (
      state.currentMode !== "ROUTE" ||
      state.routeDistances.length < 2 ||
      state.routeElevations.length !== state.routeDistances.length
    ) {
      return 0;
    }

    const startKm = state.routeDistances[0];
    const endKm = state.routeDistances[state.routeDistances.length - 1];
    const distance = Math.max(startKm, Math.min(endKm, Number(distanceKm) || 0));
    const startSampleKm = Math.max(startKm, distance - 0.01);
    const endSampleKm = Math.min(endKm, distance + 0.01);
    const distanceMeters = (endSampleKm - startSampleKm) * 1000;
    if (distanceMeters <= 0) return 0;

    const startElevation = getElevationAtDistance(
      state.routeDistances,
      state.routeElevations,
      startSampleKm,
    );
    const endElevation = getElevationAtDistance(
      state.routeDistances,
      state.routeElevations,
      endSampleKm,
    );
    const slope = ((endElevation - startElevation) / distanceMeters) * 100;
    return Number.isFinite(slope) ? slope : 0;
  }

  function setTargetSlope(currentDistanceKm) {
    const preview = getUpcoming(SLOPE_AVERAGE_METERS, currentDistanceKm);
    if (!preview) return;
    const gear = state.virtualGearsEnabled
      ? state.virtualGear
      : DEFAULT_VIRTUAL_GEAR;
    state.targetSlope = coerceSlope(
      calculateVirtualResistanceSlope(preview.avgSlope, gear),
    );
  }

  return {
    coerceSlope,
    getElevationAtDistance: (distanceKm) =>
      getElevationAtDistance(
        state.routeDistances,
        state.routeElevations,
        distanceKm,
      ),
    getRouteSlopeAtDistance,
    getUpcoming,
    setTargetSlope,
  };
}
