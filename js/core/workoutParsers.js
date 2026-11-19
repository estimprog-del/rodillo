/** Parsing and format detection for structured cycling workouts. */

/* ==========================================================================
   PARSERS: .ZWO (Zwift XML) Y .ERG / .MRC (Computrainer)
   ========================================================================== */

/**
 * Parsea un archivo de entrenamiento Zwift XML (.zwo)
 * @param {string} xmlString
 * @param {string} [fileName]
 * @returns {Workout}
 */
export function parseZwo(xmlString, fileName = 'Entrenamiento ZWO') {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`Error de sintaxis XML en archivo ZWO: ${parserError.textContent.slice(0, 100)}`);
  }

  const workoutFile = xmlDoc.querySelector('workout_file');
  const nameEl = xmlDoc.querySelector('name');
  const descEl = xmlDoc.querySelector('description');
  const authorEl = xmlDoc.querySelector('author');
  const workoutEl = xmlDoc.querySelector('workout');

  if (!workoutEl) {
    throw new Error('El archivo no contiene un nodo <workout> válido.');
  }

  const name = nameEl?.textContent?.trim() || fileName.replace(/\.zwo$/i, '');
  const description = descEl?.textContent?.trim() || 'Entrenamiento importado desde formato .zwo';
  const author = authorEl?.textContent?.trim() || 'Desconocido';

  const steps = [];
  let totalDurationSeconds = 0;
  let stepIndex = 0;

  for (const node of workoutEl.children) {
    const tagName = node.tagName.toLowerCase();
    const duration = parseFloat(node.getAttribute('Duration') || '0');
    if (isNaN(duration) || duration <= 0) continue;

    const cadenceAttr = node.getAttribute('Cadence');
    const cadence = cadenceAttr ? parseInt(cadenceAttr, 10) : undefined;

    // Buscar mensajes de texto dentro del bloque
    const textEvents = Array.from(node.querySelectorAll('textevent')).map((t) => t.getAttribute('message')).filter(Boolean);
    const text = textEvents.length > 0 ? textEvents.join(' | ') : undefined;

    if (tagName === 'warmup') {
      const pLow = parseFloat(node.getAttribute('PowerLow') || '0.5');
      const pHigh = parseFloat(node.getAttribute('PowerHigh') || '0.75');
      steps.push({
        id: `zwo_step_${stepIndex++}`,
        type: 'warmup',
        durationSeconds: duration,
        powerStart: pLow,
        powerEnd: pHigh,
        cadence,
        text: text || 'Calentamiento',
      });
      totalDurationSeconds += duration;
    } else if (tagName === 'cooldown') {
      const pLow = parseFloat(node.getAttribute('PowerLow') || '0.7');
      const pHigh = parseFloat(node.getAttribute('PowerHigh') || '0.4');
      steps.push({
        id: `zwo_step_${stepIndex++}`,
        type: 'cooldown',
        durationSeconds: duration,
        powerStart: pLow,
        powerEnd: pHigh,
        cadence,
        text: text || 'Enfriamiento',
      });
      totalDurationSeconds += duration;
    } else if (tagName === 'steadystate') {
      const power = parseFloat(node.getAttribute('Power') || '0.75');
      steps.push({
        id: `zwo_step_${stepIndex++}`,
        type: 'steady',
        durationSeconds: duration,
        powerStart: power,
        powerEnd: power,
        cadence,
        text,
      });
      totalDurationSeconds += duration;
    } else if (tagName === 'ramp') {
      const pLow = parseFloat(node.getAttribute('PowerLow') || '0.6');
      const pHigh = parseFloat(node.getAttribute('PowerHigh') || '1.0');
      steps.push({
        id: `zwo_step_${stepIndex++}`,
        type: 'ramp',
        durationSeconds: duration,
        powerStart: pLow,
        powerEnd: pHigh,
        cadence,
        text,
      });
      totalDurationSeconds += duration;
    } else if (tagName === 'intervalst') {
      const repeat = parseInt(node.getAttribute('Repeat') || '1', 10);
      const onDuration = parseFloat(node.getAttribute('OnDuration') || '30');
      const offDuration = parseFloat(node.getAttribute('OffDuration') || '30');
      const onPower = parseFloat(node.getAttribute('OnPower') || '1.0');
      const offPower = parseFloat(node.getAttribute('OffPower') || '0.5');
      const cadenceRest = node.getAttribute('CadenceResting') ? parseInt(node.getAttribute('CadenceResting'), 10) : undefined;

      for (let r = 0; r < repeat; r++) {
        steps.push({
          id: `zwo_step_${stepIndex++}`,
          type: 'interval',
          durationSeconds: onDuration,
          powerStart: onPower,
          powerEnd: onPower,
          cadence,
          text: `Intervalo ${r + 1}/${repeat} (Trabajo)`,
        });
        steps.push({
          id: `zwo_step_${stepIndex++}`,
          type: 'interval',
          durationSeconds: offDuration,
          powerStart: offPower,
          powerEnd: offPower,
          cadence: cadenceRest || cadence,
          text: `Recuperación ${r + 1}/${repeat}`,
        });
        totalDurationSeconds += (onDuration + offDuration);
      }
    } else if (tagName === 'freeride') {
      steps.push({
        id: `zwo_step_${stepIndex++}`,
        type: 'steady',
        durationSeconds: duration,
        powerStart: 0.65,
        powerEnd: 0.65,
        cadence,
        text: text || 'Ritmo libre',
      });
      totalDurationSeconds += duration;
    }
  }

  if (steps.length === 0) {
    throw new Error('No se encontraron bloques de entrenamiento legibles en el archivo .zwo');
  }

  return {
    id: `zwo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    description,
    author,
    totalDurationSeconds,
    steps,
  };
}

/**
 * Parsea un archivo Computrainer (.erg / .mrc)
 * @param {string} textContent
 * @param {string} [fileName]
 * @returns {Workout}
 */
export function parseErg(textContent, fileName = 'Entrenamiento ERG') {
  const lines = textContent.split(/\r?\n/);
  let name = fileName.replace(/\.(erg|mrc)$/i, '');
  let description = 'Entrenamiento importado desde formato .erg/.mrc';
  let isPercentage = false;
  let inCourseData = false;

  const dataPoints = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('FILE NAME =') || line.startsWith('DESCRIPTION =')) {
      const val = line.split('=')[1]?.trim();
      if (val) {
        if (line.startsWith('FILE NAME =')) name = val;
        else description = val;
      }
    } else if (line.includes('MINUTES') && line.includes('PERCENT')) {
      isPercentage = true;
    } else if (line === '[COURSE DATA]') {
      inCourseData = true;
      continue;
    } else if (line === '[END COURSE DATA]') {
      inCourseData = false;
      break;
    }

    if (inCourseData) {
      const parts = line.split(/\s+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        dataPoints.push({
          minute: parts[0],
          power: parts[1],
        });
      }
    }
  }

  if (dataPoints.length < 2) {
    throw new Error('El archivo .erg/.mrc no contiene suficientes puntos en [COURSE DATA].');
  }

  const steps = [];
  let totalDurationSeconds = 0;
  let stepIndex = 0;

  for (let i = 0; i < dataPoints.length - 1; i += 2) {
    const p1 = dataPoints[i];
    const p2 = dataPoints[i + 1] || dataPoints[i];
    const durationSeconds = Math.max(1, Math.round((p2.minute - p1.minute) * 60));

    // Convertir a ratio FTP si es % o dejar absoluto
    let powerStart = isPercentage ? p1.power / 100 : (p1.power > 3 ? p1.power / 200 : p1.power);
    let powerEnd = isPercentage ? p2.power / 100 : (p2.power > 3 ? p2.power / 200 : p2.power);

    const type = powerStart !== powerEnd ? 'ramp' : (powerStart >= 1.05 ? 'interval' : (powerStart < 0.65 ? 'warmup' : 'steady'));

    steps.push({
      id: `erg_step_${stepIndex++}`,
      type,
      durationSeconds,
      powerStart: Number(powerStart.toFixed(2)),
      powerEnd: Number(powerEnd.toFixed(2)),
      text: `Bloque ${Math.floor(i / 2) + 1}`,
    });
    totalDurationSeconds += durationSeconds;
  }

  return {
    id: `erg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    description,
    author: 'Computrainer / Manual',
    totalDurationSeconds,
    steps,
  };
}

/**
 * Autodetecta y parsea cualquier archivo de entrenamiento compatible
 * @param {string} content
 * @param {string} fileName
 * @returns {Workout}
 */
export function parseWorkoutFile(content, fileName = '') {
  const clean = content.trim();
  if (clean.startsWith('<') || fileName.toLowerCase().endsWith('.zwo') || clean.includes('<workout_file>')) {
    return parseZwo(clean, fileName);
  }
  if (clean.includes('[COURSE DATA]') || fileName.toLowerCase().endsWith('.erg') || fileName.toLowerCase().endsWith('.mrc')) {
    return parseErg(clean, fileName);
  }
  // Intentar parsear como JSON si corresponde
  try {
    const json = JSON.parse(clean);
    if (json.steps && Array.isArray(json.steps)) {
      return json;
    }
  } catch {}

  throw new Error('Formato no reconocido. Por favor, sube un archivo .zwo (Zwift) o .erg/.mrc (Computrainer).');
}
