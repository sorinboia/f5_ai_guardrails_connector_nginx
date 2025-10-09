// /etc/nginx/njs/utils.js

// --- Minimal JSON safe stringify
export function safeJson(v) {
  try { return JSON.stringify(v); } catch (_) { return '[unserializable]'; }
}

// --- Lightweight, njs-friendly logger
// opts: { log: boolean | 'debug'|'info'|'warn'|'err', r?: <request> }
export function makeLogger(opts) {
  const enabled = !!(opts && opts.log); // boolean or string level
  const level   = (opts && typeof opts.log === 'string') ? opts.log : 'debug';
  const r       = opts && opts.r;

  const levels  = { debug: ngx.DEBUG, info: ngx.INFO, warn: ngx.WARN, err: ngx.ERR };

  function emit(msg, lvl) {
    if (!enabled) return;
    const lv = levels[lvl || level] || levels.debug;
    const s  = (typeof msg === 'string') ? msg : safeJson(msg);

    // r.log has no explicit level; treat as info+ to avoid ngx.DEBUG noise in prod
    if (r && r.log && lv !== ngx.DEBUG) {
      r.log(s);
    } else {
      ngx.log(lv, s);
    }
  }
  return emit;
}

/**
 * extractJoin
 * Extracts values from an object using JSON-path-like selectors and joins them.
 *   root:      object to search
 *   searches:  array like ['.a.b', '.arr[-1].x']
 *   delimiter: appended between extracted values
 *   opts:      { log: boolean | level, r: <request> }
 */
export function extractJoin(root, searches, delimiter, opts) {
  const log = makeLogger(opts);
  log('extractJoin: start', 'info');
  log({ root_type: typeof root, searches, delimiter });

  if (!root || !Array.isArray(searches)) {
    log('extractJoin: invalid inputs (returning empty string)', 'warn');
    return '';
  }

  function resolvePath(obj, path) {
    log({ step: 'resolvePath:begin', path });
    if (!path || path[0] !== '.') {
      log('resolvePath: path must start with "."', 'warn');
      return undefined;
    }

    // token: .key OR .key[index]
    const re = /\.([A-Za-z0-9_]+)(?:\[(\-?\d+)\])?/g;
    let cur = obj, m, idxStr;

    while ((m = re.exec(path)) !== null) {
      const key    = m[1];
      const hasIdx = m[2] !== undefined;
      idxStr       = m[2];

      log({ step: 'token', key, hasIdx, idx: idxStr });

      if (cur == null || typeof cur !== 'object' || !(key in cur)) {
        log({ step: 'missing_key', key, cur_type: typeof cur }, 'warn');
        return undefined;
      }

      cur = cur[key];
      log({ step: 'after_key', value_type: typeof cur, isArray: Array.isArray(cur) });

      if (hasIdx) {
        if (!Array.isArray(cur)) {
          log({ step: 'index_on_non_array', key }, 'warn');
          return undefined;
        }
        let idx = parseInt(idxStr, 10);
        if (idx === -1) idx = cur.length - 1;
        if (idx < 0 || idx >= cur.length) {
          log({ step: 'index_oob', idx, length: cur.length }, 'warn');
          return undefined;
        }
        cur = cur[idx];
        log({ step: 'after_index', idx, value_type: typeof cur, isArray: Array.isArray(cur) });
      }
    }

    log({ step: 'resolvePath:end', result_type: typeof cur, isArray: Array.isArray(cur) });
    return cur;
  }

  let out = '';
  for (let i = 0; i < searches.length; i++) {
    const path = String(searches[i]);
    log({ step: 'iterate', i, path });

    const v = resolvePath(root, path);
    let s = '';

    if (v === undefined || v === null) {
      log({ step: 'value_unresolved_or_null', value: v }, 'debug');
      s = '';
    } else if (typeof v === 'object') {
      s = safeJson(v);
      log({ step: 'value_object_stringified', snippet: s.slice(0, 200) });
    } else {
      s = String(v);
      log({ step: 'value_primitive', value: s });
    }

    out += s + (delimiter ?? '');
  }

  log({ step: 'extractJoin:end', length: out.length, preview: out.slice(0, 200) }, 'info');
  return out;
}
