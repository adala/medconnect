FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

COPY package.json package-lock.json ./

COPY *.json ./

# Install dependencies
RUN npm install

# Copy application
COPY . .
COPY ./src /app/src

# Create data directory
RUN mkdir -p /app/data /app/logs /app/drop-folder/quarantine

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Start the application
CMD ["node", "index.js"]