/* js/core/workoutLibrary.js
 * Almacenamiento, renderizado y utilidades de entrenamientos estructurados (Modo ERG).
 */

import { state } from '../modules/state.js';
import { showToast, showConfirm } from '../modules/toast.js';

export { parseErg, parseWorkoutFile, parseZwo } from "./workoutParsers.js";

/** Clave de almacenamiento local para entrenamientos importados por el usuario */
const STORAGE_KEY_WORKOUTS = 'rodilloint_saved_workouts';

/** Paleta de colores por zonas de potencia estándar (Z1 - Z6+) */
export const ZONE_COLORS = {
  Z1: '#9ca3af', // Recuperación (< 55% FTP)
  Z2: '#3b82f6', // Resistencia (55% - 75% FTP)
  Z3: '#10b981', // Tempo (76% - 90% FTP)
  Z4: '#f59e0b', // Umbral (91% - 105% FTP)
  Z5: '#f97316', // VO2 Max (106% - 120% FTP)
  Z6: '#ef4444', // Anaeróbico (121% - 150% FTP)
  Z7: '#a855f7', // Neuromuscular (> 150% FTP)
};

/** Devuelve la zona y el color correspondiente a un % de FTP (0.0 a 2.0+) */
export function getZoneFromPowerRatio(ratio) {
  if (ratio < 0.55) return { name: 'Z1 - Recuperación', short: 'Z1', color: ZONE_COLORS.Z1 };
  if (ratio < 0.76) return { name: 'Z2 - Resistencia', short: 'Z2', color: ZONE_COLORS.Z2 };
  if (ratio < 0.91) return { name: 'Z3 - Tempo', short: 'Z3', color: ZONE_COLORS.Z3 };
  if (ratio < 1.06) return { name: 'Z4 - Umbral', short: 'Z4', color: ZONE_COLORS.Z4 };
  if (ratio < 1.21) return { name: 'Z5 - VO2 Max', short: 'Z5', color: ZONE_COLORS.Z5 };
  if (ratio < 1.51) return { name: 'Z6 - Anaeróbico', short: 'Z6', color: ZONE_COLORS.Z6 };
  return { name: 'Z7 - Neuromuscular', short: 'Z7', color: ZONE_COLORS.Z7 };
}

/** Formatea segundos a mm:ss o hh:mm:ss */
export function formatDuration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Escapa HTML para prevenir inyecciones */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ==========================================================================
   ENTRENAMIENTOS PREDEFINIDOS (PRESETS)
   ========================================================================== */
export const PRESET_WORKOUTS = [
  {
    id: 'preset-sweetspot-2x10',
    isPreset: true,
    name: 'Sweet Spot 2x10 min',
    description: 'Entrenamiento base clásico para mejorar el umbral de potencia con 2 bloques de 10 min al 88% FTP.',
    author: 'RodilloInt Lab',
    totalDurationSeconds: 2400, // 40 min
    steps: [
      { id: 's1', type: 'warmup', durationSeconds: 600, powerStart: 0.50, powerEnd: 0.75, cadence: 85, text: 'Calentamiento progresivo suave' },
      { id: 's2', type: 'steady', durationSeconds: 600, powerStart: 0.88, powerEnd: 0.88, cadence: 90, text: 'Bloque 1 Sweet Spot (88% FTP). Mantén cadencia ágil.' },
      { id: 's3', type: 'interval', durationSeconds: 300, powerStart: 0.55, powerEnd: 0.55, cadence: 85, text: 'Recuperación activa' },
      { id: 's4', type: 'steady', durationSeconds: 600, powerStart: 0.88, powerEnd: 0.88, cadence: 90, text: 'Bloque 2 Sweet Spot (88% FTP). ¡Buen ritmo!' },
      { id: 's5', type: 'cooldown', durationSeconds: 300, powerStart: 0.65, powerEnd: 0.45, cadence: 80, text: 'Enfriamiento y vuelta a la calma' },
    ],
  },
  {
    id: 'preset-vo2max-30-30',
    isPreset: true,
    name: 'VO2 Max 30/30s Micro-Intervalos',
    description: 'Intervalos cortos de alta intensidad: 10 repeticiones de 30 segundos al 125% FTP con 30 segundos de recuperación.',
    author: 'RodilloInt Lab',
    totalDurationSeconds: 1800, // 30 min
    steps: [
      { id: 'v1', type: 'warmup', durationSeconds: 480, powerStart: 0.50, powerEnd: 0.80, cadence: 90, text: 'Calentamiento con activación progresiva' },
      { id: 'v2', type: 'interval', durationSeconds: 120, powerStart: 0.55, powerEnd: 0.55, cadence: 85, text: 'Listo para las series 30/30' },
      // 10 repeticiones 30/30
      ...Array.from({ length: 10 }).flatMap((_, i) => [
        { id: `von-${i}`, type: 'interval', durationSeconds: 30, powerStart: 1.25, powerEnd: 1.25, cadence: 100, text: `¡A fondo! Serie ${i + 1} de 10 (125% FTP)` },
        { id: `voff-${i}`, type: 'interval', durationSeconds: 30, powerStart: 0.50, powerEnd: 0.50, cadence: 85, text: 'Recupera y respira' },
      ]),
      { id: 'v_end', type: 'cooldown', durationSeconds: 600, powerStart: 0.60, powerEnd: 0.40, cadence: 80, text: 'Enfriamiento suave' },
    ],
  },
  {
    id: 'preset-ftp-ramp-test',
    isPreset: true,
    name: 'Test de Rampa FTP por %FTP (Ramp Test)',
    description: 'Protocolo de evaluación FTP: calentamiento 5 min al 50% FTP y aumento de 5% FTP cada minuto hasta el fallo (máx. 200% FTP).',
    author: 'RodilloInt Lab',
    totalDurationSeconds: 2100, // 35 min max (5 min calentamiento + 30 escalones de 1 min)
    steps: [
      { id: 'r0', type: 'warmup', durationSeconds: 300, powerStart: 0.50, powerEnd: 0.50, cadence: 90, text: 'Calentamiento a ritmo constante. Mantén 85-95 rpm.' },
      ...Array.from({ length: 30 }).map((_, i) => {
        // Incrementos progresivos del 55% al 200% del FTP (5% FTP por minuto)
        const ratio = 0.55 + i * 0.05;
        return {
          id: `ramp-${i}`,
          type: 'ramp',
          durationSeconds: 60,
          powerStart: Number(ratio.toFixed(2)),
          powerEnd: Number(ratio.toFixed(2)),
          cadence: 90,
          text: `Escalón ${i + 1}: ${Math.round(ratio * 100)}% FTP. Pedalea fluido.`,
        };
      }),
    ],
  },
  {
    id: 'preset-ftp-ramp-test-watts',
    isPreset: true,
    name: 'Test de Rampa FTP por Vatios (Ramp Test)',
    description: 'Protocolo de evaluación FTP con vatios absolutos: calentamiento 5 min a 100 W y aumento de 20 W cada minuto hasta el fallo.',
    author: 'RodilloInt Lab',
    totalDurationSeconds: 2100, // 35 min max (5 min calentamiento + 30 escalones de 1 min)
    steps: [
      { id: 'w0', type: 'warmup', durationSeconds: 300, powerStart: 100, powerEnd: 100, cadence: 90, text: 'Calentamiento a 100 W. Mantén 85-95 rpm.' },
      ...Array.from({ length: 30 }).map((_, i) => {
        // Vatios absolutos: 100 W iniciales + 20 W por escalón
        const watts = 100 + (i + 1) * 20;
        return {
          id: `watt-ramp-${i}`,
          type: 'ramp',
          durationSeconds: 60,
          powerStart: watts,
          powerEnd: watts,
          cadence: 90,
          text: `Escalón ${i + 1}: ${watts} W. Pedalea fluido.`,
        };
      }),
    ],
  },
  {
    id: 'preset-active-recovery',
    isPreset: true,
    name: 'Recuperación Activa (Spinning suave)',
    description: 'Sesión regenerativa de 35 minutos en Zona 1 y 2 baja (50-60% FTP) para activar piernas y acelerar la recuperación.',
    author: 'RodilloInt Lab',
    totalDurationSeconds: 2100, // 35 min
    steps: [
      { id: 'rec1', type: 'warmup', durationSeconds: 300, powerStart: 0.45, powerEnd: 0.55, cadence: 85, text: 'Inicio muy suave' },
      { id: 'rec2', type: 'steady', durationSeconds: 900, powerStart: 0.58, powerEnd: 0.58, cadence: 90, text: 'Zona de recuperación activa. Cero tensión muscular.' },
      { id: 'rec3', type: 'steady', durationSeconds: 600, powerStart: 0.52, powerEnd: 0.52, cadence: 92, text: 'Cadencia ágil sin esfuerzo' },
      { id: 'rec4', type: 'cooldown', durationSeconds: 300, powerStart: 0.50, powerEnd: 0.40, cadence: 80, text: 'Soltar piernas' },
    ],
  },
];

/* ==========================================================================
   ALMACENAMIENTO DE ENTRENAMIENTOS DE USUARIO (LOCALSTORAGE)
   ========================================================================== */

export function getSavedWorkouts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WORKOUTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error cargando entrenamientos guardados:', err);
    return [];
  }
}

export function saveUserWorkout(workout) {
  const existing = getSavedWorkouts();
  // Evitar duplicados por id
  const filtered = existing.filter((w) => w.id !== workout.id);
  filtered.unshift(workout);
  localStorage.setItem(STORAGE_KEY_WORKOUTS, JSON.stringify(filtered));
  return workout;
}

export function deleteUserWorkout(workoutId) {
  const existing = getSavedWorkouts();
  const filtered = existing.filter((w) => w.id !== workoutId);
  localStorage.setItem(STORAGE_KEY_WORKOUTS, JSON.stringify(filtered));
}

export function getAllWorkouts(filter = 'all') {
  const userWorkouts = getSavedWorkouts().map((w) => ({ ...w, isPreset: false }));
  if (filter === 'presets') return PRESET_WORKOUTS;
  if (filter === 'user') return userWorkouts;
  return [...PRESET_WORKOUTS, ...userWorkouts];
}

export function serializeWorkoutAsZwo(workout, ftp = 200) {
  if (!workout || !Array.isArray(workout.steps) || workout.steps.length === 0) {
    throw new Error('No se puede exportar un entrenamiento sin bloques.');
  }
  const safeFtp = Number(ftp) > 30 ? Number(ftp) : 200;
  const escapeXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const asRatio = (power) => {
    const wattsOrRatio = Number(power);
    if (!Number.isFinite(wattsOrRatio) || wattsOrRatio < 0) {
      throw new Error('El entrenamiento contiene un valor de potencia no válido.');
    }
    return wattsOrRatio > 3 ? wattsOrRatio / safeFtp : wattsOrRatio;
  };
  const stepsXml = workout.steps.map((step) => {
    const duration = Number(step.durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('El entrenamiento contiene un bloque con duración no válida.');
    }
    const start = asRatio(step.powerStart);
    const end = asRatio(step.powerEnd ?? step.powerStart);
    const cadence = Number(step.cadence);
    const cadenceAttribute = Number.isFinite(cadence) && cadence > 0
      ? ` Cadence="${Math.round(cadence)}"`
      : '';
    const common = `Duration="${Math.max(1, Math.round(duration))}"${cadenceAttribute}`;
    const textEvent = step.text
      ? `<textevent time="0" message="${escapeXml(step.text)}" />`
      : '';
    if (step.type === 'warmup' || step.type === 'cooldown' || step.type === 'ramp' || start !== end) {
      const tag = step.type === 'warmup' ? 'Warmup' : step.type === 'cooldown' ? 'Cooldown' : 'Ramp';
      return `<${tag} ${common} PowerLow="${start}" PowerHigh="${end}">${textEvent}</${tag}>`;
    }
    return `<SteadyState ${common} Power="${start}">${textEvent}</SteadyState>`;
  }).join('\n    ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<workout_file>\n  <name>${escapeXml(workout.name)}</name>\n  <description>${escapeXml(workout.description || '')}</description>\n  <sportType>bike</sportType>\n  <author>${escapeXml(workout.author || 'RodilloInt')}</author>\n  <workout>\n    ${stepsXml}\n  </workout>\n</workout_file>`;
}

/* ==========================================================================
   GENERADOR DE GRÁFICO SVG (THUMBNAIL DE PERFIL DE POTENCIA)
   ========================================================================== */

/**
 * Renderiza el gráfico de barras/bloques de potencia del entrenamiento como SVG
 * @param {Workout} workout
 * @param {number} [userFtp=200]
 * @param {number} [width=320]
 * @param {number} [height=80]
 * @returns {string} Código SVG
 */
export function renderWorkoutThumbnailSvg(workout, userFtp = 200, width = 320, height = 80) {
  if (!workout || !workout.steps || workout.steps.length === 0) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="rgba(0,0,0,0.3)" rx="6"/></svg>`;
  }

  const padX = 4;
  const padBottom = 6;
  const padTop = 10;
  const usableWidth = width - padX * 2;
  const usableHeight = height - padTop - padBottom;
  const totalSeconds = workout.totalDurationSeconds || workout.steps.reduce((acc, s) => acc + s.durationSeconds, 0) || 1;

  // Encontrar el valor máximo de potencia ratio para escalar el eje Y (al menos 1.25 = 125% FTP)
  let maxRatio = 1.35;
  for (const step of workout.steps) {
    const sP = step.powerStart > 3 ? step.powerStart / userFtp : step.powerStart;
    const eP = (step.powerEnd || step.powerStart) > 3 ? (step.powerEnd || step.powerStart) / userFtp : (step.powerEnd || step.powerStart);
    if (sP > maxRatio) maxRatio = sP;
    if (eP > maxRatio) maxRatio = eP;
  }
  maxRatio *= 1.1; // Margen superior

  let currentX = padX;
  const rects = [];

  for (const step of workout.steps) {
    const stepW = Math.max(1, (step.durationSeconds / totalSeconds) * usableWidth);
    const sRatio = step.powerStart > 3 ? step.powerStart / userFtp : step.powerStart;
    const eRatio = (step.powerEnd || step.powerStart) > 3 ? (step.powerEnd || step.powerStart) / userFtp : (step.powerEnd || step.powerStart);

    const avgRatio = (sRatio + eRatio) / 2;
    const zone = getZoneFromPowerRatio(avgRatio);

    const hStart = Math.min(usableHeight, (sRatio / maxRatio) * usableHeight);
    const hEnd = Math.min(usableHeight, (eRatio / maxRatio) * usableHeight);

    const yStart = height - padBottom - hStart;
    const yEnd = height - padBottom - hEnd;

    if (Math.abs(hStart - hEnd) < 1) {
      // Bloque plano regular
      rects.push(
        `<rect x="${currentX.toFixed(1)}" y="${yStart.toFixed(1)}" width="${stepW.toFixed(1)}" height="${hStart.toFixed(1)}" fill="${zone.color}" opacity="0.88"><title>${escapeHtml(step.text || zone.name)}</title></rect>`
      );
    } else {
      // Rampa (polígono)
      const x1 = currentX.toFixed(1);
      const x2 = (currentX + stepW).toFixed(1);
      const yBase = (height - padBottom).toFixed(1);
      const pts = `${x1},${yBase} ${x1},${yStart.toFixed(1)} ${x2},${yEnd.toFixed(1)} ${x2},${yBase}`;
      rects.push(
        `<polygon points="${pts}" fill="${zone.color}" opacity="0.88"><title>${escapeHtml(step.text || zone.name)}</title></polygon>`
      );
    }

    currentX += stepW;
  }

  // Línea discontinua que indica el 100% FTP (Umbral)
  const ftpY = (height - padBottom - (1.0 / maxRatio) * usableHeight).toFixed(1);

  return `
    <svg class="workout-thumb-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <rect width="${width}" height="${height}" fill="rgba(15, 15, 22, 0.65)" rx="6" />
      <line x1="${padX}" y1="${ftpY}" x2="${width - padX}" y2="${ftpY}" stroke="rgba(255,255,255,0.25)" stroke-dasharray="3,3" stroke-width="1" />
      <text x="${width - padX - 2}" y="${Math.max(12, ftpY - 3)}" fill="rgba(255,255,255,0.45)" font-size="9" font-family="Inter, sans-serif" text-anchor="end">100% FTP</text>
      ${rects.join('')}
    </svg>
  `;
}

/* ==========================================================================
   RENDERIZADOR DE LA BIBLIOTECA DE ENTRENAMIENTOS EN PANTALLA
   ========================================================================== */

/**
 * Renderiza la lista de tarjetas en el contenedor #workout-library-list
 * @param {string} [filter='all']
 * @param {Function} [onSelectWorkout]
 * @param {Function} [onDeleteWorkout]
 * @param {Function} [onCopyWorkout]
 * @param {Function} [onEditWorkout]
 */
export function renderWorkoutLibrary(filter = 'all', onSelectWorkout, onDeleteWorkout, onCopyWorkout, onEditWorkout, onExportWorkout) {
  const container = document.getElementById('workout-library-list');
  if (!container) return;

  const workouts = getAllWorkouts(filter);
  const userFtp = state.currentUser?.ftp || 200;

  if (workouts.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card glass-card" style="padding: 40px; text-align: center; color: var(--text-secondary);">
        <div style="font-size: 38px; margin-bottom: 12px;">📂</div>
        <h3 style="color: white; margin-bottom: 8px;">No hay entrenamientos en esta categoría</h3>
        <p style="font-size: 14px; max-width: 460px; margin: 0 auto 20px;">
          Importa tu propio archivo <strong>.zwo</strong> (de Zwift / TrainingPeaks) o <strong>.erg</strong> para empezar.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = workouts
    .map((w) => {
      const durStr = formatDuration(w.totalDurationSeconds);
      const svgThumb = renderWorkoutThumbnailSvg(w, userFtp, 320, 75);
      const isPreset = w.isPreset === true;
      const isSelected = state.currentWorkout?.id === w.id;
      const stepCount = w.steps?.length || 0;

      return `
        <div class="glass-card workout-item-card${isSelected ? ' is-selected' : ''}" data-workout-id="${escapeHtml(w.id)}">
          <div class="workout-item-header">
            <div class="workout-item-title-group">
              <span class="workout-item-badge ${isPreset ? 'badge-preset' : 'badge-user'}">
                ${isPreset ? '⭐ Predefinido' : '👤 Personalizado'}
              </span>
              ${isSelected ? '<span class="workout-item-selected-label">✓ Seleccionado para entrenar</span>' : ''}
              <h3 class="workout-item-name">${escapeHtml(w.name)}</h3>
            </div>
            <span class="workout-item-duration">⏱️ ${durStr}</span>
          </div>

          <div class="workout-item-visual">
            ${svgThumb}
          </div>

          <p class="workout-item-desc">${escapeHtml(w.description || 'Entrenamiento estructurado ERG')}</p>

          <div class="workout-item-tools">
              ${
                !isPreset
                  ? `<button class="btn btn-dark btn-sm btn-delete-workout" data-delete-id="${escapeHtml(w.id)}" title="Eliminar entrenamiento" aria-label="Eliminar entrenamiento">🗑️</button>`
                  : ''
              }
              ${
                !isPreset && typeof onExportWorkout === 'function'
                  ? `<button class="btn btn-dark btn-sm btn-export-workout" data-workout-id="${escapeHtml(w.id)}" title="Exportar como archivo ZWO">.zwo</button>`
                  : ''
              }
              ${
                !isPreset && typeof onEditWorkout === 'function'
                  ? `<button class="btn btn-dark btn-sm btn-edit-workout" data-workout-id="${escapeHtml(w.id)}" title="Editar entrenamiento">Editar</button>`
                  : ''
              }
              <button class="btn btn-dark btn-sm btn-copy-workout" data-workout-id="${escapeHtml(w.id)}" title="Crear una copia editable">Copiar</button>
          </div>

          <div class="workout-item-footer">
            <span class="workout-item-meta">${stepCount} bloques · FTP ${userFtp} W</span>
            <button class="btn btn-primary btn-sm btn-select-workout" data-workout-id="${escapeHtml(w.id)}">
              ${isSelected ? 'Preparar sesión ➔' : 'Seleccionar ➔'}
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Enlazar eventos de botones
  container.querySelectorAll('.btn-select-workout').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-workout-id');
      const workout = workouts.find((x) => x.id === id);
      if (workout && typeof onSelectWorkout === 'function') {
        onSelectWorkout(workout);
      }
    });
  });

  container.querySelectorAll('.btn-copy-workout').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const workout = workouts.find((item) => item.id === btn.getAttribute('data-workout-id'));
      if (workout && typeof onCopyWorkout === 'function') onCopyWorkout(workout);
    });
  });

  container.querySelectorAll('.btn-edit-workout').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const workout = workouts.find((item) => item.id === btn.getAttribute('data-workout-id'));
      if (workout && typeof onEditWorkout === 'function') onEditWorkout(workout);
    });
  });

  container.querySelectorAll('.btn-export-workout').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const workout = workouts.find((item) => item.id === btn.getAttribute('data-workout-id'));
      if (workout && typeof onExportWorkout === 'function') onExportWorkout(workout);
    });
  });

  container.querySelectorAll('.btn-delete-workout').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-delete-id');
      const ok = await showConfirm('¿Estás seguro de que deseas eliminar este entrenamiento?', 'Eliminar', 'danger');
      if (ok) {
        deleteUserWorkout(id);
        showToast('Entrenamiento eliminado correctamente', 'info');
        renderWorkoutLibrary(filter, onSelectWorkout, onDeleteWorkout, onCopyWorkout, onEditWorkout, onExportWorkout);
      }
    });
  });
}

export const COGGAN_ZONE_COLORS = {
  Z1: '#9ca3af',
  Z2: '#3b82f6',
  Z3: '#10b981',
  Z4: '#f59e0b',
  Z5: '#f97316',
  Z6: '#ef4444',
  Z7: '#a855f7',
};

export function getCogganPowerZones(ftp = 200) {
  const safeFtp = Number(ftp) > 30 ? Number(ftp) : 200;
  const pct = (p) => Math.round((p / 100) * safeFtp);
  return [
    { zone: 1, short: 'Z1', name: 'Z1 - Recuperacion Activa', color: COGGAN_ZONE_COLORS.Z1, minPct: 0, maxPct: 55, minWatts: 0, maxWatts: pct(55) },
    { zone: 2, short: 'Z2', name: 'Z2 - Resistencia (Endurance)', color: COGGAN_ZONE_COLORS.Z2, minPct: 56, maxPct: 75, minWatts: pct(56), maxWatts: pct(75) },
    { zone: 3, short: 'Z3', name: 'Z3 - Tempo', color: COGGAN_ZONE_COLORS.Z3, minPct: 76, maxPct: 90, minWatts: pct(76), maxWatts: pct(90) },
    { zone: 4, short: 'Z4', name: 'Z4 - Umbral (FTP)', color: COGGAN_ZONE_COLORS.Z4, minPct: 91, maxPct: 105, minWatts: pct(91), maxWatts: pct(105) },
    { zone: 5, short: 'Z5', name: 'Z5 - Capacidad VO2max', color: COGGAN_ZONE_COLORS.Z5, minPct: 106, maxPct: 120, minWatts: pct(106), maxWatts: pct(120) },
    { zone: 6, short: 'Z6', name: 'Z6 - Capacidad Anaerobica', color: COGGAN_ZONE_COLORS.Z6, minPct: 121, maxPct: 150, minWatts: pct(121), maxWatts: pct(150) },
    { zone: 7, short: 'Z7', name: 'Z7 - Potencia Neuromuscular', color: COGGAN_ZONE_COLORS.Z7, minPct: 151, maxPct: null, minWatts: pct(151), maxWatts: null },
  ];
}

export function renderPowerZonesHtml(ftp = 200) {
  const zones = getCogganPowerZones(ftp);
  const maxW = Math.max(1, zones[5].maxWatts || Math.round(ftp * 1.5));
  const rows = zones.map((z) => {
    const range = z.maxWatts === null ? (z.minWatts + '+ W') : (z.minWatts + ' - ' + z.maxWatts + ' W');
    const pctLabel = z.maxPct === null ? (z.minPct + '%+') : (z.minPct + '-' + z.maxPct + '%');
    const barW = z.maxWatts === null ? 100 : Math.max(4, Math.round((z.maxWatts / maxW) * 100));
    return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">' +
      '<span style="width:34px;font-weight:700;color:' + z.color + ';">' + z.short + '</span>' +
      '<div style="flex:1;height:14px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">' +
        '<div style="width:' + barW + '%;height:100%;background:' + z.color + ';opacity:0.85;"></div>' +
      '</div>' +
      '<span style="width:110px;font-size:12px;color:var(--text-secondary);">' + range + '</span>' +
      '<span style="width:70px;font-size:11px;color:var(--text-secondary);text-align:right;">' + pctLabel + '</span>' +
    '</div>';
  }).join('');
  return '<div style="margin-top:12px;">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:6px;color:white;">Zonas de potencia (Coggan) - FTP ' + Math.round(ftp) + ' W</div>' +
    rows +
  '</div>';
}
