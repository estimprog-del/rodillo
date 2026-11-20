# RodilloInt – Training Lab

Aplicación web para entrenamiento en rodillo interactivo de ciclismo: simulación de rutas GPX/TCX, entrenamientos ERG estructurados, registro de sensores Bluetooth, análisis de sesiones, perfiles de usuario y sincronización opcional con Google Drive.

## Desarrollo

```bash
npm install
npm run dev
```

Variables de entorno (ver `.env.example`): `VITE_MAPTILER_API_KEY`, `VITE_ABLY_AUTH_URL`, `ABLY_API_KEY`, `VITE_GOOGLE_CLIENT_ID`.

### Mando remoto (desarrollo)

En desarrollo, el servidor local de Vite expone `/api/ably-rooms` y `/api/ably-auth`, que emiten tokens Ably de corta duración limitados a cada sala. En GitHub Pages hace falta configurar un servidor de autenticación seguro (`VITE_ABLY_AUTH_URL`); sin él, los controles del mando quedan desactivados.

## Comprobación rápida después de actualizar

- Sin sensores: activa el Rodillo Virtual, inicia una sesión y confirma que cambian las métricas.
- Con sensores: conecta el rodillo o los sensores, inicia una sesión y comprueba que los indicadores muestran conexión y señal reciente.
- Prueba pausa y reanudación; en una ruta, comprueba también la pausa automática al dejar de pedalear y la reanudación al volver a moverte.
- En ERG: inicia un entrenamiento, comprueba el bloque y la potencia objetivo, y finaliza para revisar el resumen.
- Abre el historial, compara dos sesiones y verifica que sus métricas se muestran correctamente.

## Build y despliegue

```bash
npm run build
npm run preview
```

El despliegue a GitHub Pages se realiza automáticamente al hacer push a `main` (`.github/workflows/deploy.yml`).
