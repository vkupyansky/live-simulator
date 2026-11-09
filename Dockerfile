# syntax=docker/dockerfile:1.24.0@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM node:24.22.2-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d AS node-os
RUN apt-get update \
    && apt-get install --yes --no-install-recommends zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1 \
    && rm -rf /var/lib/apt/lists/*

FROM node-os AS node-base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN npm install --global pnpm@11.13.1
WORKDIR /workspace

FROM node-base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm config set store-dir /pnpm/store \
    && pnpm fetch --frozen-lockfile

FROM dependencies AS quality
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm format:check
RUN pnpm lint
RUN pnpm typecheck
RUN pnpm test
RUN pnpm audit --prod --audit-level high

FROM quality AS frontend-build
ENV NODE_ENV=production
RUN pnpm build

FROM quality AS api-build
ENV NODE_ENV=production
RUN pnpm api:build
RUN pnpm --filter @live/api deploy --prod /runtime

FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48 AS verifier
COPY --from=node-base /usr/local /usr/local
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/package.json
RUN --mount=type=cache,id=pnpm-e2e,target=/pnpm/store pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile
COPY --chown=pwuser:pwuser . .
USER pwuser
ENTRYPOINT ["pnpm"]
CMD ["e2e"]

FROM caddy:2.11.9-builder-alpine@sha256:d26fbc8a56ed8c3c1534f5573162d148ad3ed41732665da8526eb181fac0b728 AS caddy-build
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    xcaddy build v2.11.9 --output /usr/bin/caddy \
    --replace golang.org/x/net=golang.org/x/net@v0.62.0

FROM caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee AS frontend-runtime
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
RUN apk del --no-cache curl libcap \
    && addgroup -g 10001 caddy \
    && adduser -D -u 10001 -G caddy caddy \
    && mkdir -p /srv /data /config /tmp/caddy \
    && chown -R caddy:caddy /srv /data /config /tmp/caddy
COPY --from=frontend-build --chown=caddy:caddy /workspace/dist /srv
COPY --chown=caddy:caddy Caddyfile /etc/caddy/Caddyfile
USER caddy
WORKDIR /srv
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

FROM node-os AS api-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-build --chown=node:node /runtime ./
RUN rm -f /app/pnpm-lock.yaml \
    /usr/local/bin/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg \
    && rm -rf \
    /opt/yarn-v1.22.22 \
    /usr/local/include/node \
    /usr/local/lib/node_modules/corepack \
    /usr/local/lib/node_modules/npm
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "dist/server.js"]
