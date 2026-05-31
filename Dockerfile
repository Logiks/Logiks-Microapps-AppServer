# syntax=docker/dockerfile:1.7

# --- Builder: install prod deps once, cached on package.json checksum ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# --- Runtime: minimal image with tini for proper signal handling ---
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache tini wget \
 && addgroup -S app && adduser -S app -G app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app . .

# config.json is intentionally NOT baked into the image; bind-mount it at runtime.
# .env is loaded by dotenv from the working dir; compose provides env via `environment:`.

USER app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9999

EXPOSE 9999

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
