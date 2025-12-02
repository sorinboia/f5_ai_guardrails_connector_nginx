FROM nginx:1.29-alpine


RUN apk update && \
    apk add --no-cache nginx-module-njs mitmproxy
# Ensure shared dict state path is writable by nginx worker processes.
RUN mkdir -p /var/cache/nginx && chown -R nginx:nginx /var/cache/nginx
# Shared mitmproxy home so certs are readable by nginx for download.
RUN mkdir -p /var/lib/mitmproxy && chmod 755 /var/lib/mitmproxy
# Copy custom global config (falls back to image default if missing).
COPY nginx.conf /etc/nginx/nginx.conf
COPY fastcgi.conf fastcgi_params scgi_params uwsgi_params mime.types /etc/nginx/

# Copy any vhost / upstream configs.
COPY conf.d/ /etc/nginx/conf.d/

# Copy server-side JS (njs) scripts.
COPY njs/ /etc/nginx/njs/

# Copy dynamic modules if present.

# Copy TLS materials (optional but preserves local layout).
COPY certs/ /etc/nginx/certs/

# Copy site/application assets into the default web root.
COPY html/ /etc/nginx/html/

# mitmproxy add-on for traffic redirection.
COPY mitmproxy.py /etc/nginx/mitmproxy.py

EXPOSE 11434 11443 10000
CMD ["sh", "-c", "umask 022; mkdir -p /var/lib/mitmproxy; mitmdump --set confdir=/var/lib/mitmproxy --mode regular --listen-host 0.0.0.0 --listen-port 10000 -s /etc/nginx/mitmproxy.py --ssl-insecure & exec nginx -g 'daemon off;'"]
