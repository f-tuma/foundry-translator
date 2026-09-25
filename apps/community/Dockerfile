FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS build
WORKDIR /workspace/apps/community
COPY apps/community/package*.json ./
RUN npm ci
COPY src /workspace/src
COPY apps/community ./
RUN npm run build
FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/community/.output .output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
