/* db.js - IndexedDB Manager for RodilloInt Web */
const DB_NAME = 'RodilloIntDB';
const DB_VERSION = 1;

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
      totalDistance: 0.0,
      averageSpeed: 0.0,
      averagePower: 0,
      averageHeartRate: 0,
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

async function getAllSessions(userId) {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const index = store.index('userId');
    const request = index.getAll(Number(userId));

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
      distance: Number(data.distance) || 0.0
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
        distance: Number(data.distance) || 0.0
      });
    }
  });
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
  deleteDataForSession
};
