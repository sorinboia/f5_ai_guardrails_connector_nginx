"""
mitmproxy addon to retarget specific hosts to fixed upstream IP/port pairs.

Configuration:
  MITM_TARGETS=<domain>=<host>:<port>[,<domain>=<host>:<port>...]
    - Example: "chatgpt.com=127.0.0.1:443,api.example.com=10.0.0.5:8443"
    - Scheme defaults to https; append "http://" or "https://" before host
      to override: "service.local=http://192.168.1.20:8080".
If MITM_TARGETS is unset or empty, a single default mapping is used:
  chatgpt.com -> 127.0.0.1:443 over https.
"""

import os
from typing import Dict, Optional

from mitmproxy import http

ENV_VAR_NAME = "MITM_TARGETS"

DEFAULT_TARGETS = {
    "chatgpt.com": {"host": "127.0.0.1", "port": 443, "scheme": "https"},
}


def _parse_targets(env_value: Optional[str]) -> Dict[str, Dict[str, object]]:
    """
    Parse MITM_TARGETS into a mapping of domain -> {host, port, scheme}.
    Accepts comma-separated pairs: domain=host:port or domain=scheme://host:port.
    Invalid entries are ignored.
    """
    if not env_value:
        return DEFAULT_TARGETS.copy()

    targets: Dict[str, Dict[str, object]] = {}
    for raw_entry in env_value.split(","):
        entry = raw_entry.strip()
        if not entry or "=" not in entry:
            continue

        domain, dest = entry.split("=", 1)
        domain = domain.strip().lower()
        if not domain:
            continue

        scheme = "https"
        addr = dest.strip()
        if "://" in addr:
            scheme, addr = addr.split("://", 1)
            scheme = scheme or "https"

        host, sep, port_text = addr.partition(":")
        if not sep or not host:
            continue

        try:
            port = int(port_text)
        except ValueError:
            continue

        targets[domain] = {"host": host, "port": port, "scheme": scheme}

    return targets or DEFAULT_TARGETS.copy()


TARGETS = _parse_targets(os.getenv(ENV_VAR_NAME))


def request(flow: http.HTTPFlow) -> None:
    """Rewrite upstream destination while preserving original Host/SNI."""
    pretty_host = flow.request.pretty_host.lower()
    target = TARGETS.get(pretty_host)
    if not target:
        return

    original_host_header = flow.request.host_header

    flow.request.scheme = target["scheme"]
    flow.request.host = target["host"]
    flow.request.port = target["port"]

    if original_host_header:
        flow.request.host_header = original_host_header
    else:
        # Fallback Host header so the backend still sees the original domain.
        flow.request.headers["Host"] = pretty_host
