FROM nginx:1.27-alpine
COPY index.html /usr/share/nginx/html/index.html
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
