const { defineConfig, loadEnv } = require('vite');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { networkInterfaces } = require('node:os');
const Ably = require('ably');

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000;

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16_384) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function getLanAddress() {
  const addresses = Object.values(networkInterfaces())
    .flatMap((interfaces) => interfaces || [])
    .filter((address) =>
      address.family === 'IPv4' &&
      !address.internal &&
      (/^192\.168\./.test(address.address) ||
        /^10\./.test(address.address) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address.address)),
    )
    .map((address) => address.address);
  return addresses.sort((a, b) => {
    const rank = (ip) => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2;
    return rank(a) - rank(b);
  })[0] || null;
}

function getBrowserOrigin(request) {
  const protocol = request.socket.encrypted ? 'https:' : 'http:';
  const requestUrl = new URL(`${protocol}//${request.headers.host}`);
  if (['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)) {
    const lanAddress = getLanAddress();
    if (lanAddress) requestUrl.hostname = lanAddress;
  }
  return requestUrl.origin;
}

function localAblyAuthPlugin(apiKey) {
  const rooms = new Map();
  const ably = apiKey ? new Ably.Rest({ key: apiKey }) : null;

  async function issueToken(roomId, role) {
    const channel = `rodilloint:${roomId}`;
    return ably.auth.requestToken({
      clientId: role,
      capability: {
        [channel]: ['publish', 'subscribe'],
      },
      ttl: TOKEN_TTL_MS,
    });
  }

  function isSameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
    }
  }

  return {
    name: 'local-ably-room-auth',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        "connect-src 'self' https: wss:",
        "connect-src 'self' https: wss: ws:",
      );
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname !== '/api/ably-rooms' && pathname !== '/api/ably-auth') {
          next();
          return;
        }

        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          sendJson(response, 405, { error: 'Método no permitido.' });
          return;
        }
        if (!isSameOrigin(request)) {
          sendJson(response, 403, { error: 'Origen no permitido.' });
          return;
        }
        if (!ably) {
          sendJson(response, 503, {
            error: 'Configura ABLY_API_KEY en .env para habilitar el mando local.',
          });
          return;
        }

        try {
          if (pathname === '/api/ably-rooms') {
            for (const [id, room] of rooms) {
              if (room.expiresAt <= Date.now()) rooms.delete(id);
            }
            if (rooms.size >= 1000) {
              sendJson(response, 503, { error: 'Hay demasiadas salas activas.' });
              return;
            }
            const roomId = randomBytes(32).toString('hex');
            const hostSecret = randomBytes(32).toString('hex');
            rooms.set(roomId, {
              hostSecretHash: createHash('sha256').update(hostSecret).digest(),
              expiresAt: Date.now() + ROOM_TTL_MS,
            });
            sendJson(response, 201, {
              roomId,
              hostSecret,
              remoteOrigin: getBrowserOrigin(request),
            });
            return;
          }

          const rawBody = await readRequestBody(request);
          const contentType = request.headers['content-type'] || '';
          const params = contentType.includes('application/json')
            ? JSON.parse(rawBody)
            : Object.fromEntries(new URLSearchParams(rawBody));
          const { roomId, role, hostSecret } = params;
          if (!/^[a-f0-9]{64}$/i.test(roomId || '') ||
              (role !== 'host' && role !== 'remote')) {
            sendJson(response, 400, { error: 'Sala o rol no válido.' });
            return;
          }

          const room = rooms.get(roomId);
          if (!room || room.expiresAt <= Date.now()) {
            rooms.delete(roomId);
            sendJson(response, 404, { error: 'La sala ya no existe. Crea una nueva.' });
            return;
          }
          if (role === 'host') {
            const candidateHash = createHash('sha256')
              .update(typeof hostSecret === 'string' ? hostSecret : '')
              .digest();
            if (!timingSafeEqual(room.hostSecretHash, candidateHash)) {
              sendJson(response, 403, { error: 'Autenticación del host no válida.' });
              return;
            }
          }

          sendJson(response, 200, await issueToken(roomId, role));
        } catch (error) {
          console.error('[Local Ably] No se pudo atender la petición de autenticación:', error);
          sendJson(response, 502, { error: error.message || 'Error de autenticación Ably.' });
        }
      });
    },
  };
}

module.exports = defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const publicEnv = {
    VITE_ABLY_AUTH_URL: command === 'serve'
      ? (env.VITE_ABLY_AUTH_URL || '/api/ably-auth')
      : (process.env.VITE_ABLY_AUTH_URL || ''),
    VITE_MAPTILER_API_KEY: env.VITE_MAPTILER_API_KEY || '',
  };

  return {
    base: '/rodillo/',
    envPrefix: ['VITE_ABLY_AUTH_URL', 'VITE_MAPTILER_API_KEY'],
    server: { host: true },
    plugins: command === 'serve'
      ? [localAblyAuthPlugin(env.ABLY_API_KEY)]
      : [],
    define: {
      'import.meta.env.VITE_ABLY_AUTH_URL': JSON.stringify(publicEnv.VITE_ABLY_AUTH_URL),
      'import.meta.env.VITE_MAPTILER_API_KEY': JSON.stringify(publicEnv.VITE_MAPTILER_API_KEY),
    },
  };
});
