#!/bin/bash
cd /opt/sapply-klm
set -a
source .env
set +a
exec node dist/server/src/index.js
