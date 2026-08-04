FROM node:24.13.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/units/package.json packages/units/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY scripts/generate-logo-variants.mjs scripts/generate-logo-variants.mjs
COPY packages/shared packages/shared
COPY packages/permissions packages/permissions
COPY packages/ui packages/ui
COPY packages/units packages/units
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @engrove/web build

FROM node:24.13.0-bookworm-slim AS runtime
ENV PORT=4173
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/dist ./dist
COPY --chown=node:node deploy/docker/web-server.mjs ./server.mjs
USER node
EXPOSE 4173
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD ["node", "-e", "fetch('http://127.0.0.1:4173/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]
