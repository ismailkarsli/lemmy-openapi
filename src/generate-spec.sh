#!/bin/sh
set -e

LATEST_LEMMY_VERSION=$(git -C ./lemmy-js-client for-each-ref refs/tags --sort=-committerdate --format='%(refname:short)' --count=1)

if [ -n "$LEMMY_VERSION" ]; then
  git -C ./lemmy-js-client checkout "tags/$LEMMY_VERSION"
else
  git -C ./lemmy-js-client checkout main
fi

LEMMY_VERSION=${LEMMY_VERSION:-$LATEST_LEMMY_VERSION} bun run generate || true
