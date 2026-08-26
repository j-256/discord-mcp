ARG NODE_IMAGE=node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY .npmrc package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev --ignore-scripts \
  && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=0.1.0
ARG REVISION=local

LABEL org.opencontainers.image.title="Discord MCP" \
  org.opencontainers.image.description="Least-privilege Discord MCP for privacy-safe reads, audits, and reviewed administration" \
  org.opencontainers.image.url="https://github.com/j-256/discord-mcp" \
  org.opencontainers.image.source="https://github.com/j-256/discord-mcp" \
  org.opencontainers.image.documentation="https://github.com/j-256/discord-mcp/blob/v${VERSION}/README.md" \
  org.opencontainers.image.licenses="AGPL-3.0-only" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.revision="${REVISION}" \
  io.modelcontextprotocol.server.name="io.github.j-256/discord-mcp"

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json LICENSE ./

USER node
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["catalog"]
