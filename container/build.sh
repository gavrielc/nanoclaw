#!/bin/bash
# Build the NanoClaw agent container image
# Supports both Docker and Apple Container runtimes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"
RUNTIME="${CONTAINER_RUNTIME:-docker}"

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"
echo "Runtime: ${RUNTIME}"

if [ "$RUNTIME" = "apple-container" ] || [ "$RUNTIME" = "container" ]; then
  container build -t "${IMAGE_NAME}:${TAG}" .
else
  docker build -t "${IMAGE_NAME}:${TAG}" .
fi

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
if [ "$RUNTIME" = "apple-container" ] || [ "$RUNTIME" = "container" ]; then
  echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | container run -i ${IMAGE_NAME}:${TAG}"
else
  echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | docker run --rm -i ${IMAGE_NAME}:${TAG}"
fi
