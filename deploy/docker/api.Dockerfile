FROM node:24.13.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/units/package.json packages/units/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/config packages/config
COPY packages/database packages/database
COPY packages/permissions packages/permissions
COPY packages/shared packages/shared
COPY packages/units packages/units
RUN pnpm --filter @engrove/api build

FROM node:24.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/packages/database/drizzle ./migrations
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
