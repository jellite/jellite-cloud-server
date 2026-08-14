# Multi-stage build: compile TypeScript, then produce a slim runtime image with only
# production dependencies plus the read-only SQLite DB produced by the sync script.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/
COPY sync/package.json sync/
RUN npm install --workspace backend --ignore-scripts=false
COPY backend backend
RUN npm run build --workspace backend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/backend/package.json ./package.json
# npm workspaces hoist dependencies to the repo-root node_modules/ (there is no
# backend/node_modules/ unless a dependency can't be hoisted), so copy the root one.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist

# The sqlite DB is rebuilt locally by the sync script and baked in at deploy time — see
# infra/deploy.sh and docs/SPEC.md section 5/6. A placeholder empty file lets the image
# build even before the first sync has run; deploy.sh always overwrites this with the
# current DB before building.
COPY data/jellite.sqlite ./data/jellite.sqlite

ENV PORT=8080
ENV DB_PATH=/app/data/jellite.sqlite
EXPOSE 8080
CMD ["node", "dist/server.js"]
