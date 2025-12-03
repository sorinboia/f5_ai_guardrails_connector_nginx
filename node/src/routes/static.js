import fs from 'fs';
import path from 'path';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';

const UI_ROOT = path.resolve('/etc/nginx/html');
const MITM_HTTP_ROOT = '/var/lib/mitmproxy';
const MITM_HTTPS_ROOT = '/root/.mitmproxy';

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

async function staticRoutes(fastify) {
  // Decorate reply with sendFile without auto-registering directory handlers.
  fastify.register(fastifyStatic, {
    root: UI_ROOT,
    serve: false,
    decorateReply: true,
  });

  function noStore(reply) {
    reply.header('cache-control', 'no-store');
    return reply;
  }

  function sendHtml(reply) {
    noStore(reply).type('text/html; charset=utf-8');
    return reply.sendFile('scanner-config.html');
  }

  fastify.get('/config/ui', async (_, reply) => sendHtml(reply));
  fastify.get('/config/ui/keys', async (_, reply) => sendHtml(reply));
  fastify.get('/config/ui/patterns', async (_, reply) => sendHtml(reply));

  fastify.get('/config/ui/', async (_, reply) => reply.redirect(302, '/config/ui'));
  fastify.get('/config/ui/keys/', async (_, reply) => reply.redirect(302, '/config/ui/keys'));
  fastify.get('/config/ui/patterns/', async (_, reply) => reply.redirect(302, '/config/ui/patterns'));
  fastify.get('/collector/ui', async (_, reply) => reply.redirect(302, '/config/ui'));

  fastify.get('/config/css/*', async (request, reply) => {
    const target = path.posix.join('css', request.params['*'] || '');
    noStore(reply).type('text/css; charset=utf-8');
    return reply.sendFile(target);
  });

  fastify.get('/config/js/*', async (request, reply) => {
    const target = path.posix.join('js', request.params['*'] || '');
    noStore(reply).type('application/javascript; charset=utf-8');
    return reply.sendFile(target);
  });

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
}

export default fp(staticRoutes);
