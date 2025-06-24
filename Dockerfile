# ---- Base image ----
FROM node:18-alpine AS base
WORKDIR /app

# ---- Install ALL deps for build (including devDeps) ----
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ---- Build stage ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- Production image ----
FROM node:18-alpine AS release
WORKDIR /app
ENV NODE_ENV=production

# Only prod deps here
COPY package*.json ./
RUN npm ci --omit=dev

# Copy build output
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.js ./

EXPOSE 3000
CMD ["npm", "run", "start"]

