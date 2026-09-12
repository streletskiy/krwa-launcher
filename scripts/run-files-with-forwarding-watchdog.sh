#!/bin/sh
set -eu

health_uri="${FORWARDING_HEALTH_URI:-http://host.docker.internal:8088/health.json}"
interval_seconds="${FORWARDING_HEALTH_INTERVAL_SECONDS:-30}"
failure_limit="${FORWARDING_HEALTH_FAILURES:-3}"
monitor_pid=''

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

stop_processes() {
    trap - INT TERM
    if kill -0 "$caddy_pid" 2>/dev/null; then
        kill -TERM "$caddy_pid" 2>/dev/null || true
    fi
    if [ -n "$monitor_pid" ]; then
        kill "$monitor_pid" 2>/dev/null || true
    fi
    wait "$caddy_pid" 2>/dev/null || true
    exit 0
}
trap stop_processes INT TERM

(
    failures=0
    while kill -0 "$caddy_pid" 2>/dev/null; do
        sleep "$interval_seconds"
        if wget -q -T 10 -O /dev/null "$health_uri"; then
            failures=0
            continue
        fi

        failures=$((failures + 1))
        echo "Published Caddy health check failed ($failures/$failure_limit): $health_uri" >&2
        if [ "$failures" -ge "$failure_limit" ]; then
            echo 'Restarting Caddy container to refresh Docker Desktop port forwarding.' >&2
            kill -TERM "$caddy_pid" 2>/dev/null || true
            exit 0
        fi
    done
) &
monitor_pid=$!

set +e
wait "$caddy_pid"
caddy_status=$?
set -e
kill "$monitor_pid" 2>/dev/null || true
wait "$monitor_pid" 2>/dev/null || true
exit "$caddy_status"
