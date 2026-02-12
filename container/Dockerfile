# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM oven/bun:slim

# Install Node.js (agents expect node/npm/npx to be available alongside bun)
# and system dependencies for Chromium (libs needed by agent-browser's bundled Chromium)
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
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

# Install GitHub CLI for PR creation and git authentication
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install agent-browser and claude-code globally, then download Chromium via bunx
# (agent-browser install hardcodes npx in its native binary, so we bypass it)
RUN bun install -g agent-browser @anthropic-ai/claude-code \
    && bunx playwright install chromium

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package.json agent-runner/bun.lock* ./

# Install dependencies
RUN bun install

# Copy source code
COPY agent-runner/ ./

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/server /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Copy entrypoint script
# Sources env, configures git, pre-installs cross-platform deps for host mounts,
# buffers stdin, then runs agent-runner
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R bun:bun /workspace

# Pre-warm tsgo (native TypeScript checker) so `npx tsgo` / `bunx tsgo` works.
# Host-mounted projects have darwin-arm64 binaries; npm global install puts the
# linux-arm64 binary in /usr/local/bin where all users can access it.
RUN npm install -g @typescript/native-preview @typescript/native-preview-linux-arm64

# Switch to non-root user (required for --dangerously-skip-permissions)

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
