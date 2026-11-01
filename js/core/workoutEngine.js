/* js/core/workoutEngine.js
 * Motor de Ejecución de Entrenamientos Estructurados ERG.
 * Controla la progresión de intervalos, rampas, cálculo de vatios objetivo,
 * alertas sonoras (Web Audio API) y envío automático al rodillo vía FTMS.
 */

import { getZoneFromPowerRatio, ZONE_COLORS } from './workoutLibrary.js';

let _activeWorkout = null;
let _userFtp = 200;
let _biasWatts = 0;
let _currentStepIndex = 0;
let _stepElapsedSeconds = 0;
let _lastAppliedWatts = 0;
let _lastBeepSecond = -1;
let _audioCtx = null;

/**
 * Obtiene o inicializa el AudioContext del navegador para los avisos sonoros
 */
function getAudioContext() {
  if (!_audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      _audioCtx = new AudioContextClass();
    }
  }
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

/**
 * Reproduce un pitido de cuenta atrás o cambio de intervalo
 * @param {number} freq Frecuencia en Hz
 * @param {number} duration Duración en segundos
 * @param {number} volume Volumen (0.0 a 1.0)
 */
export function playWorkoutBeep(freq = 600, duration = 0.1, volume = 0.35) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (err) {
    console.warn('[Workout Audio] No se pudo reproducir pitido:', err);
  }
}

/**
 * Inicializa el motor de entrenamiento con un workout y el FTP del usuario
 * @param {import('./workoutLibrary.js').Workout} workout
 * @param {number} [ftp=200]
 */
export function initWorkoutEngine(workout, ftp = 200) {
  _activeWorkout = workout;
  _userFtp = Number(ftp) > 30 ? Number(ftp) : 200;
  _biasWatts = 0;
  _currentStepIndex = 0;
  _stepElapsedSeconds = 0;
  _lastAppliedWatts = 0;
  _lastBeepSecond = -1;
  console.log(`[Workout Engine] Iniciado: "${workout.name}" (${workout.steps.length} bloques). FTP base: ${_userFtp}W`);
}

/**
 * Reinicia el estado del motor
 */
export function resetWorkoutEngine() {
  _activeWorkout = null;
  _biasWatts = 0;
  _currentStepIndex = 0;
  _stepElapsedSeconds = 0;
  _lastAppliedWatts = 0;
  _lastBeepSecond = -1;
}

/**
 * Ajusta el bias de potencia manual en vatios
 * @param {number} deltaWatts (ej: +5 o -5)
 */
export function adjustWorkoutBias(deltaWatts) {
  _biasWatts += deltaWatts;
  console.log(`[Workout Engine] Bias de potencia ajustado: ${_biasWatts >= 0 ? '+' : ''}${_biasWatts}W`);
  return _biasWatts;
}

/**
 * Resetea el bias manual a 0
 */
export function resetWorkoutBias() {
  _biasWatts = 0;
  return _biasWatts;
}

export function getWorkoutBias() {
  return _biasWatts;
}

/**
 * Calcula los vatios brutos según el ratio y tipo de paso
 * @param {number} powerVal
 * @param {number} ftp
 * @returns {number}
 */
function toAbsoluteWatts(powerVal, ftp) {
  // Si el valor es menor o igual a 3, se considera porcentaje/ratio de FTP (ej: 0.85 = 85%)
  if (powerVal <= 3.0) {
    return Math.round(powerVal * ftp);
  }
  // Si es mayor a 3, ya está expresado en vatios absolutos
  return Math.round(powerVal);
}

/**
 * Ejecuta un ciclo de actualización del entrenamiento en cada segundo de sesión
 * @param {number} sessionElapsedSeconds Tiempo total transcurrido en la sesión
 * @returns {object|null} Estado detallado del paso actual para el HUD
 */
export function tickWorkout(sessionElapsedSeconds) {
  if (!_activeWorkout || !_activeWorkout.steps || _activeWorkout.steps.length === 0) {
    return null;
  }

  // Determinar en qué paso nos encontramos sumando las duraciones acumuladas
  let accumulated = 0;
  let targetIndex = _activeWorkout.steps.length - 1;
  let timeInCurrentStep = 0;

  for (let i = 0; i < _activeWorkout.steps.length; i++) {
    const s = _activeWorkout.steps[i];
    if (sessionElapsedSeconds < accumulated + s.durationSeconds) {
      targetIndex = i;
      timeInCurrentStep = sessionElapsedSeconds - accumulated;
      break;
    }
    accumulated += s.durationSeconds;
  }

  const isCompleted = sessionElapsedSeconds >= _activeWorkout.totalDurationSeconds;
  const currentStep = _activeWorkout.steps[targetIndex];
  _currentStepIndex = targetIndex;
  _stepElapsedSeconds = timeInCurrentStep;

  // Cálculo de vatios del bloque actual (manejo de rampas lineales)
  const pStartWatts = toAbsoluteWatts(currentStep.powerStart, _userFtp);
  const pEndWatts = toAbsoluteWatts(currentStep.powerEnd !== undefined ? currentStep.powerEnd : currentStep.powerStart, _userFtp);

  let baseTargetWatts = pStartWatts;
  if (pStartWatts !== pEndWatts && currentStep.durationSeconds > 0) {
    const progressInStep = Math.min(1.0, Math.max(0, _stepElapsedSeconds / currentStep.durationSeconds));
    baseTargetWatts = Math.round(pStartWatts + (pEndWatts - pStartWatts) * progressInStep);
  }

  // Aplicar bias del usuario
  const finalTargetWatts = Math.max(50, Math.min(1200, baseTargetWatts + _biasWatts));
  const currentRatio = finalTargetWatts / _userFtp;
  const zone = getZoneFromPowerRatio(currentRatio);

  const stepRemaining = Math.max(0, currentStep.durationSeconds - _stepElapsedSeconds);

  // Avisos sonoros en los últimos 3 segundos del bloque
  if (stepRemaining <= 3 && stepRemaining >= 1) {
    const currentIntSec = Math.floor(stepRemaining);
    if (currentIntSec !== _lastBeepSecond) {
      _lastBeepSecond = currentIntSec;
      playWorkoutBeep(520, 0.08, 0.4); // Pitido corto de preaviso
    }
  } else if (stepRemaining === 0 && _stepElapsedSeconds === 0) {
    // Inicio de un nuevo bloque
    playWorkoutBeep(880, 0.22, 0.5); // Pitido más agudo de cambio de bloque
  }

  // Enviar comando al rodillo inteligente si los vatios objetivo han cambiado
  if (finalTargetWatts !== _lastAppliedWatts) {
    _lastAppliedWatts = finalTargetWatts;
    if (typeof window.BleManager !== 'undefined' && window.BleManager.setTargetPower) {
      window.BleManager.setTargetPower(finalTargetWatts);
    }
  }

  const nextStep = _activeWorkout.steps[targetIndex + 1] || null;
  let nextStepWatts = null;
  if (nextStep) {
    nextStepWatts = toAbsoluteWatts(nextStep.powerStart, _userFtp);
  }

  return {
    isCompleted,
    workoutName: _activeWorkout.name,
    step: currentStep,
    stepIndex: targetIndex + 1,
    totalSteps: _activeWorkout.steps.length,
    stepElapsed: _stepElapsedSeconds,
    stepRemaining,
    stepDuration: currentStep.durationSeconds,
    targetWatts: finalTargetWatts,
    baseTargetWatts,
    biasWatts: _biasWatts,
    targetPercentFtp: Math.round(currentRatio * 100),
    targetCadence: currentStep.cadence,
    zone,
    nextStep,
    nextStepWatts,
    textMessage: currentStep.text || null,
    totalWorkoutDuration: _activeWorkout.totalDurationSeconds,
    workoutElapsed: Math.min(_activeWorkout.totalDurationSeconds, sessionElapsedSeconds),
    workoutProgressPercent: Math.min(100, (sessionElapsedSeconds / _activeWorkout.totalDurationSeconds) * 100),
  };
}

/**
 * Renderiza el SVG interactivo de alta resolución del entrenamiento para el HUD en sesión
 * @param {import('./workoutLibrary.js').Workout} workout
 * @param {number} currentElapsedSeconds
 * @param {number} [userFtp=200]
 * @param {number} [width=640]
 * @param {number} [height=120]
 * @returns {string} SVG
 */
export function renderActiveWorkoutHudSvg(workout, currentElapsedSeconds, userFtp = 200, width = 640, height = 120, actualPowerSamples = []) {
  if (!workout || !workout.steps) return '';

  const padX = 8;
  const padBottom = 20;
  const padTop = 14;
  const usableWidth = width - padX * 2;
  const usableHeight = height - padTop - padBottom;
  const totalSeconds = workout.totalDurationSeconds || 1;

  let maxRatio = 1.35;
  for (const step of workout.steps) {
    const sP = step.powerStart > 3 ? step.powerStart / userFtp : step.powerStart;
    const eP = (step.powerEnd || step.powerStart) > 3 ? (step.powerEnd || step.powerStart) / userFtp : (step.powerEnd || step.powerStart);
    if (sP > maxRatio) maxRatio = sP;
    if (eP > maxRatio) maxRatio = eP;
  }
  for (const sample of actualPowerSamples) {
    const ratio = Math.max(0, Number(sample.watts) || 0) / userFtp;
    if (ratio > maxRatio) maxRatio = ratio;
  }
  maxRatio *= 1.1;

  let currentX = padX;
  let accumulatedTime = 0;
  const rects = [];

  for (let idx = 0; idx < workout.steps.length; idx++) {
    const step = workout.steps[idx];
    const stepW = (step.durationSeconds / totalSeconds) * usableWidth;
    const sRatio = step.powerStart > 3 ? step.powerStart / userFtp : step.powerStart;
    const eRatio = (step.powerEnd || step.powerStart) > 3 ? (step.powerEnd || step.powerStart) / userFtp : (step.powerEnd || step.powerStart);

    const avgRatio = (sRatio + eRatio) / 2;
    const zone = getZoneFromPowerRatio(avgRatio);

    const hStart = Math.min(usableHeight, (sRatio / maxRatio) * usableHeight);
    const hEnd = Math.min(usableHeight, (eRatio / maxRatio) * usableHeight);

    const yStart = height - padBottom - hStart;
    const yEnd = height - padBottom - hEnd;

    // Determinar si el bloque ya fue completado, está activo o es futuro
    const isPast = accumulatedTime + step.durationSeconds <= currentElapsedSeconds;
    const isCurrent = currentElapsedSeconds >= accumulatedTime && currentElapsedSeconds < accumulatedTime + step.durationSeconds;
    const opacity = isCurrent ? '0.95' : isPast ? '0.45' : '0.80';
    const stroke = isCurrent ? 'stroke="#ffffff" stroke-width="2"' : '';

    if (Math.abs(hStart - hEnd) < 1) {
      rects.push(
        `<rect x="${currentX.toFixed(1)}" y="${yStart.toFixed(1)}" width="${Math.max(1, stepW).toFixed(1)}" height="${hStart.toFixed(1)}" fill="${zone.color}" opacity="${opacity}" ${stroke} rx="2"/>`
      );
    } else {
      const x1 = currentX.toFixed(1);
      const x2 = (currentX + stepW).toFixed(1);
      const yBase = (height - padBottom).toFixed(1);
      const pts = `${x1},${yBase} ${x1},${yStart.toFixed(1)} ${x2},${yEnd.toFixed(1)} ${x2},${yBase}`;
      rects.push(
        `<polygon points="${pts}" fill="${zone.color}" opacity="${opacity}" ${stroke}/>`
      );
    }

    currentX += stepW;
    accumulatedTime += step.durationSeconds;
  }

  // Aguja / cursor de posición actual en tiempo real
  const cursorRatio = Math.min(1.0, Math.max(0, currentElapsedSeconds / totalSeconds));
  const cursorX = (padX + cursorRatio * usableWidth).toFixed(1);
  const ftpY = (height - padBottom - (1.0 / maxRatio) * usableHeight).toFixed(1);
  const sampleStride = Math.max(1, Math.ceil(actualPowerSamples.length / 1200));
  const plottedSamples = actualPowerSamples.filter(
    (_, index) => index % sampleStride === 0 || index === actualPowerSamples.length - 1,
  );
  const actualSegments = [];
  let actualSegment = [];
  let previousSampleTime = null;
  for (const sample of plottedSamples) {
    const elapsed = Math.max(0, Number(sample.elapsedSeconds) || 0);
    if (previousSampleTime !== null && elapsed - previousSampleTime > 2.5) {
      if (actualSegment.length > 0) actualSegments.push(actualSegment);
      actualSegment = [];
    }
    const ratio = Math.max(0, Number(sample.watts) || 0) / userFtp;
    const x = padX + Math.min(1, elapsed / totalSeconds) * usableWidth;
    const y = height - padBottom - Math.min(1, ratio / maxRatio) * usableHeight;
    actualSegment.push({ x, y });
    previousSampleTime = elapsed;
  }
  if (actualSegment.length > 0) actualSegments.push(actualSegment);
  const actualPowerSvg = actualSegments.map((segment) => {
    if (segment.length === 1) {
      const point = segment[0];
      return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3" fill="#22d3ee"/>`;
    }
    const points = segment.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return `<polyline points="${points}" fill="none" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
  }).join("");
  const latestSegment = actualSegments[actualSegments.length - 1];
  const latestSample = latestSegment?.[latestSegment.length - 1];
  const actualPowerMarker = latestSample &&
    currentElapsedSeconds - (Number(actualPowerSamples[actualPowerSamples.length - 1]?.elapsedSeconds) || 0) <= 5
    ? `<circle cx="${latestSample.x.toFixed(1)}" cy="${latestSample.y.toFixed(1)}" r="5" fill="#22d3ee" stroke="#ffffff" stroke-width="2"/>`
    : "";

  return `
    <svg class="active-workout-hud-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="cursor-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
          <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.8"/>
        </linearGradient>
      </defs>
      <!-- Fondo -->
      <rect width="${width}" height="${height}" fill="rgba(12, 12, 20, 0.75)" rx="8"/>
      <!-- Línea 100% FTP -->
      <line x1="${padX}" y1="${ftpY}" x2="${width - padX}" y2="${ftpY}" stroke="rgba(255,255,255,0.22)" stroke-dasharray="4,4" stroke-width="1.2"/>
      <text x="${width - padX - 4}" y="${Math.max(12, ftpY - 4)}" fill="rgba(255,255,255,0.4)" font-size="10" font-family="Inter, sans-serif" font-weight="600" text-anchor="end">100% FTP (${userFtp}W)</text>
      <!-- Bloques -->
      ${rects.join('')}
      <!-- Potencia real registrada durante la sesión -->
      ${actualPowerSvg}
      ${actualPowerMarker}
      <!-- Aguja de progreso -->
      <line x1="${cursorX}" y1="${padTop - 4}" x2="${cursorX}" y2="${height - padBottom + 4}" stroke="url(#cursor-glow)" stroke-width="2.5" />
      <polygon points="${cursorX - 5},${padTop - 5} ${cursorX + 5},${padTop - 5} ${cursorX},${padTop + 2}" fill="#ffffff" />
    </svg>
  `;
}
