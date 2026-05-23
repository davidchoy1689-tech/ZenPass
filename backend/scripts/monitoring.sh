#!/bin/bash
# ZenPass Monitoring Setup
# Simple health check that can be used with Healthchecks.io or Better Uptime
#
# Setup with Healthchecks.io:
#   1. Create free account at https://healthchecks.io
#   2. Create a check and get your UUID
#   3. Add cron: */5 * * * * /path/to/scripts/monitoring.sh
#
# Healthchecks.io — free, works great with cron
# Better Uptime — paid, has real browser monitoring

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_URL="http://localhost:3001/api/health"
HEALTHCHECKS_URL=""  # Set to: https://hc-ping.com/YOUR_UUID

# Check if API is responding
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Health check passed ($HTTP_CODE)"
    # Ping healthchecks.io if configured
    if [ -n "$HEALTHCHECKS_URL" ]; then
        curl -fsS -m 10 "$HEALTHCHECKS_URL" > /dev/null 2>&1 || true
    fi
else
    echo "❌ Health check failed (HTTP $HTTP_CODE)"
    # Try to restart the process
    echo "   Attempting restart..."
    cd "$BACKEND_DIR"
    node src/index.js &
    # Ping healthchecks.io with failure signal
    if [ -n "$HEALTHCHECKS_URL" ]; then
        curl -fsS -m 10 "${HEALTHCHECKS_URL}/fail" > /dev/null 2>&1 || true
    fi
fi
