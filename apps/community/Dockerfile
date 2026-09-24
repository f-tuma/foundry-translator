FROM node:22-bookworm-slim AS build
WORKDIR /workspace/apps/community
COPY apps/community/package*.json ./
RUN npm ci
COPY src /workspace/src
COPY apps/community ./
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/community/.output .output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
