/* charts.js - ApexCharts Configuration and Realtime Updates for RodilloInt */

let realtimeChart = null;
let elevationChart = null;
let zonesChart = null;
let upcomingChart = null;

let realtimeData = {
  power: [],
  hr: [],
  labels: [],
};

/**
 * Initializes the realtime telemetry chart (Power and HR)
 * @param {string} containerId - ID of the DOM container element
 * @param {number} ftp - FTP in watts, used to draw power zone bands
 */
function initRealtimeChart(containerId, ftp = 200) {
  realtimeData = { power: [], hr: [], labels: [] };

  // Build FTP zone bands for y-axis annotations
  const zones = [
    { yMin: 0, yMax: ftp * 0.55, color: "#6b7280", label: "Z1" }, // Recovery
    { yMin: ftp * 0.55, yMax: ftp * 0.75, color: "#3b82f6", label: "Z2" }, // Endurance
    { yMin: ftp * 0.75, yMax: ftp * 0.9, color: "#10b981", label: "Z3" }, // Tempo
    { yMin: ftp * 0.9, yMax: ftp * 1.05, color: "#f59e0b", label: "Z4" }, // Threshold
    { yMin: ftp * 1.05, yMax: ftp * 1.2, color: "#f97316", label: "Z5" }, // VO2Max
    { yMin: ftp * 1.2, yMax: ftp * 2.0, color: "#ef4444", label: "Z6" }, // Anaerobic
  ];

  const yaxisAnnotations = zones.map((z) => ({
    y: z.yMin,
    y2: z.yMax,
    fillColor: z.color,
    opacity: 0.07,
    label: {
      text: z.label,
      style: {
        color: z.color,
        fontSize: "10px",
        fontFamily: "Inter",
        background: "transparent",
      },
      position: "right",
      offsetX: -4,
    },
  }));

  const options = {
    series: [
      { name: "Potencia (W)", data: [] },
      { name: "Pulso (BPM)", data: [] },
    ],
    chart: {
      id: "realtime-telemetry",
      type: "line",
      height: "100%",
      animations: {
        enabled: false, // Deshabilitado para optimizar rendimiento de CPU a 1Hz
      },
      toolbar: { show: false },
      sparkline: { enabled: false },
      background: "transparent",
    },
    annotations: {
      yaxis: yaxisAnnotations,
    },
    colors: ["#10b981", "#ef4444"],
    stroke: {
      curve: "straight", // Recto es más eficiente que smooth al actualizar frecuentemente
      width: 3,
    },
    grid: {
      borderColor: "rgba(255, 255, 255, 0.05)",
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
    },
    xaxis: {
      type: "numeric",
      labels: {
        show: true,
        style: { colors: "#9ca3af", fontFamily: "Inter" },
        formatter: (val) => `${Math.round(val)}s`,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      min: 0,
      max: function (max) {
        return Math.max(max + 20, ftp * 1.25);
      },
      labels: {
        style: { colors: "#9ca3af", fontFamily: "Inter" },
      },
    },
    theme: { mode: "dark" },
    tooltip: {
      theme: "dark",
      x: { formatter: (val) => `Tiempo: ${Math.round(val)} seg` },
    },
    legend: {
      position: "top",
      horizontalAlign: "right",
      labels: { colors: "#f3f4f6", fontFamily: "Outfit" },
    },
  };

  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = "";
    realtimeChart = new ApexCharts(container, options);
    realtimeChart.render();
  }
}

/**
 * Appends second-by-second values and scrolls the telemetry chart
 */
function updateRealtimeChart(elapsedSeconds, power, hr) {
  if (!realtimeChart) return;

  realtimeData.labels.push(elapsedSeconds);
  realtimeData.power.push(power);
  realtimeData.hr.push(hr);

  // Keep a scrolling window of the last 60 seconds
  if (realtimeData.labels.length > 60) {
    realtimeData.labels.shift();
    realtimeData.power.shift();
    realtimeData.hr.shift();
  }

  // Map to format required by ApexCharts [{x, y}]
  const powerSeries = realtimeData.power.map((val, idx) => ({
    x: realtimeData.labels[idx],
    y: val,
  }));
  const hrSeries =
    realtimeData.hr.length > 0
      ? realtimeData.hr.map((val, idx) => ({
          x: realtimeData.labels[idx],
          y: val,
        }))
      : [];

  realtimeChart.updateSeries([{ data: powerSeries }, { data: hrSeries }]);
}

/**
 * Initializes the route elevation profile chart
 */
let elevationPeaks = [];

/**
 * Initializes the route elevation profile chart
 */
function initElevationChart(
  containerId,
  distances,
  elevations,
  onPointSelected,
) {
  // --- Slope categories: colour-coded by gradient percentage ---
  const slopeRanges = [
    { name: "▼▼ < -5%", color: "#3b82f6", min: -Infinity, max: -5 },
    { name: "▼ -5 a -1%", color: "#10b981", min: -5, max: -1 },
    { name: "― Llano", color: "#9ca3af", min: -1, max: 2 },
    { name: "▲ 2 a 5%", color: "#f59e0b", min: 2, max: 5 },
    { name: "▲▲ 5 a 8%", color: "#f97316", min: 5, max: 8 },
    { name: "▲▲▲ > 8%", color: "#ef4444", min: 8, max: Infinity },
  ];

  function getSlopeCatIdx(slope) {
    for (let i = 0; i < slopeRanges.length; i++) {
      if (slope >= slopeRanges[i].min && slope < slopeRanges[i].max) return i;
    }
    return 2; // default: flat
  }

  // --- Calculate raw slope (%) per segment ---
  const rawSlopes = [];
  for (let i = 0; i < distances.length - 1; i++) {
    const dM = (distances[i + 1] - distances[i]) * 1000; // horizontal metres
    const dE = elevations[i + 1] - elevations[i]; // elevation delta
    rawSlopes.push(dM > 0.5 ? (dE / dM) * 100 : 0);
  }

  // Smooth with a 7-point moving average to reduce GPX noise
  const HALF_WIN = 3;
  const smoothSlopes = rawSlopes.map((_, idx) => {
    let sum = 0,
      n = 0;
    for (
      let j = Math.max(0, idx - HALF_WIN);
      j <= Math.min(rawSlopes.length - 1, idx + HALF_WIN);
      j++
    ) {
      sum += rawSlopes[j];
      n++;
    }
    return sum / n;
  });

  // Category per segment
  const segCat = smoothSlopes.map((s) => getSlopeCatIdx(s));

  // --- Build one ApexCharts series per slope category ---
  // Each series has {x,y} where active, {x, y:null} elsewhere.
  // Boundary points appear in BOTH adjacent series for seamless joins.
  const seriesArrays = slopeRanges.map(() => []);

  for (let i = 0; i < distances.length; i++) {
    const x = parseFloat(distances[i].toFixed(3));
    const y = Math.round(elevations[i]);
    const prevCat = i > 0 ? segCat[i - 1] : -1;
    const nextCat = i < segCat.length ? segCat[i] : -1;

    for (let c = 0; c < slopeRanges.length; c++) {
      seriesArrays[c].push(
        c === prevCat || c === nextCat ? { x, y } : { x, y: null },
      );
    }
  }

  // Keep only categories that have at least one data point
  const activeSeries = [];
  const activeColors = [];
  for (let c = 0; c < slopeRanges.length; c++) {
    if (seriesArrays[c].some((p) => p.y !== null)) {
      activeSeries.push({ name: slopeRanges[c].name, data: seriesArrays[c] });
      activeColors.push(slopeRanges[c].color);
    }
  }

  // Fallback when no category matched (e.g. single-point route)
  if (activeSeries.length === 0) {
    activeSeries.push({
      name: "Altitud",
      data: distances.map((d, i) => ({
        x: parseFloat(d.toFixed(3)),
        y: Math.round(elevations[i]),
      })),
    });
    activeColors.push("#3b82f6");
  }

  // --- Peak annotations (highest & lowest) ---
  let maxEle = -Infinity,
    maxIdx = 0,
    minEle = Infinity,
    minIdx = 0;
  for (let i = 0; i < elevations.length; i++) {
    if (elevations[i] > maxEle) {
      maxEle = elevations[i];
      maxIdx = i;
    }
    if (elevations[i] < minEle) {
      minEle = elevations[i];
      minIdx = i;
    }
  }
  const rMax = Math.round(maxEle);
  const rMin = Math.round(minEle);

  elevationPeaks = [
    {
      x: parseFloat(distances[maxIdx].toFixed(2)),
      y: rMax,
      marker: {
        size: 5,
        fillColor: "#ef4444",
        strokeColor: "#ffffff",
        radius: 2,
      },
      label: {
        borderColor: "#ef4444",
        offsetY: -5,
        style: { color: "#fff", background: "#ef4444" },
        text: `Máx: ${rMax} m`,
      },
    },
  ];

  if (rMax - rMin > 5) {
    elevationPeaks.push({
      x: parseFloat(distances[minIdx].toFixed(2)),
      y: rMin,
      marker: {
        size: 5,
        fillColor: "#3b82f6",
        strokeColor: "#ffffff",
        radius: 2,
      },
      label: {
        borderColor: "#3b82f6",
        offsetY: -5,
        style: { color: "#fff", background: "#3b82f6" },
        text: `Mín: ${rMin} m`,
      },
    });
  }

  // --- ApexCharts configuration ---
  const options = {
    series: activeSeries,
    chart: {
      type: "area",
      height: "100%",
      sparkline: { enabled: true },
      toolbar: { show: false },
      background: "transparent",
      events: {
        markerClick: function (event, chartContext, { dataPointIndex }) {
          if (onPointSelected && dataPointIndex >= 0) {
            onPointSelected(dataPointIndex);
          }
        },
      },
    },
    colors: activeColors,
    dataLabels: { enabled: false },
    markers: { size: 0 },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.4,
        opacityTo: 0.05,
        stops: [0, 95],
      },
    },
    stroke: {
      curve: "smooth",
      width: 2,
    },
    grid: {
      borderColor: "rgba(255, 255, 255, 0.05)",
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
    xaxis: {
      type: "numeric",
      labels: {
        style: { colors: "#ffffff", fontFamily: "Inter" },
        formatter: (val) => `${val.toFixed(1)} km`,
        offsetY: -10,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: "#ffffff", fontFamily: "Inter" },
        formatter: (val) => `${val} m`,
      },
      forceNiceScale: true,
    },
    theme: { mode: "dark" },
    tooltip: {
      theme: "dark",
      shared: true,
      custom: function ({ series, seriesIndex, dataPointIndex, w }) {
        if (dataPointIndex < 0 || dataPointIndex >= distances.length) return "";
        const dist = distances[dataPointIndex];
        const ele = elevations[dataPointIndex];
        const sVal =
          dataPointIndex < smoothSlopes.length
            ? smoothSlopes[dataPointIndex]
            : smoothSlopes.length > 0
              ? smoothSlopes[smoothSlopes.length - 1]
              : 0;
        const sColor = slopeRanges[getSlopeCatIdx(sVal)].color;
        return (
          '<div style="padding:8px 12px;font-size:12px;font-family:Inter,sans-serif;line-height:1.7">' +
          '<div style="color:#d1d5db">📍 ' +
          dist.toFixed(2) +
          " km</div>" +
          '<div style="color:#f3f4f6;font-weight:600">⛰️ ' +
          Math.round(ele) +
          " m</div>" +
          '<div style="color:' +
          sColor +
          ';font-weight:600">📐 ' +
          (sVal >= 0 ? "+" : "") +
          sVal.toFixed(1) +
          "%</div>" +
          "</div>"
        );
      },
    },
    legend: {
      show: true,
      position: "top",
      horizontalAlign: "center",
      fontSize: "9px",
      fontFamily: "Inter",
      labels: { colors: "#ffffff" },
      markers: { width: 8, height: 3, radius: 1 },
      itemMargin: { horizontal: 4, vertical: 0 },
      offsetY: -2,
    },
    annotations: {
      points: elevationPeaks,
      xaxis: [
        {
          x: 0,
          borderColor: "#ffffff",
          strokeDashArray: 0,
          borderWidth: 2,
          label: { show: false },
        },
      ],
    },
  };

  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = "";
    elevationChart = new ApexCharts(container, options);
    elevationChart.render();

    // Hide custom DOM cursor initially
    const cursor = document.getElementById("elevation-chart-cursor");
    if (cursor) cursor.style.display = "none";
  }
}

/**
 * Sincroniza la marca vertical del ciclista sobre el perfil de elevación
 */
function setElevationCursor(distanceKm, totalDistanceKm) {
  if (!elevationChart) return;

  const cursor = document.getElementById("elevation-chart-cursor");
  const chartEl = document.getElementById("elevation-chart");
  if (!cursor || !chartEl || !totalDistanceKm || totalDistanceKm <= 0) return;

  const gridBg = chartEl.querySelector(".apexcharts-grid-bg");
  if (!gridBg) {
    // Si la rejilla interna no se ha renderizado aún
    return;
  }

  // Obtener la posición X inicial y el ancho de la rejilla interna SVG
  const xAttr = parseFloat(gridBg.getAttribute("x")) || 0;
  const widthAttr = parseFloat(gridBg.getAttribute("width")) || 0;

  // Calcular porcentaje completado y aplicarlo al ancho de la rejilla
  const pct = Math.min(1.0, Math.max(0.0, distanceKm / totalDistanceKm));
  const leftPx = xAttr + pct * widthAttr;

  cursor.style.left = `${leftPx}px`;
  cursor.style.display = "block";
}

/**
 * Initializes the summary bar chart showing training stress in power zones
 */
function initZonesChart(containerId, timeInZonesSec) {
  // Map seconds into minutes
  const zonesMin = timeInZonesSec.map((sec) =>
    parseFloat((sec / 60.0).toFixed(1)),
  );

  const options = {
    series: [
      {
        name: "Minutos",
        data: zonesMin,
      },
    ],
    chart: {
      type: "bar",
      height: 220,
      toolbar: { show: false },
      background: "transparent",
    },
    plotOptions: {
      bar: {
        barHeight: "75%",
        distributed: true,
        horizontal: true,
        borderRadius: 4,
      },
    },
    colors: [
      "#6b7280", // Z1 - Recuperación (Gray)
      "#3b82f6", // Z2 - Resistencia (Blue)
      "#10b981", // Z3 - Tempo (Green)
      "#f59e0b", // Z4 - Umbral (Orange)
      "#f97316", // Z5 - VO2 Max (Dark Orange)
      "#ef4444", // Z6 - Anaeróbico (Red)
    ],
    theme: { mode: "dark" },
    grid: { show: false },
    xaxis: {
      categories: [
        "Z1 - Recuperación",
        "Z2 - Resistencia",
        "Z3 - Tempo",
        "Z4 - Umbral",
        "Z5 - VO2 Max",
        "Z6+ - Anaeróbico",
      ],
      labels: {
        style: { colors: "#9ca3af", fontFamily: "Inter" },
        formatter: (val) => `${val} min`,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: {
          colors: ["#ffffff"],
          fontSize: "12px",
          fontFamily: "Outfit",
          fontWeight: 600,
        },
      },
    },
    legend: { show: false },
    tooltip: {
      theme: "dark",
      y: { formatter: (val) => `${val} minutos` },
    },
  };

  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = "";
    zonesChart = new ApexCharts(container, options);
    zonesChart.render();
  }
}

// Export charts functions globally
window.ChartsManager = {
  initRealtimeChart,
  updateRealtimeChart,
  initElevationChart,
  setElevationCursor,
  initZonesChart,
  initUpcomingChart,
  updateUpcomingChart,
};

/**
 * Inicializa el minigráfico predictivo (sparkline) de los próximos 500m
 */
function initUpcomingChart(containerId) {
  const options = {
    series: [
      {
        name: "Perfil",
        data: [],
      },
    ],
    chart: {
      type: "area",
      height: "100%", // Asegura que llene el div padre
      sparkline: { enabled: true },
      animations: { enabled: false }, // Desactivado para maximizar rendimiento
    },
    colors: ["#9ca3af"],
    stroke: {
      curve: "smooth",
      width: 2,
    },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.35,
        opacityTo: 0.05,
      },
    },
    tooltip: { enabled: false },
  };

  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = "";
    upcomingChart = new ApexCharts(container, options);
    upcomingChart.render();
  }
}

let lastChartUpdate = 0;

/**
 * Actualiza el minigráfico predictivo y cambia su color dinámicamente según la pendiente
 */
function updateUpcomingChart(distances, elevations, avgSlope) {
  const now = Date.now();
  // Solo actualizar si han pasado al menos 200ms
  if (now - lastChartUpdate < 200) return;
  lastChartUpdate = now;

  if (!upcomingChart) return;

  const dataPoints = distances.map((d, idx) => ({
    x: d,
    y: elevations[idx],
  }));

  // Cambiar dinámicamente el color del gráfico según la pendiente media
  let color = "#9ca3af"; // Gris (Plano)
  if (avgSlope > 3.0) {
    color = "#ef4444"; // Rojo (Subida pronunciada)
  } else if (avgSlope > 0.5) {
    color = "#f97316"; // Naranja (Subida suave / falso llano)
  } else if (avgSlope < -1.0) {
    color = "#10b981"; // Verde (Bajada)
  }

  upcomingChart.updateOptions(
    {
      colors: [color],
      yaxis: {
        min: minEle - padding,
        max: maxEle + padding,
      },
      annotations: {
        points: [
          {
            x: distances[0],
            y: elevations[0],
            marker: {
              size: 6,
              fillColor: "#3b82f6",
              strokeColor: "#ffffff",
              strokeWidth: 3,
              radius: 4,
            },
            label: { show: false },
          },
        ],
        xaxis: [],
      },
    },
    false,
    true,
    false,
  );

  upcomingChart.updateSeries([
    {
      data: dataPoints,
    },
  ]);
}
