# Petvold's images (ADR 0041). Three targets:
#   docker build --target api -t petvold-api .   # the API, relay, webhooks and runs; also runs the migrations
#   docker build --target web -t petvold-web .   # the back office as static files
#   docker build --target demo -t petvold-demo . # the demo service, never in production (docs/teknik/demotjanst.md)
# Base images at exact versions, at least two weeks old when chosen.

# Everything installed and the back office built.
FROM node:24.22.2-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
# Same origin as the API: the back office calls /v1 where it was served from.
ENV VITE_API_URL=""
RUN npm run ui:build

# Only what the server needs at run time.
FROM node:24.22.2-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY modules ./modules
COPY apps/backoffice/package.json ./apps/backoffice/package.json
RUN npm ci --omit=dev --no-audit --no-fund --workspaces --include-workspace-root && npm cache clean --force
COPY db ./db
# The design tokens, which the document templates read (ADR 0038).
COPY design/tokens.json ./design/tokens.json
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--import", "tsx", "modules/api/src/server.ts"]

FROM caddy:2.11.7-alpine AS web
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/backoffice/dist /srv
EXPOSE 8080

# The demo service (docs/teknik/demotjanst.md): its own process and database,
# and no code from Petvold's modules. The design files for its pages.
FROM node:24.22.2-bookworm-slim AS demo
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY apps/demo ./apps/demo
RUN npm ci --omit=dev --no-audit --no-fund --workspace @petvold/demo --include-workspace-root && npm cache clean --force
COPY apps/backoffice/src/styles/petvold-tokens.css ./apps/backoffice/src/styles/petvold-tokens.css
COPY design/components.css ./design/components.css
USER node
EXPOSE 8790
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.DEMO_PORT ?? 8790) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--import", "tsx", "apps/demo/src/server.ts"]
