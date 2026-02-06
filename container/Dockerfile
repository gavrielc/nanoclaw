# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM oven/bun:1-debian

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and claude-code globally
# Runs as root; make /root traversable so bun user can follow symlinks in /usr/local/bin
RUN bun install -g agent-browser @anthropic-ai/claude-code \
    && chmod o+x /root \
    && chmod -R o+rX /root/.bun

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package.json agent-runner/bun.lockb ./

# Install dependencies
RUN bun install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN bun run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks

# Create entrypoint script
# Sources env from mounted /workspace/env-dir/env if it exists (workaround for Apple Container -i bug)
RUN printf '#!/bin/bash\nset -e\nif [ -f /workspace/env-dir/env ]; then\n  set -a\n  source /workspace/env-dir/env\n  set +a\nfi\ncat > /tmp/input.json\nbun /app/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to bun user (non-root) for writable directories
RUN chown -R bun:bun /workspace

# Switch to non-root user (required for --dangerously-skip-permissions)
USER bun

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
