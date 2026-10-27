FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY src/client/package.json ./src/client/package.json
COPY src/server/package.json ./src/server/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
EXPOSE 3000
VOLUME /data
CMD ["node", "dist/server/index.js"]
