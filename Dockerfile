FROM node:20-alpine

# Set workdir
WORKDIR /usr/src/app

# Install dependencies using lockfile for reproducibility
COPY package*.json ./
# If you need dev deps (e.g., building TypeScript), do a multi-stage build instead.
RUN npm ci --omit=dev

# Copy the rest of the source
COPY . .

# Set environment
ENV NODE_ENV=production

# Your app should listen on 3001 inside the container
EXPOSE 3001

# Optional healthcheck hitting a /health endpoint if you have one
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/health || exit 1

# Use a production start script (ensure package.json has "start")
CMD ["npm", "start"]