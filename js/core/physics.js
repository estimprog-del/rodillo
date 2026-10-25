/**
 * physics.js - Motor de cálculos físicos y métricas ciclistas (TSS, NP, IF, kJ, Velocidad Virtual).
 * Módulo puro: funciones matemáticas deterministas sin dependencias directas del DOM.
 */

/**
 * Calcula la potencia normalizada (NP) según el algoritmo estándar de Coggan:
 * 1. Media móvil de 30 segundos.
 * 2. Elevar los valores a la 4ª potencia.
 * 3. Calcular la media de esos valores elevados.
 * 4. Extraer la raíz cuarta del promedio.
 *
 * @param {number[]} values - Historial de valores de potencia segundo a segundo.
 * @returns {number} Potencia normalizada en vatios.
 */
export function calculateNormalizedPowerFromValues(values) {
  if (!Array.isArray(values) || values.length === 0) return 0.0;
  if (values.length < 30) {
    return values.reduce((a, b) => a + b, 0) / values.length || 0.0;
  }

  // 1. Medias móviles de 30 segundos elevadas a la 4ª potencia
  let windowSum = 0;
  for (let i = 0; i < 30; i++) {
    windowSum += values[i] || 0;
  }

  let rollingSum4 = Math.pow(windowSum / 30.0, 4.0);
  let count = 1;

  for (let i = 30; i < values.length; i++) {
    windowSum += (values[i] || 0) - (values[i - 30] || 0);
    const avg = windowSum / 30.0;
    rollingSum4 += Math.pow(avg, 4.0);
    count++;
  }

  // 2. Media de las cuartas potencias y raíz cuarta
  const avgPowers4 = rollingSum4 / count;
  const np = Math.pow(avgPowers4, 0.25);
  return Number.isFinite(np) ? np : 0.0;
}

/**
 * Calcula el Factor de Intensidad (IF) respecto al FTP del ciclista.
 *
 * @param {number} np - Potencia normalizada en vatios.
 * @param {number} ftp - Umbral de potencia funcional (FTP) en vatios.
 * @returns {number} Factor de intensidad (ej. 0.85).
 */
export function calculateIntensityFactor(np, ftp) {
  const safeFtp = Number(ftp);
  const safeNp = Number(np);
  if (!Number.isFinite(safeFtp) || safeFtp <= 0 || !Number.isFinite(safeNp) || safeNp <= 0) {
    return 0.0;
  }
  return parseFloat((safeNp / safeFtp).toFixed(2));
}

/**
 * Calcula el Training Stress Score (TSS).
 * TSS = (segundos * NP * IF) / (FTP * 3600) * 100 = (segundos * NP * IF) / (FTP * 36)
 *
 * @param {number} elapsedSeconds - Segundos transcurridos de ejercicio.
 * @param {number} np - Potencia normalizada.
 * @param {number} intensityFactor - Factor de intensidad (IF).
 * @param {number} ftp - FTP del usuario.
 * @returns {number} TSS redondeado.
 */
export function calculateTSS(elapsedSeconds, np, intensityFactor, ftp) {
  const safeFtp = Number(ftp);
  if (!Number.isFinite(safeFtp) || safeFtp <= 0) return 0;
  const safeSec = Number(elapsedSeconds) || 0;
  const safeNp = Number(np) || 0;
  const safeIf = Number(intensityFactor) || 0;
  const tss = (safeSec * safeNp * safeIf) / (safeFtp * 36);
  return Number.isFinite(tss) ? Math.round(tss) : 0;
}

/**
 * Calcula el trabajo mecánico total acumulado en Kilojulios (kJ).
 * 1 W = 1 J/s -> 1 kJ = 1000 J
 *
 * @param {number} currentWatts - Potencia instantánea en vatios.
 * @param {number} seconds - Duración del paso en segundos (por defecto 1s).
 * @returns {number} Kilojulios generados en ese intervalo.
 */
export function calculateKilojoulesStep(currentWatts, seconds = 1) {
  const w = Number(currentWatts);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return (w * seconds) / 1000.0;
}

/**
 * Calcula la velocidad virtual (km/h) a partir de la potencia (W) y la pendiente (%).
 * Emplea el método numérico de Newton-Raphson resolviendo el equilibrio aerodinámico,
 * gravitatorio y de rodadura de una bicicleta de carretera estándar.
 *
 * @param {number} power - Potencia en vatios.
 * @param {number} slope - Pendiente en porcentaje (ej. 5 para 5%).
 * @param {number} [userWeight=75.0] - Peso del ciclista en kg.
 * @returns {number} Velocidad virtual estimada en km/h.
 */
export function calculateVirtualSpeed(power, slope, userWeight = 75.0) {
  if (!Number.isFinite(power) || power <= 0) return 0.0;

  const bikeWeight = 10.0; // kg
  const totalMass = (Number(userWeight) || 75.0) + bikeWeight;
  const g = 9.81; // m/s^2

  // Coeficientes estándar de carretera
  const Crr = 0.005; // Resistencia de rodadura (asfalto bueno)
  const CdA = 0.32;  // Área frontal x coeficiente de arrastre aerodinámico
  const rho = 1.225; // Densidad del aire a nivel del mar (kg/m^3)

  const slopeDecimal = (Number(slope) || 0.0) / 100.0;

  let v = 5.0; // Estimación inicial: 18 km/h (5 m/s)
  const tolerance = 0.01;
  const maxIterations = 20;

  for (let i = 0; i < maxIterations; i++) {
    const rollingGravityFactor =
      totalMass * g * Math.max(-0.08, slopeDecimal + Crr);

    const f_v =
      0.5 * CdA * rho * Math.pow(v, 3) + rollingGravityFactor * v - power;
    const f_prime_v = 1.5 * CdA * rho * Math.pow(v, 2) + rollingGravityFactor;

    if (Math.abs(f_prime_v) < 0.0001) break;

    const next_v = v - f_v / f_prime_v;
    if (Math.abs(next_v - v) < tolerance) {
      v = next_v;
      break;
    }
    v = next_v;
  }

  // Límites seguros entre 0 y 80 km/h (22.2 m/s)
  const speedMps = Math.max(0.0, Math.min(22.2, v));
  const speedKph = speedMps * 3.6;
  return Number.isFinite(speedKph) ? speedKph : 0.0;
}

/**
 * Determina la zona de potencia estándar de Coggan (Z1 a Z6) a partir de los vatios y el FTP.
 *
 * @param {number} watts - Potencia actual.
 * @param {number} ftp - FTP del ciclista.
 * @returns {{ zone: number, name: string, color: string }} Zona de potencia.
 */
export function getPowerZone(watts, ftp) {
  const safeFtp = Number(ftp) || 200;
  const pct = (Number(watts) || 0) / safeFtp;

  if (pct < 0.55) return { zone: 1, name: "Z1 Recuperación Activa", color: "#38bdf8" };
  if (pct < 0.75) return { zone: 2, name: "Z2 Resistencia", color: "#4ade80" };
  if (pct < 0.90) return { zone: 3, name: "Z3 Tempo", color: "#facc15" };
  if (pct < 1.05) return { zone: 4, name: "Z4 Umbral", color: "#fb923c" };
  if (pct < 1.20) return { zone: 5, name: "Z5 VO2 Máx", color: "#f87171" };
  return { zone: 6, name: "Z6 Capacidad Anaeróbica", color: "#c084fc" };
}
