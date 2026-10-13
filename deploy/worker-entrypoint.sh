#!/bin/sh
set -eu
umask 0077
# Render mounts an initially root-owned disk here. Only initialize this dedicated mount.
mkdir -p /var/lib/blog-worker
chown node:node /var/lib/blog-worker
exec gosu node "$@"
