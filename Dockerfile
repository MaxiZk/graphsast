# syntax=docker/dockerfile:1
#
# Imagen del CLI. Uso:
#   docker build -t graphsast .
#   docker run --rm -v "$PWD:/src:ro" graphsast scan .
#   docker run --rm -v "$PWD:/src:ro" graphsast scan . --format sarif > graphsast.sarif
#
# `graphsast serve` no sirve desde un contenedor: la API solo acepta
# conexiones de 127.0.0.1, y las del host llegan desde la red de Docker.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/viz/package.json packages/viz/
RUN npm ci --workspace @graphsast/core --include-workspace-root
COPY packages/core packages/core
RUN npm run build -w @graphsast/core

# Solo las dependencias de producción del core, sin las de la web.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/viz/package.json packages/viz/
RUN npm ci --omit=dev --workspace @graphsast/core --include-workspace-root

FROM gcr.io/distroless/nodejs22-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/MaxiZk/graphsast" \
      org.opencontainers.image.description="GraphSAST: análisis de flujo de datos (taint) para JavaScript, TypeScript, Python, Java, PHP y Go" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/core/grammars packages/core/grammars
COPY catalog catalog
COPY LICENSE LICENSE
WORKDIR /src
ENTRYPOINT ["/nodejs/bin/node", "/app/packages/core/dist/cli/graphsast.cli.js"]
CMD ["--help"]
