#!/bin/bash

# Script to build and push Docker images for frontend and backend
# Usage: ./build_and_push.sh [registry] [tag]
# Example: ./build_and_push.sh myregistry.io/myorg latest
# Example: ./build_and_push.sh myregistry.io/myorg v1.0.0

set -e  # Exit on error

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Default values
REGISTRY="${1:-juney329}"
TAG="${2:-latest}"

# Image names
FRONTEND_IMAGE="${REGISTRY}/frontend-test:${TAG}"
BACKEND_IMAGE="${REGISTRY}/backend-test:${TAG}"

echo "========================================="
echo "Building and Pushing Docker Images"
echo "========================================="
echo "Registry/Base: $REGISTRY"
echo "Tag: $TAG"
echo "Frontend Image: $FRONTEND_IMAGE"
echo "Backend Image: $BACKEND_IMAGE"
echo "========================================="
echo ""

# Build frontend
echo "Building frontend image..."
docker build --platform linux/amd64 -f frontend/Dockerfile -t "$FRONTEND_IMAGE" .

# Build backend
echo "Building backend image..."
docker build --platform linux/amd64 -f backend/Dockerfile -t "$BACKEND_IMAGE" .

# Push frontend
echo "Pushing frontend image..."
docker push "$FRONTEND_IMAGE"

# Push backend
echo "Pushing backend image..."
docker push "$BACKEND_IMAGE"

echo ""
echo "========================================="
echo "✅ Successfully built and pushed images!"
echo "========================================="
echo "Frontend: $FRONTEND_IMAGE"
echo "Backend: $BACKEND_IMAGE"
