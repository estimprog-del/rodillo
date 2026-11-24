// Utilidad de saneamiento de texto para defensa en profundidad (DOMPurify).
// Elimina cualquier etiqueta/atributo HTML de cadenas no confiables (nombres de
// rutas, archivos subidos, metadatos GPX, mensajes de error, etc.).
import DOMPurify from "dompurify";

/**
 * Devuelve texto plano saneado: sin etiquetas ni atributos HTML.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeText(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // ALLOWED_TAGS: [] elimina todo HTML y deja solo texto.
  return DOMPurify.sanitize(str, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();
}

/**
 * Sanea un nombre de perfil/ruta/archivo limitando longitud.
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeName(value, maxLength = 80) {
  const clean = sanitizeText(value);
  return clean.slice(0, maxLength);
}