FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Install all deps (including dev) for the build
COPY package*.json ./
RUN npm ci

# Copy source and run the build
COPY . .
RUN npm run build

# ---- production image ----
FROM node:20-alpine
WORKDIR /usr/src/app

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built output from builder
COPY --from=builder /usr/src/app/dist ./dist
# If you need other runtime files, copy them too (public, etc.)
# COPY --from=builder /usr/src/app/public ./public

# Set environment
ENV NODE_ENV=production
EXPOSE 3001

# Optional healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/health || exit 1

# Start the built app (ensure package.json "start" points to dist entry)
CMD ["npm", "start"]