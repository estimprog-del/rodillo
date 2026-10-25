// js/utils/imageUtils.js
// Utilidades de procesamiento y compresión de imágenes en el cliente

/**
 * Procesa, recorta en proporción 1:1 y optimiza una imagen seleccionada para avatar.
 * @param {File} file - Archivo de imagen proporcionado por el usuario
 * @param {number} [targetSize=180] - Tamaño en píxeles (ancho y alto de salida)
 * @param {number} [quality=0.85] - Factor de compresión (0 - 1)
 * @returns {Promise<string>} Promesa que resuelve a una Data URL en Base64 (WebP o JPEG)
 */
export function processAvatarImage(file, targetSize = 180, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file) {
      return reject(new Error("No se ha seleccionado ningún archivo."));
    }
    if (!file.type.startsWith("image/")) {
      return reject(new Error("El archivo seleccionado no es una imagen válida."));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Error al leer el archivo de imagen."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo cargar la imagen para procesar."));
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext("2d");

          if (!ctx) {
            return reject(new Error("No se pudo inicializar el contexto de imagen."));
          }

          // Recorte centrado 1:1
          const srcWidth = img.naturalWidth || img.width;
          const srcHeight = img.naturalHeight || img.height;
          const cropSize = Math.min(srcWidth, srcHeight);
          const cropX = (srcWidth - cropSize) / 2;
          const cropY = (srcHeight - cropSize) / 2;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";

          ctx.drawImage(
            img,
            cropX,
            cropY,
            cropSize,
            cropSize,
            0,
            0,
            targetSize,
            targetSize,
          );

          // Intentar WebP primero; si el navegador no lo soporta devuelve image/png
          let dataUrl = canvas.toDataURL("image/webp", quality);
          if (!dataUrl.startsWith("data:image/webp")) {
            dataUrl = canvas.toDataURL("image/jpeg", quality);
          }

          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
