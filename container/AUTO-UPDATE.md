# NanoClaw Auto-Update Guide

This document describes how to update NanoClaw instances to pick up the latest code and rebuild containers.

## Quick Update

```bash
# From the nanoclaw repo root:
./container/auto-update.sh
```

This script:
1. Pulls the latest code from GitHub
2. Rebuilds the container image with the new code
3. Provides instructions for restarting instances

## Manual Update Steps

If you prefer to update manually:

### 1. Pull Latest Code

```bash
cd /path/to/nanoclaw
git pull origin main
```

### 2. Rebuild Container

```bash
cd container
./build.sh latest
```

### 3. Restart Instances

**For local instances (Apple Container / Docker):**
```bash
# Find running instances
ps aux | grep agent-runner

# Stop instances
kill <pid>

# Restart with new image
# (Use your normal startup command)
```

**For cloud instances (Sprites on Fly.io):**
```bash
# Push new image to registry
fly deploy --app <app-name> --local-only

# Or use remote build
fly deploy --app <app-name>
```

## What's New

### Recent Updates (Feb 2026)

- **Go 1.25 Support**: Go is now pre-installed in the container image
  - Enables working with Go repositories (like ditto-assistant/backend)
  - `GOPATH=/workspace/go`, `GOBIN=/workspace/go/bin`
  - Go binaries available in PATH

### Container Image Changes

The Dockerfile now includes:
- Node.js, npm, bun (for JavaScript/TypeScript)
- Go 1.25 (for Go repositories)
- GitHub CLI (gh) for PR creation
- Git for version control
- TypeScript native checker (tsgo)

## Automated Updates

For production deployments, consider setting up automated updates:

### GitHub Actions Workflow

Create `.github/workflows/auto-update.yml`:

```yaml
name: Auto-Update Instances

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  rebuild-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build container image
        run: |
          cd container
          # Use Docker for GitHub Actions
          docker build -t nanoclaw-agent:latest .

      - name: Push to registry
        run: |
          # Push to your container registry
          # (Configure registry authentication as needed)

      - name: Deploy to Fly.io
        run: |
          # Deploy to cloud instances
          fly deploy --app nanoclaw-main
```

### Scheduled Updates

For automated updates on a schedule:

```yaml
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
```

## Rollback

If an update causes issues:

```bash
# Revert to previous commit
git reset --hard HEAD~1

# Rebuild with old code
cd container
./build.sh latest

# Restart instances
```

## Monitoring

After updating, verify instances are healthy:

```bash
# Check running instances
ps aux | grep agent-runner

# Check logs
tail -f /workspace/server/logs/*.log

# Test basic functionality
echo '{"prompt":"test","groupFolder":"test","chatJid":"test@g.us"}' | container run -i nanoclaw-agent:latest
```

## Troubleshooting

### Container Build Fails

- Check Dockerfile syntax
- Ensure all dependencies are available
- Verify network connectivity for package downloads

### Instances Won't Start

- Check if old instances are still running (kill them first)
- Verify environment variables are set correctly
- Check disk space: `df -h`

### Missing Dependencies

If Go or other tools are missing:
- Pull latest code: `git pull origin main`
- Rebuild: `./container/build.sh latest`
- Verify Dockerfile includes the dependency

## Related Documentation

- [Container README](./README.md)
- [Deployment Guide](../DEPLOYMENT.md)
- [Container Architecture](../docs/container-architecture.md)
