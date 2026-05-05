# ── Stage 1: Build @idemos/common ────────────────────────────────────────────
FROM node:22-alpine AS common-builder
RUN apk add --no-cache git
WORKDIR /packages/common
RUN git clone https://github.com/Kevin-Caballero/idemos-common.git .
RUN npm install && npm run build

# ── Stage 2: Build etl ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /packages/common
COPY --from=common-builder /packages/common .
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=common-builder /packages/common /packages/common
CMD ["node", "dist/main"]
