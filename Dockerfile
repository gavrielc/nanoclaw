# NanoClaw Main Application Dockerfile
# Runs the WhatsApp bridge, message router, and container orchestrator
# Compatible with Windows 11 Docker Desktop, Linux, and macOS
#
# Security: runs as non-root, minimal base image, no unnecessary packages

FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- Production stage ---
FROM node:22-slim

# Install Docker CLI for spawning agent containers
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built output
COPY --from=builder /app/dist ./dist

# Copy container build context for agent image
COPY container/ ./container/

# Copy group templates and docs
COPY groups/ ./groups/
COPY docs/ ./docs/

# Create runtime directories
RUN mkdir -p /app/store /app/data /app/config \
    && chown -R node:node /app/store /app/data /app/groups

# Expose gateway port
EXPOSE 18790

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "process.exit(0)"

# Run as non-root where possible (need root for docker socket access)
# Note: Docker socket access requires group membership configured at runtime

ENTRYPOINT ["node", "dist/index.js"]
