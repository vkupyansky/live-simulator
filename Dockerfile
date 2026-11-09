# syntax=docker/dockerfile:1.24.0@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573 AS node-base
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

FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d AS verifier
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

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS frontend-runtime
RUN setcap -r /usr/bin/caddy \
    && apk del --no-cache curl libcap \
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

FROM node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573 AS api-runtime
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
