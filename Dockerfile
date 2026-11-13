# Family gift questionnaire: one small Node process, no npm dependencies.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app
COPY server.js questions.default.json ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN apk add --no-cache su-exec && chmod 755 /usr/local/bin/docker-entrypoint.sh

# The entrypoint fixes ownership of /data, then drops to PUID:PGID (default 1000:1000).
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
