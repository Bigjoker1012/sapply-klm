#!/bin/bash
# Deploy script for sapply-klm
# Usage: ./deploy.sh
set -e

cd /opt/sapply-klm

echo "=== Git pull ==="
git pull

echo "=== Build ==="
npm run build

echo "=== PM2 restart ==="
pm2 restart sapply-klm

echo "=== PM2 save ==="
pm2 save

echo "=== Done ==="
pm2 list
