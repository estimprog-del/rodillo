/* gpx.js - GPX/TCX Parser and Exporter for RodilloInt Web */

/**
 * Calculates Haversine distance in km between two coordinate points
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371.0; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Parses a GPX or TCX file text and returns points, elevations, and cumulative distances
 */
function parseRoute(fileText) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(fileText, 'application/xml');
    
    // Check if parser returned an error
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.error('XML parsing error:', parserError.textContent);
      return null;
    }

    const points = [];
    const elevations = [];

    // 1. Try parsing GPX format
    const trkpts = doc.getElementsByTagName('trkpt');
    if (trkpts.length > 0) {
      for (let i = 0; i < trkpts.length; i++) {
        const item = trkpts[i];
        const lat = parseFloat(item.getAttribute('lat'));
        const lon = parseFloat(item.getAttribute('lon'));
        
        if (!isNaN(lat) && !isNaN(lon)) {
          points.push({ lat, lon });
          
          const eleNode = item.getElementsByTagName('ele')[0];
          const ele = eleNode ? parseFloat(eleNode.textContent) : 0.0;
          elevations.push(isNaN(ele) ? 0.0 : ele);
        }
      }
    } else {
      // 2. Try parsing TCX format (Trackpoint)
      const allElements = doc.getElementsByTagName('*');
      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];
        if (element.nodeName.endsWith('Trackpoint')) {
          let lat = null;
          let lon = null;
          let alt = 0.0;

          const children = element.getElementsByTagName('*');
          for (let j = 0; j < children.length; j++) {
            const child = children[j];
            const nodeName = child.nodeName;
            
            if (nodeName.endsWith('LatitudeDegrees')) {
              lat = parseFloat(child.textContent);
            } else if (nodeName.endsWith('LongitudeDegrees')) {
              lon = parseFloat(child.textContent);
            } else if (nodeName.endsWith('AltitudeMeters')) {
              const parsedAlt = parseFloat(child.textContent);
              alt = isNaN(parsedAlt) ? 0.0 : parsedAlt;
            }
          }

          if (lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)) {
            points.push({ lat, lon });
            elevations.push(alt);
          }
        }
      }
    }

    if (points.length === 0) {
      console.warn('No GPS points found in the file.');
      return null;
    }

    // Calculate cumulative distances in km
    const distances = [0.0];
    let totalDist = 0.0;
    for (let i = 1; i < points.length; i++) {
      totalDist += calculateDistance(
        points[i - 1].lat, points[i - 1].lon,
        points[i].lat, points[i].lon
      );
      distances.push(totalDist);
    }

    return {
      points,
      elevations,
      distances
    };
  } catch (e) {
    console.error('Error parsing route file:', e);
    return null;
  }
}

/**
 * Exports a session and its second-by-second telemetries into a GPX file and triggers download
 */
function exportSession(session, sensorData, userName = 'Usuario') {
  try {
    const formatDateUTC = (timestamp) => {
      const date = new Date(timestamp);
      return date.toISOString().replace(/\.\d+Z$/, 'Z');
    };

    const formatDateLocal = (timestamp) => {
      const date = new Date(timestamp);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const startTimeUTC = formatDateUTC(session.startTime);
    const dateString = formatDateLocal(session.startTime);

    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gpx += '<gpx version="1.1" creator="RodilloInt Web" xmlns="http://www.topografix.com/GPX/1/1" ';
    gpx += 'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" ';
    gpx += 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
    gpx += 'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd ';
    gpx += 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd">\n';
    gpx += `  <metadata>\n    <time>${startTimeUTC}</time>\n  </metadata>\n`;
    gpx += '  <trk>\n';
    gpx += `    <name>Entrenamiento RodilloInt - ${userName} - ${dateString}</name>\n`;
    gpx += '    <trkseg>\n';

    sensorData.forEach((point) => {
      const lat = point.latitude !== null ? point.latitude.toFixed(6) : '0.000000';
      const lon = point.longitude !== null ? point.longitude.toFixed(6) : '0.000000';
      const ele = (point.elevation !== null && point.elevation !== undefined) ? point.elevation.toFixed(1) : (point.slope !== null ? point.slope.toFixed(1) : '0.0');
      const timeStr = formatDateUTC(point.timestamp);
      const powerVal = point.power !== null ? point.power : 0;
      const hrVal = point.heartRate !== null ? point.heartRate : 0;
      const cadVal = point.cadence !== null ? point.cadence : 0;

      gpx += `      <trkpt lat="${lat}" lon="${lon}">\n`;
      gpx += `        <ele>${ele}</ele>\n`;
      gpx += `        <time>${timeStr}</time>\n`;
      gpx += '        <extensions>\n';
      gpx += `          <power>${powerVal}</power>\n`;
      gpx += '          <gpxtpx:TrackPointExtension>\n';
      gpx += `            <gpxtpx:hr>${hrVal}</gpxtpx:hr>\n`;
      gpx += `            <gpxtpx:cad>${cadVal}</gpxtpx:cad>\n`;
      gpx += '          </gpxtpx:TrackPointExtension>\n';
      gpx += '        </extensions>\n';
      gpx += '      </trkpt>\n';
    });

    gpx += '    </trkseg>\n';
    gpx += '  </trk>\n';
    gpx += '</gpx>';

    // Trigger Browser Download
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Entrenamiento_RodilloInt_${session.id}_${dateString.replace(/\//g, '-')}.gpx`;
    document.body.appendChild(link);
    link.click();
    
    // Clean up
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log(`GPX Exported successfully for session: ${session.id}`);
    return true;
  } catch (e) {
    console.error('Error exporting session to GPX:', e);
    return false;
  }
}

/**
 * Parses a GPX/TCX file asynchronously using a Web Worker to avoid blocking the main UI thread.
 */
function parseRouteAsync(fileText) {
  return new Promise((resolve, reject) => {
    // Check if Web Workers are supported
    if (typeof Worker === 'undefined') {
      console.warn('[GPX Parser] Web Workers no soportados en este navegador, usando fallback en el hilo principal.');
      const result = parseRoute(fileText);
      if (result) resolve(result);
      else reject(new Error('Error al parsear el archivo de ruta en el hilo principal.'));
      return;
    }

    try {
      // Define parseRouteWithRegExp inside the worker scope
      const workerCode = `
        function calculateDistance(lat1, lon1, lat2, lon2) {
          const R = 6371.0;
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        }

        function parseRouteWithRegExp(fileText) {
          const points = [];
          const elevations = [];

          const trkptRegex = /<trkpt\\s+lat=["'](-?\\d+(?:\\.\\d+)?)["']\\s+lon=["'](-?\\d+(?:\\.\\d+)?)["']\\s*>([\\s\\S]*?)<\\/trkpt>/gi;
          const eleRegex = /<ele>([\\s\\S]*?)<\\/ele>/i;
          
          let match;
          let hasGpxPoints = false;
          
          while ((match = trkptRegex.exec(fileText)) !== null) {
            hasGpxPoints = true;
            const lat = parseFloat(match[1]);
            const lon = parseFloat(match[2]);
            const inner = match[3];
            const eleMatch = eleRegex.exec(inner);
            const ele = eleMatch ? parseFloat(eleMatch[1]) : 0.0;
            
            if (!isNaN(lat) && !isNaN(lon)) {
              points.push({ lat, lon });
              elevations.push(isNaN(ele) ? 0.0 : ele);
            }
          }

          if (!hasGpxPoints) {
            const trackpointRegex = /<Trackpoint\\s*>([\\s\\S]*?)<\\/Trackpoint>/gi;
            const latRegex = /<LatitudeDegrees>(-?\\d+(?:\\.\\d+)?)<\\/LatitudeDegrees>/i;
            const lonRegex = /<LongitudeDegrees>(-?\\d+(?:\\.\\d+)?)<\\/LongitudeDegrees>/i;
            const altRegex = /<AltitudeMeters>(-?\\d+(?:\\.\\d+)?)<\\/AltitudeMeters>/i;

            while ((match = trackpointRegex.exec(fileText)) !== null) {
              const inner = match[1];
              const latMatch = latRegex.exec(inner);
              const lonMatch = lonRegex.exec(inner);
              const altMatch = altRegex.exec(inner);

              if (latMatch && lonMatch) {
                const lat = parseFloat(latMatch[1]);
                const lon = parseFloat(lonMatch[1]);
                const ele = altMatch ? parseFloat(altMatch[1]) : 0.0;

                if (!isNaN(lat) && !isNaN(lon)) {
                  points.push({ lat, lon });
                  elevations.push(isNaN(ele) ? 0.0 : ele);
                }
              }
            }
          }

          if (points.length === 0) return null;

          const distances = [0.0];
          let totalDist = 0.0;
          for (let i = 1; i < points.length; i++) {
            totalDist += calculateDistance(
              points[i - 1].lat, points[i - 1].lon,
              points[i].lat, points[i].lon
            );
            distances.push(totalDist);
          }

          return { points, elevations, distances };
        }

        self.onmessage = function(e) {
          try {
            const result = parseRouteWithRegExp(e.data);
            if (result) {
              self.postMessage({ success: true, data: result });
            } else {
              self.postMessage({ success: false, error: 'No se encontraron puntos de ruta válidos.' });
            }
          } catch (err) {
            self.postMessage({ success: false, error: err.message });
          }
        };
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);

      worker.onmessage = function(e) {
        // Clean up worker and URL object
        worker.terminate();
        URL.revokeObjectURL(workerUrl);

        if (e.data.success) {
          resolve(e.data.data);
        } else {
          reject(new Error(e.data.error));
        }
      };

      worker.onerror = function(err) {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        reject(err);
      };

      worker.postMessage(fileText);
    } catch (err) {
      console.warn('[GPX Parser Worker] Error al instanciar Worker, usando fallback:', err);
      const result = parseRoute(fileText);
      if (result) resolve(result);
      else reject(err);
    }
  });
}

// Export GPX functions globally
window.GpxManager = {
  parseRoute,
  parseRouteAsync,
  exportSession
};
