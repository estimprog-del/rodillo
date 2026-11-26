import { state, saveStateToLocalStorage } from "./state.js";
import { showToast } from "./toast.js";
import { DbManager } from "../db.js";
import { encryptBackupJson, decryptBackupJson, isEncryptedBackup, DEFAULT_BACKUP_PASSWORD } from "../utils/backupCrypto.js";
import { loadProfilesGrid, selectUser } from "../core/userProfile.js";

// Client ID por defecto (público, restringido por origen en Google Cloud Console).
// Se puede sobreescribir con VITE_GOOGLE_CLIENT_ID en tiempo de build.
const CLIENT_ID = (import.meta.env?.VITE_GOOGLE_CLIENT_ID || "745504557715-mspvncfrqj1pvbod06rjq1806epuq52i.apps.googleusercontent.com").trim();
const BACKUP_FILE_NAME = "rodilloint-backup.json";

// Scopes separados: login básico (siempre) y permisos de Drive (solo cuando se necesita)
const GOOGLE_SCOPES_BASIC = "openid email profile";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SCOPES = `${GOOGLE_SCOPES_BASIC} ${DRIVE_SCOPE}`;

let accessToken = null;
let tokenClient = null;
let accountEmail = null;
let accountName = null;
let accountPicture = null;
let tokenExpiresAt = null;
let isConnecting = false;
let pushTimer = null;
// Indica si se han concedido permisos de Drive (drive.appdata)
let drivePermissionsGranted = false;

// Contador de reintentos persistente para cambio de cuenta
let googleLoginRetryCount = 0;
const MAX_GOOGLE_LOGIN_RETRIES = 3;

// --- Gestión de sesión de Google en sessionStorage ---
const GOOGLE_SESSION_KEY = "rodilloint_google_session";
const TOKEN_TTL_MS = 3600000; // 1 hora

// Token de Google se mantiene SOLO en memoria (no en sessionStorage/localStorage)
// para reducir el riesgo de robo por XSS o extensiones maliciosas.
function saveGoogleSession() {
  if (!accessToken || !accountEmail) return;
  tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
}

function restoreGoogleSession() {
  // No se restaura desde almacenamiento: el usuario debe reconectar tras recargar.
}

function clearGoogleSession() {
  // No hay nada que limpiar en almacenamiento persistente.
}

function clearTimers() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (window._rodillointGoogleSyncInterval) {
    clearInterval(window._rodillointGoogleSyncInterval);
    window._rodillointGoogleSyncInterval = null;
  }
}

export function isGoogleConfigured() {
  return Boolean(CLIENT_ID);
}

function waitForGoogle(timeoutMs = 8000) {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Google Identity Services no se cargó."));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function initTokenClient(force = false) {
  if (!force && tokenClient && window.google?.accounts?.oauth2) return tokenClient;
  // Cuando force=true o no hay tokenClient, crear uno nuevo (important al cambiar de cuenta)
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  });
  return tokenClient;
}

/**
 * Solicita un token de acceso con los scopes indicados.
 * @param {string} scopes - Scopes separados por espacios.
 * @param {string} prompt - Tipo de prompt (ej. "consent select_account").
 */
function requestAccessToken(scopes, prompt = "") {
  return new Promise((resolve, reject) => {
    if (!isGoogleConfigured()) {
      reject(new Error("Falta VITE_GOOGLE_CLIENT_ID."));
      return;
    }
    initTokenClient();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      console.warn("[GoogleSync] Timeout esperando respuesta de Google (60s). El popup puede estar bloqueado o lento.");
      finish(reject, new Error("GOOGLE_TIMEOUT"));
    }, 60000);
    tokenClient.callback = (resp) => {
      console.log("[GoogleSync] callback GIS recibido:", resp?.error ? "ERROR" : "OK", resp?.access_token ? "token presente" : "sin token");
      if (resp?.error) {
        finish(reject, new Error(resp.error));
        return;
      }
      accessToken = resp.access_token;
      finish(resolve, accessToken);
    };
    console.log(`[GoogleSync] Ejecutando tokenClient.requestAccessToken() con scopes: ${scopes}`);
    showToast("Conectando con Google...", "info");
    try {
      tokenClient.requestAccessToken(scopes ? { scopes, prompt } : { prompt });
      console.log("[GoogleSync] requestAccessToken ejecutado sin excepción");
    } catch (e) {
      console.error("[GoogleSync] requestAccessToken lanzó excepción:", e);
      tokenClient = null; // Reiniciar cliente en siguiente intento
      finish(reject, e);
    }
  });
}

/**
 * Solicita permisos de Google Drive (drive.appdata) al usuario.
 * Se llama solo cuando se va a subir o descargar un backup.
 */
export async function requestDriveAccess() {
  if (!isGoogleConfigured()) {
    showToast("Google Drive no está configurado (falta VITE_GOOGLE_CLIENT_ID).", "warning");
    return false;
  }
  try {
    // Si ya tenemos permisos de Drive, no volver a pedir
    if (drivePermissionsGranted && accessToken) {
      return true;
    }
    console.log("[GoogleSync] Solicitando permisos de Drive...");
    await requestAccessToken(SCOPES, "consent select_account");
    // Verificar que el token incluye el scope de Drive
    // (GIS no nos dice directamente qué scopes se concedieron, así que probamos una llamada a Drive)
    drivePermissionsGranted = true;
    saveGoogleSession();
    updateStatusUI();
    showToast(
    "Permisos de Google Drive concedidos. Los backups se guardarán en la carpeta appDataFolder de tu cuenta. La app no accede a otros archivos de tu Drive.",
    "success"
  );
    return true;
  } catch (error) {
    console.error("Error solicitando permisos de Drive:", error);
    showToast(error?.message || "No se pudieron conceder permisos de Drive.", "error");
    return false;
  }
}

async function driveFetch(url, options = {}) {
  if (!accessToken) {
    throw new Error("Token de Google no disponible. Pulsa 'Conectar Google'.");
  }
  let res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401) {
    accessToken = null;
    clearGoogleSession();
    updateStatusUI();
    throw new Error("Sesión de Google expirada. Pulsa 'Conectar Google' de nuevo.");
  }
  if (res.status === 403) {
    const text = await res.text();
    if (text.includes("insufficientPermissions") || text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
      // No tenemos permisos de Drive. No abrir popup automáticamente;
      // el usuario los concederá desde el indicador del header o botón de ajustes.
      drivePermissionsGranted = false;
      updateStatusUI();
      throw new Error("DRIVE_PERMISSIONS_REQUIRED");
    }
    throw new Error(`Drive API 403: ${text}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text}`);
  }
  // Si llegamos aquí, la operación a Drive tuvo éxito: marcar permisos como concedidos
  drivePermissionsGranted = true;
  saveGoogleSession();
  return res;
}

async function fetchAccountProfile() {
  const res = await driveFetch("https://www.googleapis.com/oauth2/v3/userinfo");
  const data = await res.json();
  accountEmail = data.email || null;
  accountName = data.name || null;
  accountPicture = data.picture || null;
  return data;
}

async function findBackupFile() {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${BACKUP_FILE_NAME}'&fields=files(id,name,modifiedTime,size)`
  );
  const data = await res.json();
  return Array.isArray(data.files) && data.files.length ? data.files[0] : null;
}

export async function connectGoogle(forceSelectAccount = true) {
  console.log("[GoogleSync] connectGoogle llamado");
  console.log("[GoogleSync] isConnecting:", isConnecting, "tokenClient:", !!tokenClient, "google:", !!window.google?.accounts?.oauth2);

  // Si hay una conexión en curso, reseteamos isConnecting por seguridad
  if (isConnecting) {
    console.warn("[GoogleSync] isConnecting estaba en true, reseteando por seguridad");
    isConnecting = false;
  }

  isConnecting = true;
  // Deshabilitar botones de Google mientras se conecta
  const syncBtn = document.getElementById("btn-google-user-sync");
  const connectBtn = document.getElementById("btn-google-connect");
  syncBtn?.setAttribute("disabled", "true");
  connectBtn?.setAttribute("disabled", "true");
  // Timeout de seguridad: si algo falla gravemente, resetear isConnecting tras 70s
  const safetyTimer = setTimeout(() => {
    console.warn("[GoogleSync] Timeout de seguridad: reseteando isConnecting tras 70s");
    isConnecting = false;
    syncBtn?.removeAttribute("disabled");
    connectBtn?.removeAttribute("disabled");
  }, 70000);

  try {
    // GIS debe haberse cargado en initGoogleSync(). Si no, no hay popup posible sin romper activación.
    if (!tokenClient) {
      if (window.google?.accounts?.oauth2) {
        // Forzamos creación nueva de tokenClient para evitar estado sesgado de cuenta anterior
        tokenClient = initTokenClient(true);
        console.log("[GoogleSync] tokenClient creado en connectGoogle (forzado)");
      } else {
        throw new Error("Google Identity Services no cargó. Recarga la página.");
      }
    }
    // Solo autenticación básica (sin permisos de Drive aún)
    // Usamos Promise.race para asegurar que siempre se resuelva, incluso si el popup
    // se bloquea silenciosamente y el callback nunca llega.
    console.log("[GoogleSync] Llamando a requestAccessToken con scopes básicos:", GOOGLE_SCOPES_BASIC);

    // Forzamos prompt: select_account para que GIS muestre el selector de cuentas
    // Esto es crítico al cambiar de cuenta después de un login exitoso con otra cuenta
    const prompt = forceSelectAccount ? "select_account" : "";

    // Bucle de reintentos en lugar de recursión, con contador persistente
    for (let attempt = googleLoginRetryCount; attempt < MAX_GOOGLE_LOGIN_RETRIES; attempt++) {
      googleLoginRetryCount = attempt + 1; // Actualizar contador para próxima vez

      await Promise.race([
        requestAccessToken(GOOGLE_SCOPES_BASIC, prompt),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("POPUP_TIMEOUT")), 20000)
        ),
      ]);

      // Si llegamos aquí, el login fue exitoso
      await fetchAccountProfile();
      saveGoogleSession();
      updateStatusUI();
      showToast(`Conectado a Google: ${accountEmail}`, "success");
      // Resetear contador de reintentos tras éxito
      googleLoginRetryCount = 0;
      return;
    }

    // Si salimos del bucle, todos los reintentos fallaron
    showToast(
      `No se pudo conectar con Google después de ${MAX_GOOGLE_LOGIN_RETRIES} intentos. Por favor, permite popups para localhost:5173 y selecciona la cuenta.`,
      "error"
    );
    isConnecting = false;
    clearTimeout(safetyTimer);
    const syncBtn = document.getElementById("btn-google-user-sync");
    const connectBtn = document.getElementById("btn-google-connect");
    syncBtn?.removeAttribute("disabled");
    connectBtn?.removeAttribute("disabled");
    return;

  } catch (error) {
    console.error("Error conectando con Google:", error);
    if (error.message === "GOOGLE_TIMEOUT" || error.message === "POPUP_TIMEOUT") {
      // Incrementar contador de reintentos
      googleLoginRetryCount++;
      
      // Mensajes progresivos según número de intento
      let retryMsg;
      if (googleLoginRetryCount === 1) {
        retryMsg = "El navegador bloqueó el popup de Google. Esto pasa comúnmente al cambiar de cuenta. Por favor, permite popups manualmente.";
      } else if (googleLoginRetryCount === 2) {
        retryMsg = "Intento secundario fallido. Si ves un icono 🔒 en la barra de direcciones, haz clic y selecciona 'Permitir popups y redireccionamientos'.";
      } else {
        retryMsg = "Se agotaron los intentos automáticos. Debes permitir popups para localhost:5173 en la configuración de tu navegador.";
      }
      
      showToast(retryMsg, "warning");
      
      // Delay largo para que el usuario pueda cambiar la configuración del navegador
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      // Verificar si todavía tenemos sesion activa que interfiere
      if (googleLoginRetryCount < MAX_GOOGLE_LOGIN_RETRIES) {
        // Intentar de nuevo con forceSelectAccount = true para asegurar selector de cuentas
        await connectGoogle(true);
        return;
      }
      
      // Se agotaron los reintentos definitivos
      showToast(
        "No se pudo conectar con Google automáticamente. " +
        "Por favor, habilita popups para localhost:5173 en tu navegador e intenta de nuevo.", 
        "error"
      );
      isConnecting = false;
      clearTimeout(safetyTimer);
      const syncBtn = document.getElementById("btn-google-user-sync");
      const connectBtn = document.getElementById("btn-google-connect");
      syncBtn?.removeAttribute("disabled");
      connectBtn?.removeAttribute("disabled");
      return;
    }
    showToast(error?.message || "No se pudo conectar con Google.", "error");
  } finally {
    // CRUCIAL: Siempre resetear isConnecting y habilitar botones,
    // incluso si hubo error o el popup fue bloqueado.
    isConnecting = false;
    clearTimeout(safetyTimer);
    const syncBtn = document.getElementById("btn-google-user-sync");
    const connectBtn = document.getElementById("btn-google-connect");
    syncBtn?.removeAttribute("disabled");
    connectBtn?.removeAttribute("disabled");
  }
}

export function isGoogleConnected() {
  return Boolean(accountEmail || accessToken);
}

export function clearGoogleToken(deleteSession = false) {
  accessToken = null;
  accountEmail = null;
  accountName = null;
  accountPicture = null;
  tokenExpiresAt = null;
  drivePermissionsGranted = false;
  isConnecting = false;
  
  // Si deleteSession es true, borrar sesión de Google de sessionStorage
  if (deleteSession) {
    try { sessionStorage.removeItem("rodilloint_google_session"); } catch (e) {}
  }
  
  googleLoginRetryCount = 0; // Resetear contador de reintentos al cerrar sesión
  updateStatusUI();
}

export function disconnectGoogle(autoClose = true) {
  const wasConnected = Boolean(accountEmail || accessToken);
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    } catch (e) {}
  }
  accessToken = null;
  accountEmail = null;
  accountName = null;
  accountPicture = null;
  tokenExpiresAt = null;
  drivePermissionsGranted = false;
  isConnecting = false;
  clearGoogleSession();
  clearTimers();
  updateStatusUI();
  showToast("Desconectado de Google (los datos locales se mantienen).", "info");

  if (wasConnected) {
    try {
      const popup = window.open("https://accounts.google.com/Logout", "_blank");
      if (popup) {
        showToast("Se abrió Google para cerrar sesión. Cierra esa pestaña cuando termines.", "info");
      } else {
        showToast("No se pudo abrir Google. Cierra la sesión manualmente en accounts.google.com", "warning");
      }
    } catch (e) {}
  }
}

// Exponer para que otros módulos (ej. logout de perfil) puedan cerrar la sesión de Google
if (typeof window !== "undefined") {
  window.disconnectGoogle = disconnectGoogle;
  window.isGoogleConnected = isGoogleConnected;
  window.clearGoogleToken = clearGoogleToken;
  window.syncGoogleOnUserScreen = syncGoogleOnUserScreen;
  window.updateGoogleLinkStatus = updateGoogleLinkStatus;
  window.requestDriveAccess = requestDriveAccess;
}

export async function pushToDrive({ silent = false } = {}) {
  googleLoginRetryCount = 0; // Resetear contador antes de intentar conexión
  const statusEl = document.getElementById("google-drive-status");
  const indicator = document.getElementById("google-sync-indicator");
  if (statusEl && !silent) statusEl.textContent = "Sincronizando...";
  if (indicator && !silent) indicator.textContent = "🔄";
  try {
    // No abrir popup automáticamente en pushes silenciosos (timers/visibilitychange)
    if (!accessToken) {
      if (!silent) {
        // Push manual desde botón de usuario: se permite conectar
        await connectGoogle();
      }
      if (!accessToken) return;
    }

    // Subir siempre solo los datos del usuario actualmente seleccionado.
    // Los demás perfiles no se incluyen en este backup.
    let json;
    let backupDescription = "";
    if (!state.currentUser) {
      if (!silent) showToast("Selecciona un perfil antes de subir el backup a Google Drive.", "warning");
      if (statusEl) statusEl.textContent = "Sin perfil seleccionado";
      if (indicator && !silent) indicator.textContent = "☁️";
      return;
    }
    json = await DbManager.exportBackupJsonForUser(state.currentUser.id);
    backupDescription = `usuario "${state.currentUser.name}" (ID ${state.currentUser.id})`;

    if (!silent) showToast(`Subiendo backup de ${backupDescription} a Google Drive...`, "info");

    // Cifrado por defecto (clave de la app) para proteger datos en Drive.
    const encrypted = await encryptBackupJson(json, DEFAULT_BACKUP_PASSWORD);
    json = JSON.stringify(encrypted);

    let file = await findBackupFile();
    if (!file) {
      const metaRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: BACKUP_FILE_NAME, parents: ["appDataFolder"] }),
      });
      file = await metaRes.json();
    }

    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: json,
    });

    const now = new Date().toISOString();
    localStorage.setItem("rodilloint_last_google_sync", now);
    updateStatusUI();
    if (!silent) showToast("Backup subido a Google Drive correctamente.", "success");
  } catch (error) {
    console.error("Error subiendo backup a Google Drive:", error);
    updateStatusUI();
    if (!silent) showToast(error?.message || "No se pudo subir el backup a Google Drive.", "error");
  }
}

export async function pullFromDrive() {
  googleLoginRetryCount = 0; // Resetear contador antes de intentar conexión
  const statusEl = document.getElementById("google-drive-status");
  const indicator = document.getElementById("google-sync-indicator");
  if (statusEl) statusEl.textContent = "Sincronizando...";
  if (indicator) indicator.textContent = "🔄";
  try {
    if (!accessToken) await connectGoogle();
    if (!accessToken) return;

    const file = await findBackupFile();
    if (!file) {
      showToast("No hay backup en Google Drive para esta cuenta.", "info");
      return;
    }

    if (!silent) showToast("Descargando backup de Google Drive...", "info");
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
    const text = await res.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("El backup de Google Drive no es JSON válido.");
    }
    if (isEncryptedBackup(parsed)) {
      const plain = await decryptBackupJson(parsed, DEFAULT_BACKUP_PASSWORD);
      parsed = JSON.parse(plain);
    }
    const data = parsed;

    await DbManager.mergeBackupData(data);
    updateStatusUI();
    if (!silent) showToast("Backup fusionado desde Google Drive.", "success");

    // Recargar para refrescar estado en memoria
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    console.error("Error descargando backup de Google Drive:", error);
    updateStatusUI();
    showToast(error?.message || "No se pudo descargar el backup de Google Drive.", "error");
  }
}

export function updateGoogleLinkStatus() {
  const statusEl = document.getElementById("google-link-status");
  if (!statusEl) return;
  if (!state.currentUser) {
    statusEl.textContent = "No hay perfil seleccionado.";
    return;
  }
  statusEl.textContent = state.currentUser.googleEmail
    ? `Vinculada: ${state.currentUser.googleEmail}`
    : "No vinculada";
}

export async function linkGoogleToProfile() {
  if (!state.currentUser) {
    showToast("Selecciona un perfil primero.", "warning");
    return;
  }
  try {
    await connectGoogle();
    if (!accountEmail) return;

    const users = await DbManager.getAllUsers();
    const existing = users.find(
      (u) => u.googleEmail === accountEmail
    );
    if (existing) {
      // Si el usuario actual ya tiene esta cuenta vinculado, no hacer nada (ya está vinculado)
      if (existing.id === state.currentUser.id) {
        showToast("Esta cuenta Google ya está vinculada a este perfil.", "info");
        return;
      }
      // Si pertenece a otro usuario, bloquear el enlace definitivamente
      showToast("Esta cuenta Google ya está vinculada a otro perfil y no puede asociarse a otro usuario.", "warning");
      return;
    }

    const updated = {
      ...state.currentUser,
      googleEmail: accountEmail,
      avatarUrl: state.currentUser.avatarUrl || accountPicture,
      imageUri: state.currentUser.imageUri || accountPicture,
      updatedAt: Date.now(),
    };
    await DbManager.updateUser(updated);
    state.currentUser = updated;
    saveStateToLocalStorage();
    if (window._loadDashboardHeader) window._loadDashboardHeader(state);
    updateGoogleLinkStatus();
    showToast("Perfil vinculado a Google correctamente.", "success");
    scheduleAutoPush();
  } catch (error) {
    console.error("Error vinculando Google al perfil:", error);
    showToast(error?.message || "No se pudo vincular la cuenta Google.", "error");
  }
}

export async function unlinkGoogleFromProfile() {
  if (!state.currentUser) {
    showToast("Selecciona un perfil primero.", "warning");
    return;
  }
  if (!state.currentUser.googleEmail) {
    showToast("Este perfil no tiene cuenta Google vinculada.", "info");
    return;
  }
  const updated = { ...state.currentUser, googleEmail: null, updatedAt: Date.now() };
  await DbManager.updateUser(updated);
  state.currentUser = updated;
  saveStateToLocalStorage();
  updateGoogleLinkStatus();
  showToast("Perfil desvinculado de Google.", "info");
}

export function updateStatusUI() {
  const statusEl = document.getElementById("google-drive-status");
  const indicator = document.getElementById("google-sync-indicator");

  if (!isGoogleConfigured()) {
    if (statusEl) statusEl.textContent = "Google Drive no configurado: falta VITE_GOOGLE_CLIENT_ID en .env.";
    if (indicator) { indicator.textContent = "☁️"; indicator.title = "Google Drive no configurado"; }
    return;
  }

  const tokenExpired = tokenExpiresAt && Date.now() > tokenExpiresAt;

  if (accountEmail) {
    if (tokenExpired) {
      if (statusEl) statusEl.textContent = `Sesión expirada: ${accountEmail}`;
      if (indicator) { indicator.textContent = "⚠️"; indicator.title = "Sesión de Google expirada. Pulsa 'Conectar Google' para renovar."; }
    } else if (!drivePermissionsGranted) {
      if (statusEl) statusEl.textContent = `Conectado: ${accountEmail} (sin permisos de Drive)`;
      if (indicator) { indicator.textContent = "⚠️"; indicator.title = "Conectado a Google, pero sin permisos de Drive. Los backups se guardarán en tu carpeta oculta de Google Drive. Pulsa 'Conceder permisos' para autorizar."; }
    } else {
      const last = localStorage.getItem("rodilloint_last_google_sync");
      if (statusEl) statusEl.textContent = `Conectado: ${accountEmail}${last ? ` · Última sync: ${new Date(last).toLocaleString("es-ES")}` : ""}`;
      if (indicator) { indicator.textContent = "✅"; indicator.title = `Conectado a Google Drive${last ? ` · Última sync: ${new Date(last).toLocaleString("es-ES")}` : ""}`; }
    }
  } else {
    if (statusEl) statusEl.textContent = "No conectado a Google.";
    if (indicator) { indicator.textContent = "☁️"; indicator.title = "No conectado a Google Drive"; }
  }
}

function isGoogleAutoSyncEnabled() {
  return state.googleAutoSync !== false;
}

export function scheduleAutoPush() {
  if (!accessToken || !accountEmail || !isGoogleAutoSyncEnabled()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void autoPushIfConnected();
  }, 30000);
}

export async function autoPushIfConnected() {
  if (!accessToken || !accountEmail) return;
  try {
    await pushToDrive({ silent: true });
  } catch (error) {
    console.warn("Auto-push a Google Drive falló:", error);
  }
}

export async function syncGoogleOnUserScreen(expectedEmail = null) {
  console.log("[GoogleSync] syncGoogleOnUserScreen llamado, expectedEmail:", expectedEmail);
  try {
    if (!isGoogleConfigured()) {
      showToast("Google Drive no está configurado (falta VITE_GOOGLE_CLIENT_ID).", "warning");
      return;
    }
    await connectGoogle();
    console.log("[GoogleSync] sync accountEmail:", accountEmail, "token:", !!accessToken);
    if (!accessToken || !accountEmail) {
      showToast("No se pudo conectar con Google.", "error");
      return;
    }

    // Si se esperaba un email específico (clic en perfil vinculado), verificar coincidencia
    if (expectedEmail && accountEmail && accountEmail !== expectedEmail) {
      showToast(
        `La cuenta de Google (${accountEmail}) no coincide con el perfil seleccionado (${expectedEmail}).`,
        "warning"
      );
      return;
    }

    // Intentar sincronizar backup de Drive (opcional: no bloquea si no hay permisos)
    let backupSynced = false;
    try {
      const file = await findBackupFile();
      console.log("[GoogleSync] sync backup file:", file?.id, file?.name);
      if (file) {
        showToast("Descargando backup de Google Drive...", "info");
        const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
        const text = await res.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          throw new Error("El backup de Google Drive no es JSON válido.");
        }
        if (isEncryptedBackup(parsed)) {
          const plain = await decryptBackupJson(parsed, DEFAULT_BACKUP_PASSWORD);
          parsed = JSON.parse(plain);
        }
        const data = parsed;
        await DbManager.mergeBackupData(data);
        showToast("Datos sincronizados desde Google Drive.", "success");
        backupSynced = true;
      } else {
        showToast("No hay backup previo; se creará uno nuevo.", "info");
        backupSynced = true;
      }
    } catch (driveError) {
      // Si falla por permisos de Drive, no bloquear el acceso al dashboard
      console.warn("[GoogleSync] No se pudo sincronizar backup de Drive:", driveError.message);
      if (!driveError.message.includes("insufficientPermissions") && !driveError.message.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
        showToast("No se pudo sincronizar el backup de Google Drive. Puedes conceder permisos desde Ajustes.", "warning");
      }
    }

    // Buscar perfil vinculado a esta cuenta Google
    const users = await DbManager.getAllUsers();
    let user = users.find((u) => u.googleEmail === accountEmail);

    // Si no existe, crear perfil automáticamente
    if (!user) {
      const newId = await DbManager.insertUser({
        name: accountName || accountEmail.split("@")[0],
        googleEmail: accountEmail,
        weight: 75,
        ftp: 200,
        maxHeartRate: 190,
        age: 30,
        height: 175,
        avatarUrl: accountPicture,
        imageUri: accountPicture,
      });
      user = await DbManager.getUserById(newId);
    } else {
      const updates = {};
      if (accountName && user.name !== accountName) updates.name = accountName;
      if (accountPicture && !user.avatarUrl && !user.imageUri) updates.avatarUrl = accountPicture;
      if (Object.keys(updates).length > 0) {
        const updated = { ...user, ...updates, updatedAt: Date.now() };
        await DbManager.updateUser(updated);
        user = await DbManager.getUserById(user.id);
      }
    }

    if (!user) {
      throw new Error("No se pudo crear o seleccionar el perfil.");
    }

    selectUser(user);
    saveStateToLocalStorage();
    if (window._loadDashboardHeader) window._loadDashboardHeader(state);
    if (window._navigateTo) {
      window._navigateTo("dashboard");
    } else {
      console.warn("navigateTo no disponible; recargando perfiles.");
      await loadProfilesGrid();
    }
  } catch (error) {
    console.error("Error sincronizando Google en pantalla de usuario:", error);
    if (error.message === "GOOGLE_TIMEOUT") {
      const reintentar = await showConfirm(
        "El popup de Google ha tardado demasiado. ¿Quieres intentarlo de nuevo?",
        "Reintentar", "primary"
      );
      if (reintentar) {
        // Diferir para que el finally se ejecute primero
        setTimeout(() => syncGoogleOnUserScreen(expectedEmail), 100);
        return;
      }
    }
    // Si faltan permisos de Drive, no bloquear el acceso al dashboard
    if (error.message === "DRIVE_PERMISSIONS_REQUIRED") {
      showToast("Conectado a Google. Para sincronizar backups, concede permisos de Drive desde el indicador del header o Ajustes.", "info");
      // Seguir con el flujo normal de selección de usuario
    } else {
      showToast(error?.message || "No se pudo sincronizar con Google.", "error");
      try { await loadProfilesGrid(); } catch (e) {}
    }
  }
}

export async function initGoogleSync() {
  console.log("[GoogleSync] initGoogleSync llamado");
  console.log("[GoogleSync] VITE_GOOGLE_CLIENT_ID configurado:", !!CLIENT_ID);
  console.log("[GoogleSync] google.accounts.oauth2 disponible:", !!window.google?.accounts?.oauth2);

  // Inicializar Google Identity Services al cargar la página (no al clic)
  // Esto permite que requestAccessToken() se llame inmediatamente al hacer clic
  try {
    if (window.google?.accounts?.oauth2) {
      tokenClient = initTokenClient();
      console.log("[GoogleSync] tokenClient inicializado desde GIS ya cargado");
    } else {
      console.log("[GoogleSync] GIS aún no cargado, esperando...");
      await waitForGoogle();
      tokenClient = initTokenClient();
      console.log("[GoogleSync] tokenClient inicializado tras waitForGoogle");
    }
  } catch (e) {
    console.warn("[GoogleSync] Google Identity Services no disponible al iniciar:", e);
  }

  // Restaurar sesión de Google si existe en sessionStorage
  restoreGoogleSession();
  console.log("[GoogleSync] sesión restaurada:", accountEmail ? accountEmail : "ninguna");

  updateStatusUI();

  // Leyenda de iconos de Google Drive ocultada a petición del usuario.

  // --- Función para eliminar datos de Google Drive ---
  async function deleteDriveData() {
    // 1. Verificar que hay conexión de Google
    if (!isGoogleConfigured() || !accessToken) {
      showToast("No hay cuenta Google conectada.", "warning");
      return;
    }
    
    // 2. Pedir confirmación por escrito para evitar eliminaciones accidentales
    const confirmText = prompt(
      "⚠️ SEGURIDAD: Escribe la palabra \"ELIMINAR\" para confirmar la eliminación permanente de tus datos de Google Drive.\n\n" +
      "Esta acción borrará:\n" +
      "• El backup actual (rodilloint-backup.json)\n" +
      "• Todo el historial de sesiones y perfiles guardados\n" +
      "• Las rutas GPX/TCX guardadas\n" +
      "• Los datos de telemetría y configuración\n\n" +
      "⚠️ Esta acción NO se puede deshacer. Debes escribir exactamente: ELIMINAR"
    );
    
    // Si el usuario cancela o escribe texto incorrecto, abortamos
    if (!confirmText || confirmText.trim().toUpperCase() !== "ELIMINAR") {
      showToast("Eliminación cancelada. No se realizó ningún cambio.", "info");
      return;
    }
    
    // 3. Diálogo de confirmación final (después de escribir ELIMINAR)
    const confirmed = await showConfirm(
      "⚠️ ATENCIÓN: ¿Estás seguro de que quieres borrar permanentemente todos los datos de Google Drive?\n\n" +
      "Esta acción eliminará:\n" +
      "• El backup actual (rodilloint-backup.json)\n" +
      "• Todo el historial de sesiones y perfiles guardados\n" +
      "• Las rutas GPX/TCX guardadas\n" +
      "• Los datos de telemetría y configuración\n\n" +
      "Esta acción NO se puede deshacer. ¿Continuas?",
      "Confirmar eliminación", "danger"
    );
    
    if (!confirmed) {
      showToast("Eliminación cancelada.", "info");
      return;
    }
    
    // 3. Mostrar indicador de progreso
    showToast("Eliminando datos de Google Drive...", "info");
    
    try {
      // 4. Localizar el archivo de backup
      const file = await findBackupFile();
      
      if (!file) {
        showToast("No se encontró archivo de backup en Google Drive.", "info");
        showToast("No había datos de usuario en Drive para eliminar.", "success");
        return;
      }
      
      // 5. Ejecutar DELETE en la API de Drive
      const res = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      
      // 6. Limpiar estado local
      clearGoogleToken(true); // Borra sessionStorage y tokens, dejando al usuario como usuario local

      // Cerrar sesión completa de Google Identity Services (GIS) en el navegador
      // Esto es necesario porque GIS mantiene sesiones cached en el navegador
      if (accessToken && window.google?.accounts?.oauth2?.revoke) {
        window.google.accounts.oauth2.revoke(accessToken, () => {});
      }
      accessToken = null;
      accountEmail = null;
      accountName = null;
      accountPicture = null;
      tokenExpiresAt = null;
      drivePermissionsGranted = false;
      
      localStorage.removeItem("rodilloint_last_google_sync");
      localStorage.removeItem("rodilloint_backup_encrypted");
      
      showToast("✅ Datos de Google Drive eliminados permanentemente.", "success");
      showToast("Has sido desconectado de Google. Inicia sesión nuevamente si lo deseas.", "info");
      updateStatusUI();
      
    } catch (error) {
      console.error("Error eliminando datos de Drive:", error);
      showToast(`Error al eliminar datos: ${error.message || "Error desconocido"}`, "error");
      if (error.message.includes("403") || error.message.includes("404")) {
        showToast("No se pudo eliminar el archivo. Puede que no tengas permisos o el archivo ya fue borrado anteriormente.", "warning");
      }
    }
  }
  
  // 7. Añadir event listener para el botón de eliminar datos
  const deleteBtn = document.getElementById("btn-google-delete-data");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => void deleteDriveData());
  }

  // Restaurar sesión de Google si existe en sessionStorage
  restoreGoogleSession();

  updateStatusUI();

  const connectBtn = document.getElementById("btn-google-connect");
  const drivePermsBtn = document.getElementById("btn-google-drive-perms");
  const pushBtn = document.getElementById("btn-google-push");
  const pullBtn = document.getElementById("btn-google-pull");
  const disconnectBtn = document.getElementById("btn-google-disconnect");
  const userSyncBtn = document.getElementById("btn-google-user-sync");
  const linkBtn = document.getElementById("btn-link-google-profile");
  const unlinkBtn = document.getElementById("btn-unlink-google-profile");
  const syncIndicator = document.getElementById("google-sync-indicator");

  connectBtn?.addEventListener("click", (e) => {
    console.log("[GoogleSync] clic en btn-google-connect");
    void connectGoogle();
  });
  drivePermsBtn?.addEventListener("click", async (e) => {
    console.log("[GoogleSync] clic en btn-google-drive-perms");
    await requestDriveAccess();
  });
  pushBtn?.addEventListener("click", () => void pushToDrive());
  pullBtn?.addEventListener("click", () => void pullFromDrive());
  disconnectBtn?.addEventListener("click", () => disconnectGoogle());
  userSyncBtn?.addEventListener("click", (e) => {
    console.log("[GoogleSync] clic en btn-google-user-sync");
    void syncGoogleOnUserScreen();
  });
  linkBtn?.addEventListener("click", () => void linkGoogleToProfile());
  unlinkBtn?.addEventListener("click", () => void unlinkGoogleFromProfile());

  // El triángulo ⚠️ del header: abrir permisos de Drive sin navegar al perfil
  syncIndicator?.addEventListener("click", (e) => {
    e.stopPropagation(); // Evitar que se propague al header (que va al perfil)
    console.log("[GoogleSync] clic en indicador Google Sync");
    void requestDriveAccess();
  });

  if (!isGoogleConfigured()) {
    [connectBtn, drivePermsBtn, pushBtn, pullBtn, disconnectBtn, userSyncBtn, linkBtn, unlinkBtn].forEach((btn) => {
      if (btn) btn.disabled = true;
    });
  }

  updateGoogleLinkStatus();

  // Push con debounce cuando cambian datos locales
  window.addEventListener("rodilloint:data-changed", () => {
    scheduleAutoPush();
  });

  // Push al volver a la pestaña
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && accessToken && accountEmail && isGoogleAutoSyncEnabled()) {
      scheduleAutoPush();
    }
  });

  // Sync periódica (solo push) cada 5 minutos si hay cuenta conectada
  if (!window._rodillointGoogleSyncInterval) {
    window._rodillointGoogleSyncInterval = setInterval(() => {
      if (accessToken && accountEmail) {
        void autoPushIfConnected();
      }
    }, 5 * 60 * 1000);
  }
}
