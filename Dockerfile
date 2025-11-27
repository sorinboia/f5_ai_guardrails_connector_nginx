FROM nginx:1.29-alpine


RUN apk update && \
    apk add --no-cache nginx-module-njs
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

EXPOSE 11434 11443
CMD ["nginx", "-g", "daemon off;"]
