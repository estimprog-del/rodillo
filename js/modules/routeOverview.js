export function createRouteOverviewController(state) {
  let scale = null;

  function init() {
    const svg = document.getElementById("route-overview-svg");
    const trackPath = document.getElementById("route-overview-track");
    const completedPath = document.getElementById("route-overview-completed");
    const startCircle = document.getElementById("route-overview-start");
    const endCircle = document.getElementById("route-overview-end");
    const positionCircle = document.getElementById("route-overview-position");
    if (!svg || !trackPath || !positionCircle) return;
    if (!state.routePoints || state.routePoints.length < 2) return;

    const points = state.routePoints;
    const width = 100;
    const height = 100;
    const padding = 7;
    const latitudes = points.map((point) => point.lat);
    const longitudes = points.map((point) => point.lon);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);
    const rangeWidth = maxLongitude - minLongitude || 1e-9;
    const rangeHeight = maxLatitude - minLatitude || 1e-9;
    const mapScale = Math.min(
      (width - padding * 2) / rangeWidth,
      (height - padding * 2) / rangeHeight,
    );
    const offsetX = padding +
      ((width - padding * 2) - rangeWidth * mapScale) / 2;
    const offsetY = padding +
      ((height - padding * 2) - rangeHeight * mapScale) / 2;
    scale = {
      minLatitude,
      minLongitude,
      mapScale,
      offsetX,
      offsetY,
      height,
    };

    const toX = (longitude) =>
      offsetX + (longitude - minLongitude) * mapScale;
    const toY = (latitude) =>
      height - offsetY - (latitude - minLatitude) * mapScale;
    const sampleStep = Math.max(1, Math.floor(points.length / 400));
    const pathParts = [];
    for (let index = 0; index < points.length; index += sampleStep) {
      const point = points[index];
      pathParts.push(
        `${index === 0 ? "M" : "L"}${toX(point.lon).toFixed(2)},${toY(point.lat).toFixed(2)}`,
      );
    }

    trackPath.setAttribute("d", pathParts.join(" "));
    if (completedPath) completedPath.setAttribute("d", "");

    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    if (startCircle) {
      startCircle.setAttribute("cx", toX(firstPoint.lon).toFixed(2));
      startCircle.setAttribute("cy", toY(firstPoint.lat).toFixed(2));
    }
    if (endCircle) {
      endCircle.setAttribute("cx", toX(lastPoint.lon).toFixed(2));
      endCircle.setAttribute("cy", toY(lastPoint.lat).toFixed(2));
    }
    positionCircle.setAttribute("cx", toX(firstPoint.lon).toFixed(2));
    positionCircle.setAttribute("cy", toY(firstPoint.lat).toFixed(2));
  }

  function updatePosition(currentIndex) {
    if (!scale || !state.routePoints?.length) return;

    const positionCircle = document.getElementById("route-overview-position");
    const completedPath = document.getElementById("route-overview-completed");
    if (!positionCircle) return;

    const {
      minLatitude,
      minLongitude,
      mapScale,
      offsetX,
      offsetY,
      height,
    } = scale;
    const toX = (longitude) =>
      offsetX + (longitude - minLongitude) * mapScale;
    const toY = (latitude) =>
      height - offsetY - (latitude - minLatitude) * mapScale;
    const index = Math.max(
      0,
      Math.min(currentIndex, state.routePoints.length - 1),
    );
    const point = state.routePoints[index];
    positionCircle.setAttribute("cx", toX(point.lon).toFixed(2));
    positionCircle.setAttribute("cy", toY(point.lat).toFixed(2));

    if (completedPath && index > 0) {
      const sampleStep = Math.max(
        1,
        Math.floor(state.routePoints.length / 400),
      );
      const pathParts = [];
      for (let pointIndex = 0; pointIndex <= index; pointIndex += sampleStep) {
        const sampledPoint = state.routePoints[pointIndex];
        pathParts.push(
          `${pointIndex === 0 ? "M" : "L"}${toX(sampledPoint.lon).toFixed(2)},${toY(sampledPoint.lat).toFixed(2)}`,
        );
      }
      if (pathParts.length > 0) {
        pathParts.push(`L${toX(point.lon).toFixed(2)},${toY(point.lat).toFixed(2)}`);
      }
      completedPath.setAttribute("d", pathParts.join(" "));
    }
  }

  return { init, updatePosition };
}

export function calculateTotalRouteAscent(elevations) {
  if (elevations.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < elevations.length; index += 1) {
    const difference = elevations[index] - elevations[index - 1];
    if (difference > 0) total += difference;
  }
  return total;
}
