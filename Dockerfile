# Production image: builds the web app and server bundle, then runs on Node 22.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
COPY package.json ./
EXPOSE 3000
USER node
CMD ["node", "dist/server/main.mjs"]
