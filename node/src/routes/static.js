import fs from 'fs';
import path from 'path';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import proxy from '@fastify/http-proxy';

// Serve static UI assets from the local repo by default so live reload picks up changes.
// If a container binds a different path, override with UI_ROOT env (optional future hook).
const UI_ROOT = path.resolve('../html');
const MITM_HTTP_ROOT = '/var/lib/mitmproxy';
const MITM_HTTPS_ROOT = '/root/.mitmproxy';
const UI_DEV_ORIGIN = process.env.UI_DEV_ORIGIN;

function mitmBasePath(request) {
  return request.protocol === 'https' ? MITM_HTTPS_ROOT : MITM_HTTP_ROOT;
}

function hasFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (err) {
    return false;
  }
}

function getActiveCaPath(appConfig) {
  const dynamicCa = appConfig?.https?.dynamicCerts?.caCertPath;
  if (dynamicCa) return dynamicCa;
  return appConfig?.https?.certPath || null;
}

async function staticRoutes(fastify) {
  // In dev, let Vite serve the UI directly to keep HMR and source maps.
  if (UI_DEV_ORIGIN) {
    // Avoid the Vite "configured with a public base" helper when the slash is missing.
    fastify.get('/config/ui', async (_, reply) => reply.redirect(302, '/config/ui/'));

    fastify.register(proxy, {
      upstream: UI_DEV_ORIGIN,
      prefix: '/config/ui/',
      rewritePrefix: '/config/ui/',
      internalRewriteLocationHeader: false
    });

    // Proxy Vite asset endpoints that are requested with absolute paths.
    ['/@vite', '/src', '/node_modules', '/assets'].forEach((prefix) => {
      fastify.register(proxy, {
        upstream: UI_DEV_ORIGIN,
        prefix
      });
    });
    return;
  }

  // Serve SPA assets for the management UI with explicit no-store headers.
  fastify.register(fastifyStatic, {
    root: UI_ROOT,
    prefix: '/config/ui/',
    decorateReply: true,
    // Avoid registering the plugin's own wildcard route so our SPA fallback below can own it.
    wildcard: false,
    index: false,
    cacheControl: false,
    setHeaders: (res) => {
      res.setHeader('cache-control', 'no-store');
    }
  });

  function noStore(reply) {
    reply.header('cache-control', 'no-store');
    return reply;
  }

  function sendSpa(reply) {
    noStore(reply).type('text/html; charset=utf-8');
    return reply.sendFile('index.html');
  }

  fastify.get('/config/ui', async (_, reply) => sendSpa(reply));
  fastify.get('/config/ui/', async (_, reply) => sendSpa(reply));
  fastify.get('/config/ui/*', async (request, reply) => sendSpa(reply));
  fastify.get('/collector/ui', async (_, reply) => reply.redirect(302, '/config/ui'));

  async function serveActiveCa(request, reply, contentType) {
    const caPath = getActiveCaPath(fastify.appConfig);
    if (!caPath || !hasFile(caPath)) {
      return noStore(reply).code(404).type('text/plain; charset=utf-8').send('not found');
    }
    return noStore(reply).type(contentType).send(fs.createReadStream(path.resolve(caPath)));
  }

  async function serveMitmCert(request, reply, filename, contentType) {
    const base = mitmBasePath(request);
    const filePath = path.join(base, filename);
    if (!hasFile(filePath)) {
      return noStore(reply).code(404).type('text/plain; charset=utf-8').send('not found');
    }
    return noStore(reply).type(contentType).send(fs.createReadStream(filePath));
  }

  fastify.get('/config/mitm/mitmproxy-ca-cert.pem', async (request, reply) =>
    serveMitmCert(request, reply, 'mitmproxy-ca-cert.pem', 'application/x-pem-file')
  );

  fastify.get('/config/mitm/mitmproxy-ca-cert.cer', async (request, reply) =>
    serveMitmCert(request, reply, 'mitmproxy-ca-cert.cer', 'application/pkix-cert')
  );

  // Preferred CA download: serves the configured MITM CA if present, else falls back to the static HTTPS cert.
  fastify.get('/config/mitm/ca.pem', async (request, reply) => serveActiveCa(request, reply, 'application/x-pem-file'));
  fastify.get('/config/mitm/ca.cer', async (request, reply) => serveActiveCa(request, reply, 'application/pkix-cert'));
}

export default fp(staticRoutes);
