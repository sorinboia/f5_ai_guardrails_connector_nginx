// /etc/nginx/njs/sideband_client.js

export async function callSideband(log, url, bearer, ua, payload, timeoutMs) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': ua,
    'authorization': `Bearer ${bearer}`
  };

  log({ step: 'sideband:request', url, headers: { ...headers, authorization: '[redacted]' } }, 'debug');

  const options = { method: 'POST', headers, body: payload };
  const timeout = Number(timeoutMs || 0);
  if (timeout > 0) {
    options.timeout = timeout;
  }

  // njs builds before 0.8 shipped fetch on `ngx.fetch`; newer builds expose a
  // global `fetch`.  Pick whichever exists to avoid `TypeError: not a function`
  // when one of them is missing.
  const fetchFn =
    (typeof globalThis.fetch === 'function')
      ? globalThis.fetch
      : (typeof ngx.fetch === 'function' ? ngx.fetch.bind(ngx) : undefined);

  try {
    if (!fetchFn) {
      throw new Error('fetch is not available in this njs build');
    }

    const reply  = await fetchFn(url, options);
    const status = reply.status;
    let text = '';
    try {
      text = await reply.text();
    } catch (_) {
      // omit noisy fetch errors
    }

    log({ step: 'sideband:response', status, preview: text.slice(0, 200) }, 'debug');
    return { status, text };
  } catch (err) {
    log({ step: 'sideband:error', error: String(err), timeout_ms: timeout }, 'warn');
    return { status: 599, text: '' };
  }
}
