/* db.js - IndexedDB Manager for RodilloInt Web */
const DB_NAME = 'RodilloIntDB';
const DB_VERSION = 2;

let dbInstance = null;

function initDb() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Users Store
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
      }

      // 2. Sessions Store
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sessionStore.createIndex('userId', 'userId', { unique: false });
        sessionStore.createIndex('gpxPath', 'gpxPath', { unique: false });
      }

      // 3. Sensor Data Store (Telemetry second-by-second)
      if (!db.objectStoreNames.contains('sensor_data')) {
        const sensorDataStore = db.createObjectStore('sensor_data', { keyPath: 'id', autoIncrement: true });
        sensorDataStore.createIndex('sessionId', 'sessionId', { unique: false });
      }

      console.log('Database upgrade completed successfully');
    };
  });
}

// --- USER CRUD OPERATIONS ---
async function getAllUsers() {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['users'], 'readonly');
    const store = transaction.objectStore('users');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getUserById(id) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['users'], 'readonly');
    const store = transaction.objectStore('users');
    const request = store.get(Number(id));

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function insertUser(user) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');
    
    // Add default values
    const newUser = {
      uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      name: user.name,
      weight: Number(user.weight) || 75.0,
      ftp: Number(user.ftp) || 200,
      maxHeartRate: Number(user.maxHeartRate) || 190,
      age: Number(user.age) || 30,
      height: Number(user.height) || 175,
      imageUri: null,
      lastTrainerAddress: null,
      lastTrainerName: null,
      lastHrmAddress: null,
      lastHrmName: null,
      lastSpeedAddress: null,
      lastCadenceAddress: null,
      lastPowerAddress: null,
      ...user
    };

    const request = store.add(newUser);

    request.onsuccess = () => resolve(request.result); // Returns the generated ID
    request.onerror = () => reject(request.error);
  });
}

async function updateUser(user) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');
    const request = store.put(user);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteUser(id) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');
    const request = store.delete(Number(id));

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

// --- SESSIONS CRUD OPERATIONS ---
async function insertSession(session) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    
    const newSession = {
      userId: Number(session.userId) || 0,
      startTime: session.startTime || Date.now(),
      endTime: null,
      gpxPath: session.gpxPath || null,
      routeName: session.routeName || session.gpxPath || null,
      totalDistance: 0.0,
      averageSpeed: 0.0,
      averagePower: 0,
      averageHeartRate: 0,
      activeDuration: 0,
      totalDuration: 0,
      normalizedPower: 0,
      tss: 0,
      intensityFactor: 0,
      calories: 0,
      maxSpeed: 0,
      maxHeartRate: 0,
      virtualGear: null,
      gearRatio: null,
      routePoints: null,
      routeElevations: null,
      routeDistances: null,
      routeTotalAscent: 0,
      ...session
    };

    const request = store.add(newSession);

    request.onsuccess = () => resolve(request.result); // Returns generated ID
    request.onerror = () => reject(request.error);
  });
}

async function updateSession(session) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    const request = store.put(session);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getSessionById(id) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const request = store.get(Number(id));

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function getAllSessions(userId = null) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const index = store.index('userId');
    const request = userId === null || userId === undefined
      ? index.getAll()
      : index.getAll(Number(userId));

    request.onsuccess = () => {
      // Sort sessions descending by startTime
      const sessions = request.result || [];
      sessions.sort((a, b) => b.startTime - a.startTime);
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
  });
}

async function deleteSession(id) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    const request = store.delete(Number(id));

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function getBestSessionForRoute(userId, gpxPath) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const index = store.index('gpxPath');
    const request = index.getAll(gpxPath);

    request.onsuccess = () => {
      const sessions = request.result || [];
      const userSessions = sessions.filter(s => s.userId === Number(userId) && s.endTime !== null);
      if (userSessions.length === 0) {
        resolve(null);
        return;
      }
      
      // Select the session with minimum elapsed time (endTime - startTime)
      let best = userSessions[0];
      let minDuration = best.endTime - best.startTime;
      
      for (let i = 1; i < userSessions.length; i++) {
        const dur = userSessions[i].endTime - userSessions[i].startTime;
        if (dur < minDuration) {
          minDuration = dur;
          best = userSessions[i];
        }
      }
      resolve(best);
    };
    request.onerror = () => reject(request.error);
  });
}

// --- SENSOR DATA OPERATIONS ---
async function insertSensorData(data) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sensor_data'], 'readwrite');
    const store = transaction.objectStore('sensor_data');
    
    const request = store.add({
      sessionId: Number(data.sessionId),
      timestamp: data.timestamp || Date.now(),
      speed: data.speed !== undefined ? Number(data.speed) : null,
      power: data.power !== undefined ? Number(data.power) : null,
      cadence: data.cadence !== undefined ? Number(data.cadence) : null,
      heartRate: data.heartRate !== undefined ? Number(data.heartRate) : null,
      slope: data.slope !== undefined ? Number(data.slope) : null,
      elevation: data.elevation !== undefined ? Number(data.elevation) : null,
      latitude: data.latitude !== undefined ? Number(data.latitude) : null,
      longitude: data.longitude !== undefined ? Number(data.longitude) : null,
      distance: Number(data.distance) || 0.0,
      virtualGear: data.virtualGear !== undefined ? Number(data.virtualGear) : null,
      gearRatio: data.gearRatio !== undefined ? Number(data.gearRatio) : null
    });

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getSensorDataForSession(sessionId) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sensor_data'], 'readonly');
    const store = transaction.objectStore('sensor_data');
    const index = store.index('sessionId');
    const request = index.getAll(Number(sessionId));

    request.onsuccess = () => {
      const data = request.result || [];
      // Sort telemetry by timestamp ascending
      data.sort((a, b) => a.timestamp - b.timestamp);
      resolve(data);
    };
    request.onerror = () => reject(request.error);
  });
}

async function deleteDataForSession(sessionId) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sensor_data'], 'readwrite');
    const store = transaction.objectStore('sensor_data');
    const index = store.index('sessionId');
    const request = index.openCursor(Number(sessionId));

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve(true);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// Bulk insert telemetry points in a single IndexedDB transaction
async function insertSensorDataBulk(pointsArray) {
  if (!pointsArray || pointsArray.length === 0) return;
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sensor_data'], 'readwrite');
    const store = transaction.objectStore('sensor_data');
    
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
    
    for (const data of pointsArray) {
      store.add({
        sessionId: Number(data.sessionId),
        timestamp: data.timestamp || Date.now(),
        speed: data.speed !== undefined ? Number(data.speed) : null,
        power: data.power !== undefined ? Number(data.power) : null,
        cadence: data.cadence !== undefined ? Number(data.cadence) : null,
        heartRate: data.heartRate !== undefined ? Number(data.heartRate) : null,
        slope: data.slope !== undefined ? Number(data.slope) : null,
        elevation: data.elevation !== undefined ? Number(data.elevation) : null,
        latitude: data.latitude !== undefined ? Number(data.latitude) : null,
        longitude: data.longitude !== undefined ? Number(data.longitude) : null,
        distance: Number(data.distance) || 0.0,
        virtualGear: data.virtualGear !== undefined ? Number(data.virtualGear) : null,
        gearRatio: data.gearRatio !== undefined ? Number(data.gearRatio) : null
      });
    }
  });
}

// --- EXPORT/IMPORT ---
const BACKUP_STORES = ['users', 'sessions', 'sensor_data'];
const BACKUP_STATUS_KEY = 'rodilloint_last_backup';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function getBackupStatus() {
  try {
    const saved = localStorage.getItem(BACKUP_STATUS_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.warn('No se pudo leer el estado del backup:', error);
    return null;
  }
}

function recordBackupStarted(metadata) {
  const status = { ...metadata, initiatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(BACKUP_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    console.warn('No se pudo guardar el estado del backup en el navegador:', error);
  }
  window.dispatchEvent(new CustomEvent('rodilloint:backup-started', { detail: status }));
  return status;
}

export async function exportAllData({ automatic = false, scope = 'all', sessionId = null } = {}) {
  const db = await initDb();
  if (!['all', 'users', 'history', 'session'].includes(scope)) {
    throw new Error('Tipo de backup no válido.');
  }
  if (scope === 'session' && (sessionId === null || !Number.isFinite(Number(sessionId)))) {
    throw new Error('Selecciona una sesión válida.');
  }
  const stores = scope === 'all'
    ? BACKUP_STORES
    : scope === 'users'
      ? ['users']
      : scope === 'history'
        ? ['sessions', 'sensor_data']
        : ['sessions', 'sensor_data'];
  const localStorageData = {};
  if (scope === 'all') {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('rodilloint_')) {
        localStorageData[key] = localStorage.getItem(key);
      }
    }
  }
  const exportData = {
    format: 'RodilloInt backup',
    version: 2,
    createdAt: new Date().toISOString(),
    automatic,
    scope,
    localStorage: localStorageData,
  };

  for (const storeName of stores) {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    exportData[storeName] = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        let result = request.result;
        if (scope === 'session' && storeName === 'sessions') {
          result = result.filter((session) => session.id === Number(sessionId));
        } else if (scope === 'session' && storeName === 'sensor_data') {
          result = result.filter((point) => point.sessionId === Number(sessionId));
        }
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }
  exportData.recordCounts = {
    users: exportData.users?.length || 0,
    sessions: exportData.sessions?.length || 0,
    sensorDataPoints: exportData.sensor_data?.length || 0,
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `RodilloInt_Backup_${scope}_${timestamp}.json`;
  downloadBlob(blob, filename);
  const sessionsCount = exportData.sessions?.length || 0;
  return recordBackupStarted({
    filename,
    scope,
    automatic,
    sessionsCount,
    sizeBytes: blob.size,
  });
}

export async function exportAllDataCsv() {
  const db = await initDb();
  const [users, sessions, sensorData] = await Promise.all(
    BACKUP_STORES.map((storeName) => new Promise((resolve, reject) => {
      const request = db.transaction([storeName], 'readonly')
        .objectStore(storeName)
        .getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    })),
  );
  const usersById = new Map(users.map((user) => [Number(user.id), user.name]));
  const sessionsById = new Map(sessions.map((session) => [Number(session.id), session]));
  const headers = ['sesion_id', 'usuario', 'inicio', 'modo', 'ruta', 'timestamp', 'velocidad_kmh', 'potencia_w', 'cadencia_rpm', 'pulso_bpm', 'pendiente_pct', 'elevacion_m', 'latitud', 'longitud', 'distancia_km', 'marcha', 'relacion'];
  const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = sensorData.map((point) => {
    const session = sessionsById.get(Number(point.sessionId));
    return [
      point.sessionId,
      usersById.get(Number(session?.userId)) || '',
      session?.startTime ? new Date(session.startTime).toISOString() : '',
      session?.gpxPath ? 'Ruta' : 'Manual',
      session?.routeName || session?.gpxPath || '',
      point.timestamp ? new Date(point.timestamp).toISOString() : '',
      point.speed,
      point.power,
      point.cadence,
      point.heartRate,
      point.slope,
      point.elevation,
      point.latitude,
      point.longitude,
      point.distance,
      point.virtualGear,
      point.gearRatio,
    ].map(quote).join(';');
  });
  const blob = new Blob(['\uFEFF', [headers.join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `RodilloInt_Telemetria_${timestamp}.csv`;
  downloadBlob(blob, filename);
  const status = recordBackupStarted({
    filename,
    scope: 'csv',
    automatic: false,
    sessionsCount: sessions.length,
    sizeBytes: blob.size,
    telemetryPoints: rows.length,
  });
  return { ...status, rows: rows.length };
}

export async function previewImportData(file) {
  const data = JSON.parse(await file.text());
  if (!data || !BACKUP_STORES.some((storeName) => Array.isArray(data[storeName]))) {
    throw new Error('El archivo no contiene un backup válido de RodilloInt.');
  }
  const db = await initDb();
  const preview = {};
  for (const storeName of BACKUP_STORES) {
    if (!Array.isArray(data[storeName])) continue;
    const existing = await new Promise((resolve, reject) => {
      const request = db.transaction([storeName], 'readonly')
        .objectStore(storeName)
        .getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const existingIds = new Set(existing.map(String));
    const overwrites = data[storeName].filter((item) =>
      item?.id !== undefined && existingIds.has(String(item.id))).length;
    preview[storeName] = {
      incoming: data[storeName].length,
      overwrites,
      additions: data[storeName].length - overwrites,
    };
  }
  return preview;
}

// Restaurar desde un archivo JSON de Backup
export async function importAllData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || !BACKUP_STORES.some((storeName) => Array.isArray(data[storeName]))) {
      throw new Error('El archivo no contiene un backup válido de RodilloInt.');
    }
    for (const storeName of BACKUP_STORES) {
      if (data[storeName] && (!Array.isArray(data[storeName]) ||
          data[storeName].some((item) => !item || typeof item !== 'object'))) {
        throw new Error(`La sección ${storeName} del backup no es válida.`);
      }
    }

    const db = await initDb();
    const storesToRestore = BACKUP_STORES.filter((storeName) => Array.isArray(data[storeName]));
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(storesToRestore, 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transacción cancelada.'));
      for (const storeName of storesToRestore) {
        const store = transaction.objectStore(storeName);
        data[storeName].forEach((item) => store.put(item));
      }
    });

    if (data.localStorage && typeof data.localStorage === 'object') {
      Object.entries(data.localStorage).forEach(([key, value]) => {
        if (key.startsWith('rodilloint_') && typeof value === 'string') {
          localStorage.setItem(key, value);
        }
      });
    }
    alert("Backup restaurado correctamente. Recargando...");
    location.reload();
    return true;
  } catch (err) {
    console.error("Error al restaurar backup:", err);
    alert(`Error al restaurar el archivo de backup: ${err.message}`);
    return false;
  }
}
// Export database functions globally
window.DbManager = {
  initDb,
  getAllUsers,
  getUserById,
  insertUser,
  updateUser,
  deleteUser,
  insertSession,
  updateSession,
  getSessionById,
  getAllSessions,
  deleteSession,
  getBestSessionForRoute,
  insertSensorData,
  insertSensorDataBulk,
  getSensorDataForSession,
  deleteDataForSession,
  exportAllData,
  exportAllDataCsv,
  getBackupStatus,
  previewImportData,
  importAllData
};
