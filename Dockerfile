# gateway/Dockerfile

FROM node:18-alpine AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install all dependencies for building
RUN npm ci

# Production stage
FROM node:18-alpine

RUN apk add --no-cache \
    tini \
    curl \
    sqlite \
    dumb-init

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy from builder
COPY --from=builder --chown=nodejs:nodejs /build/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Create required directories
RUN mkdir -p /app/data \
    /app/drop-folder \
    /app/drop-folder/quarantine \
    /app/backups \
    /app/logs && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 8080 6661 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node scripts/health-check.js

# Use dumb-init as init
ENTRYPOINT ["dumb-init", "--"]

# Start gateway
CMD ["node", "src/index.js"]