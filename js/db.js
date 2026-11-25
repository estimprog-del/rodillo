/* db.js - IndexedDB Manager for RodilloInt Web */
import { sanitizeName } from "./utils/sanitize.js";
import { encryptBackupJson, DEFAULT_BACKUP_PASSWORD } from "./utils/backupCrypto.js";

const DB_NAME = 'RodilloIntDB';
const DB_VERSION = 4;

let dbInstance = null;

function validateUserName(name) {
  const clean = sanitizeName(name, 80);
  if (!clean || clean.length > 80) {
    throw new Error('El nombre del perfil debe tener entre 1 y 80 caracteres.');
  }
  return clean;
}

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

      if (!db.objectStoreNames.contains('saved_routes')) {
        const savedRouteStore = db.createObjectStore('saved_routes', { keyPath: 'id', autoIncrement: true });
        savedRouteStore.createIndex('userId', 'userId', { unique: false });
      }

      if (!db.objectStoreNames.contains('records')) {
        const recordsStore = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
        recordsStore.createIndex('userId', 'userId', { unique: false });
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
  const name = validateUserName(user?.name);
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');
    
    // Add default values
    const newUser = {
      uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      name,
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
      updatedAt: Date.now(),
      ...user
    };

    const request = store.add(newUser);

    request.onsuccess = () => resolve(request.result); // Returns the generated ID
    request.onerror = () => reject(request.error);
  });
}

async function updateUser(user) {
  const validatedUser = { ...user, name: validateUserName(user?.name), updatedAt: Date.now() };
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');
    const request = store.put(validatedUser);

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

async function getSavedRoutes(userId) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['saved_routes'], 'readonly');
    const store = transaction.objectStore('saved_routes');
    const request = store.index('userId').getAll(Number(userId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function saveRoute(route) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['saved_routes'], 'readwrite');
    const request = transaction.objectStore('saved_routes').add({
      userId: Number(route.userId),
      name: sanitizeName(route.name, 120),
      fileName: sanitizeName(route.fileName, 120),
      gpxText: String(route.gpxText),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteSavedRoute(id) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['saved_routes'], 'readwrite');
    const request = transaction.objectStore('saved_routes').delete(Number(id));
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
      gpxPath: session.gpxPath ? sanitizeName(session.gpxPath, 120) : null,
      routeName: session.routeName || session.gpxPath
        ? sanitizeName(session.routeName || session.gpxPath, 120)
        : null,
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
      updatedAt: Date.now(),
      ...session
    };

    const request = store.add(newSession);

    request.onsuccess = () => resolve(request.result); // Returns generated ID
    request.onerror = () => reject(request.error);
  });
}

async function updateSession(session) {
  const db = await initDb();
  const updatedSession = { ...session, updatedAt: Date.now() };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    const request = store.put(updatedSession);

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
const BACKUP_STORES = ['users', 'sessions', 'sensor_data', 'records'];
const ALL_BACKUP_STORES = [...BACKUP_STORES, 'saved_routes'];
const BACKUP_STATUS_KEY = 'rodilloint_last_backup';
// Límite de tamaño para archivos de backup restaurables (100 MB).
// Se permite restaurar backups grandes generados tras mucho uso.
const MAX_BACKUP_FILE_BYTES = 100 * 1024 * 1024;

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

/**
 * Exporta solo los datos de un usuario específico para backup en Google Drive.
 * Incluye: el usuario, sus sesiones, su telemetría y sus rutas guardadas.
 */
export async function exportBackupJsonForUser(userId) {
  const db = await initDb();
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) {
    throw new Error('ID de usuario no válido.');
  }

  const allBackupStores = ALL_BACKUP_STORES;
  const localStorageData = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith('rodilloint_')) {
      localStorageData[key] = localStorage.getItem(key);
    }
  }

  const exportData = {
    format: 'RodilloInt backup',
    version: 3,
    createdAt: new Date().toISOString(),
    automatic: false,
    scope: 'user',
    userId: numericUserId,
    localStorage: localStorageData,
  };

  // Usuarios: solo el usuario vinculado
  const users = await new Promise((resolve, reject) => {
    const transaction = db.transaction(['users'], 'readonly');
    const request = transaction.objectStore('users').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  exportData.users = users.filter((u) => Number(u.id) === numericUserId);

  // Sesiones: solo las de este usuario
  const sessions = await new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const index = store.index('userId');
    const request = index.getAll(numericUserId);
    request.onsuccess = () => {
      const result = request.result || [];
      result.sort((a, b) => b.startTime - a.startTime);
      resolve(result);
    };
    request.onerror = () => reject(request.error);
  });
  exportData.sessions = sessions;

  // Telemetría: solo puntos de las sesiones de este usuario
  const sessionIds = sessions.map((s) => s.id);
  const sensorData = await new Promise((resolve, reject) => {
    const transaction = db.transaction(['sensor_data'], 'readonly');
    const store = transaction.objectStore('sensor_data');
    const index = store.index('sessionId');
    const allPoints = [];
    let pending = sessionIds.length;
    if (pending === 0) {
      resolve(allPoints);
      return;
    }
    for (const sid of sessionIds) {
      const request = index.getAll(sid);
      request.onsuccess = () => {
        const result = request.result || [];
        allPoints.push(...result);
        pending -= 1;
        if (pending === 0) {
          allPoints.sort((a, b) => a.timestamp - b.timestamp);
          resolve(allPoints);
        }
      };
      request.onerror = () => reject(request.error);
    }
  });
  exportData.sensor_data = sensorData;

  // Rutas guardadas: solo las de este usuario
  const savedRoutes = await new Promise((resolve, reject) => {
    const transaction = db.transaction(['saved_routes'], 'readonly');
    const store = transaction.objectStore('saved_routes');
    const index = store.index('userId');
    const request = index.getAll(numericUserId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  exportData.saved_routes = savedRoutes;

  exportData.recordCounts = {
    users: exportData.users?.length || 0,
    sessions: exportData.sessions?.length || 0,
    sensorDataPoints: exportData.sensor_data?.length || 0,
    savedRoutes: exportData.saved_routes?.length || 0,
  };

  return JSON.stringify(exportData);
}

export async function exportBackupJson({ scope = 'all', sessionId = null } = {}) {
  const db = await initDb();
  if (!['all', 'users', 'history', 'session'].includes(scope)) {
    throw new Error('Tipo de backup no válido.');
  }
  if (scope === 'session' && (sessionId === null || !Number.isFinite(Number(sessionId)))) {
    throw new Error('Selecciona una sesión válida.');
  }
  const stores = scope === 'all'
    ? ALL_BACKUP_STORES
    : scope === 'users'
      ? ['users']
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
    version: 3,
    createdAt: new Date().toISOString(),
    automatic: false,
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
    savedRoutes: exportData.saved_routes?.length || 0,
  };
  return JSON.stringify(exportData);
}

export async function exportAllData({ automatic = false, scope = 'all', sessionId = null, password = undefined, unencrypted = false } = {}) {
  const db = await initDb();
  if (!['all', 'users', 'history', 'session'].includes(scope)) {
    throw new Error('Tipo de backup no válido.');
  }
  if (scope === 'session' && (sessionId === null || !Number.isFinite(Number(sessionId)))) {
    throw new Error('Selecciona una sesión válida.');
  }
  const stores = scope === 'all'
    ? ALL_BACKUP_STORES
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
    version: 3,
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
    savedRoutes: exportData.saved_routes?.length || 0,
  };

  const timestamp = new Date().toISOString().replace(/[.:]/g, '-').replace('T', '_').slice(0, 19);
  const plain = JSON.stringify(exportData, null, 2);
  const effectivePassword =
    password === undefined
      ? (unencrypted ? null : DEFAULT_BACKUP_PASSWORD)
      : password;
  let blob;
  let filename;
  if (effectivePassword) {
    const encrypted = await encryptBackupJson(plain, effectivePassword);
    blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' });
    filename = `RodilloInt_Backup_${scope}_${timestamp}.enc.json`;
  } else {
    blob = new Blob([plain], { type: 'application/json' });
    filename = `RodilloInt_Backup_${scope}_${timestamp}.json`;
  }
  downloadBlob(blob, filename);
  const sessionsCount = exportData.sessions?.length || 0;
  return recordBackupStarted({
    filename,
    scope,
    automatic,
    sessionsCount,
    savedRoutesCount: exportData.saved_routes?.length || 0,
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
  if (!file || typeof file.size !== 'number' || file.size > MAX_BACKUP_FILE_BYTES) {
    throw new Error(`El archivo de backup es demasiado grande (>${Math.round(MAX_BACKUP_FILE_BYTES / (1024 * 1024))} MB) o no es válido.`);
  }
  const data = JSON.parse(await file.text());
  if (!data || !ALL_BACKUP_STORES.some((storeName) => Array.isArray(data[storeName]))) {
    throw new Error('El archivo no contiene un backup válido de RodilloInt.');
  }
  const db = await initDb();
  const preview = {};
  for (const storeName of ALL_BACKUP_STORES) {
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
    if (!file || typeof file.size !== 'number' || file.size > MAX_BACKUP_FILE_BYTES) {
      throw new Error(`El archivo de backup es demasiado grande (>${Math.round(MAX_BACKUP_FILE_BYTES / (1024 * 1024))} MB) o no es válido.`);
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('El archivo no es un JSON válido.');
    }
    // Clon profundo para evitar prototype pollution (__proto__, constructor, etc.)
    try {
      data = JSON.parse(JSON.stringify(data));
    } catch (e) {
      throw new Error('El backup contiene datos no serializables.');
    }
    // Límites de seguridad para evitar DoS por archivos enormes
    const MAX = { users: 10000, sessions: 100000, saved_routes: 10000, sensor_data: 1000000 };
    for (const key of Object.keys(MAX)) {
      if (data[key] != null && (!Array.isArray(data[key]) || data[key].length > MAX[key])) {
        throw new Error(`Backup inválido: ${key} supera el límite permitido.`);
      }
    }
    if (!data || !ALL_BACKUP_STORES.some((storeName) => Array.isArray(data[storeName]))) {
      throw new Error('El archivo no contiene un backup válido de RodilloInt.');
    }
    for (const storeName of ALL_BACKUP_STORES) {
      if (data[storeName] && (!Array.isArray(data[storeName]) ||
          data[storeName].some((item) => !item || typeof item !== 'object'))) {
        throw new Error(`La sección ${storeName} del backup no es válida.`);
      }
    }
    if (Array.isArray(data.users)) {
      data.users = data.users.map((user) => {
        if (Array.isArray(user)) {
          throw new Error('El backup contiene un perfil no válido.');
        }
        return { ...user, name: validateUserName(user.name) };
      });
    }

    const db = await initDb();
    const storesToRestore = ALL_BACKUP_STORES.filter((storeName) => Array.isArray(data[storeName]));
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
export async function mergeBackupData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('El archivo no contiene un backup válido de RodilloInt.');
  }
  if (data.format !== 'RodilloInt backup') {
    throw new Error('El archivo no contiene un backup válido de RodilloInt.');
  }

  // Clon profundo para evitar prototype pollution (__proto__, constructor, etc.)
  try {
    data = JSON.parse(JSON.stringify(data));
  } catch (e) {
    throw new Error('El backup contiene datos no serializables.');
  }

  // Límites de seguridad para evitar DoS por archivos enormes
  const MAX = { users: 10000, sessions: 100000, saved_routes: 10000, sensor_data: 1000000 };
  for (const key of Object.keys(MAX)) {
    if (data[key] != null && (!Array.isArray(data[key]) || data[key].length > MAX[key])) {
      throw new Error(`Backup inválido: ${key} supera el límite permitido.`);
    }
  }

  const db = await initDb();
  const now = Date.now();

  if (Array.isArray(data.users)) {
    for (const remote of data.users) {
      if (!remote || typeof remote !== 'object') continue;
      const remoteId = Number(remote.id);
      let local = null;
      if (Number.isFinite(remoteId)) {
        local = await getUserById(remoteId);
      }
      const remoteUpdated = Number(remote.updatedAt) || 0;
      const localUpdated = Number(local?.updatedAt) || 0;
      if (!local || remoteUpdated >= localUpdated) {
        let safeName = "Usuario";
        try {
          safeName = validateUserName(remote.name);
        } catch (e) {
          safeName = String(remote.name || "Usuario").trim().slice(0, 80) || "Usuario";
        }
        const mergedUser = {
          ...remote,
          name: safeName,
          updatedAt: remoteUpdated || now,
        };
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(['users'], 'readwrite');
          const request = transaction.objectStore('users').put(mergedUser);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    }
  }

  if (Array.isArray(data.sessions)) {
    for (const remote of data.sessions) {
      if (!remote || typeof remote !== 'object') continue;
      const remoteId = Number(remote.id);
      let local = null;
      if (Number.isFinite(remoteId)) {
        local = await getSessionById(remoteId);
      }
      const remoteUpdated = Number(remote.updatedAt) || 0;
      const localUpdated = Number(local?.updatedAt) || 0;
      if (!local || remoteUpdated >= localUpdated) {
        const mergedSession = { ...remote, updatedAt: remoteUpdated || now };
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(['sessions'], 'readwrite');
          const request = transaction.objectStore('sessions').put(mergedSession);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    }
  }

  if (Array.isArray(data.saved_routes)) {
    for (const remote of data.saved_routes) {
      if (!remote || typeof remote !== 'object') continue;
      const remoteId = Number(remote.id);
      let local = null;
      if (Number.isFinite(remoteId)) {
        local = await new Promise((resolve, reject) => {
          const transaction = db.transaction(['saved_routes'], 'readonly');
          const request = transaction.objectStore('saved_routes').get(remoteId);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
      }
      const remoteUpdated = Number(remote.updatedAt) || 0;
      const localUpdated = Number(local?.updatedAt) || 0;
      if (!local || remoteUpdated >= localUpdated) {
        const mergedRoute = { ...remote, updatedAt: remoteUpdated || now };
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(['saved_routes'], 'readwrite');
          const request = transaction.objectStore('saved_routes').put(mergedRoute);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    }
  }

  if (Array.isArray(data.sensor_data)) {
    // Cargar todos los puntos existentes una sola vez para deduplicar en O(n)
    const allExisting = await new Promise((resolve, reject) => {
      const transaction = db.transaction(['sensor_data'], 'readonly');
      const request = transaction.objectStore('sensor_data').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const existingKeys = new Set(allExisting.map((point) => `${point.sessionId}:${point.timestamp}`));

    for (const remote of data.sensor_data) {
      if (!remote || typeof remote !== 'object') continue;
      const sessionId = Number(remote.sessionId);
      if (!Number.isFinite(sessionId)) continue;
      const key = `${sessionId}:${Number(remote.timestamp)}`;
      if (existingKeys.has(key)) continue;
      await insertSensorData({ ...remote, updatedAt: Number(remote.updatedAt) || now });
      existingKeys.add(key);
    }
  }

  if (data.localStorage && typeof data.localStorage === 'object') {
    Object.entries(data.localStorage).forEach(([key, value]) => {
      if (key.startsWith('rodilloint_') && typeof value === 'string') {
        localStorage.setItem(key, value);
      }
    });
  }

  localStorage.setItem('rodilloint_last_google_sync', new Date().toISOString());
  return true;
}

// Export database functions globally
// --- RECORD STORES (records) ---
async function getBestRecords(userId) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['records'], 'readonly');
    const store = transaction.objectStore('records');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.filter((r) => r.userId === Number(userId)));
    request.onerror = () => reject(request.error);
  });
}

async function saveRecord(userId, type, value) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['records'], 'readwrite');
    const store = transaction.objectStore('records');
    const request = store.add({ userId: Number(userId), type, value: Number(value), date: Date.now() });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const DbManager = {
  initDb,
  exportBackupJson,
  exportBackupJsonForUser,
  mergeBackupData,
  getAllUsers,
  getUserById,
  insertUser,
  updateUser,
  deleteUser,
  getSavedRoutes,
  saveRoute,
  deleteSavedRoute,
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
  getBestRecords,
  saveRecord,
  getBackupStatus,
  previewImportData,
  importAllData
};
window.DbManager = DbManager;
