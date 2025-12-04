import http from 'http';
import https from 'https';
import net from 'net';
import { normalizeHostName } from './config/validate.js';

function isDestinationAllowed(store, host) {
  if (!host) return false;
  const normalized = normalizeHostName(host);
  if (normalized === '__default__') return false;
  const hosts = store?.hosts || [];
  const configs = store?.hostConfigs || {};
  return hosts.includes(normalized) || Boolean(configs[normalized]);
}

function resolveLocalTargetFromUrl(url, config) {
  const isHttps = url.protocol === 'https:' || url.port === '443';
  if (isHttps) {
    if (config.https?.enabled && config.https.port) {
      return { scheme: 'https', port: config.https.port };
    }
    return null;
  }
  return { scheme: 'http', port: config.httpPort };
}

function resolveLocalTargetFromConnect(hostname, port, config) {
  const portNum = Number(port) || 0;
  const isHttps = portNum === 443;
  if (isHttps) {
    if (config.https?.enabled && config.https.port) {
      return { scheme: 'https', port: config.https.port };
    }
    return null;
  }
  return { scheme: 'http', port: config.httpPort };
}

function respondForbiddenSocket(socket, message = 'Destination not allowed by forward proxy configuration') {
  const body = `HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(message)}\r\nconnection: close\r\n\r\n${message}`;
  socket.write(body);
  socket.destroy();
}

function respondHttpError(res, statusCode, message) {
  const body = { error: 'forward_proxy_rejected', message };
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function forwardHttpRequest(req, res, context) {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url);
  } catch (err) {
    context.logger.warn({ step: 'forward_proxy:bad_url', url: req.url });
    respondHttpError(res, 400, 'Forward proxy expects absolute-form request URLs');
    return;
  }

  const destinationHost = parsedUrl.hostname;
  if (!isDestinationAllowed(context.store, destinationHost)) {
    context.logger.warn({ step: 'forward_proxy:denied', host: destinationHost });
    respondHttpError(res, 403, 'Destination not allowed');
    return;
  }

  const target = resolveLocalTargetFromUrl(parsedUrl, context.config);
  if (!target) {
    context.logger.error({ step: 'forward_proxy:https_disabled', host: destinationHost });
    respondHttpError(res, 503, 'HTTPS inspection is disabled on this proxy');
    return;
  }

  const headers = { ...req.headers, host: parsedUrl.host };
  delete headers.connection;
  delete headers['proxy-connection'];
  const requestOptions = {
    protocol: `${target.scheme}:`,
    hostname: '127.0.0.1',
    port: target.port,
    method: req.method,
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers,
    rejectUnauthorized: false
  };

  const forward = (target.scheme === 'https' ? https : http).request(requestOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  forward.on('error', (err) => {
    context.logger.error({ step: 'forward_proxy:http_error', host: destinationHost, err: err?.message || String(err) });
    if (!res.headersSent) {
      respondHttpError(res, 502, 'Forward proxy upstream error');
    } else {
      res.destroy();
    }
  });

  req.pipe(forward);
}

function handleConnect(req, clientSocket, head, context) {
  const targetText = req.url || '';
  let hostname = '';
  let portText = '';
  // Accept host:port or [ipv6]:port
  if (targetText.startsWith('[')) {
    const closing = targetText.indexOf(']');
    hostname = targetText.slice(1, closing);
    portText = targetText.slice(closing + 2) || '';
  } else {
    [hostname, portText] = targetText.split(':');
  }

  const destinationHost = hostname;
  if (!isDestinationAllowed(context.store, destinationHost)) {
    context.logger.warn({ step: 'forward_proxy:connect_denied', host: destinationHost });
    respondForbiddenSocket(clientSocket);
    return;
  }

  const target = resolveLocalTargetFromConnect(destinationHost, portText, context.config);
  if (!target) {
    context.logger.error({ step: 'forward_proxy:connect_https_disabled', host: destinationHost });
    respondForbiddenSocket(clientSocket, 'HTTPS inspection is disabled on this proxy');
    return;
  }

  const serverSocket = net.connect(target.port, '127.0.0.1', () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) serverSocket.write(head);
    clientSocket.pipe(serverSocket);
    serverSocket.pipe(clientSocket);
  });

  const onError = (err, label) => {
    context.logger.error({ step: 'forward_proxy:connect_error', host: destinationHost, label, err: err?.message || String(err) });
    clientSocket.destroy();
    serverSocket.destroy();
  };

  serverSocket.on('error', (err) => onError(err, 'server'));
  clientSocket.on('error', (err) => onError(err, 'client'));
}

export function startForwardProxy(config, store, logger) {
  if (!config.forwardProxy?.enabled) {
    logger.info({ step: 'forward_proxy:disabled' }, 'Forward proxy listener disabled');
    return null;
  }

  const server = http.createServer((req, res) => forwardHttpRequest(req, res, { config, store, logger }));
  server.on('connect', (req, clientSocket, head) => handleConnect(req, clientSocket, head, { config, store, logger }));
  server.on('clientError', (err, socket) => {
    logger.warn({ step: 'forward_proxy:client_error', err: err?.message || String(err) });
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.listen({ port: config.forwardProxy.port, host: '0.0.0.0' }, () => {
    logger.info({ port: config.forwardProxy.port }, 'Forward proxy listener started');
  });

  return server;
}
