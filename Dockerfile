# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
RUN pnpm install --frozen-lockfile
RUN pnpm -r test && pnpm --filter @fieldkit/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 FIELDKIT_AUDIT=/data/audit.jsonl
RUN addgroup -S app && adduser -S app -G app && mkdir /data && chown app:app /data
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/examples ./examples
USER app
VOLUME /data
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node", "server.js"]
