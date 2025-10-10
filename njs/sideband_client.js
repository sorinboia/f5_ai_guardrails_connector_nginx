// /etc/nginx/njs/sideband_client.js

export async function callSideband(log, url, bearer, ua, payload) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': ua,
    'authorization': `Bearer ${bearer}`
  };

  log({ step: 'sideband:request', url, headers: { ...headers, authorization: '[redacted]' } }, 'debug');

  const reply  = await ngx.fetch(url, { method: 'POST', headers, body: payload });
  const status = reply.status;
  let text = '';
  try {
    text = await reply.text();
  } catch (_) {
    // omit noisy fetch errors
  }

  log({ step: 'sideband:response', status, preview: text.slice(0, 200) }, 'debug');
  return { status, text };
}
