// Cifrado opcional de backups con Web Crypto (AES-GCM + PBKDF2).
// Uso previsto: backups manuales exportados/importados por el usuario.

const ITERATIONS = 100000;

// Clave por defecto para cifrado transparente de backups (sin contraseña de usuario).
// Nota: al estar en el cliente, no es un secreto real; protege frente a acceso casual/terceros.
export const DEFAULT_BACKUP_PASSWORD = "RodilloInt-Default-Backup-Key-2026-DoNotShare";

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isEncryptedBackup(data) {
  return (
    !!data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    data.format === "RodilloInt encrypted backup" &&
    typeof data.salt === "string" &&
    typeof data.iv === "string" &&
    typeof data.ciphertext === "string"
  );
}

export async function encryptBackupJson(plainText, password) {
  if (!password) throw new Error("Se requiere contraseña para cifrar.");
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plainText),
  );
  return {
    format: "RodilloInt encrypted backup",
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBackupJson(wrapper, password) {
  if (!isEncryptedBackup(wrapper)) {
    throw new Error("El archivo no es un backup cifrado válido.");
  }
  if (!password) throw new Error("Se requiere contraseña para descifrar.");
  const salt = base64ToBytes(wrapper.salt);
  const iv = base64ToBytes(wrapper.iv);
  const ciphertext = base64ToBytes(wrapper.ciphertext);
  const key = await deriveKey(password, salt);
  let plainBuffer;
  try {
    plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch (e) {
    throw new Error("Contraseña incorrecta o backup corrupto.");
  }
  return new TextDecoder().decode(plainBuffer);
}