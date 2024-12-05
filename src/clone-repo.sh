#!/bin/sh
set -e

if [ -d "lemmy-js-client"  ]; then
  rm -rf lemmy-js-client
fi

git clone "https://github.com/LemmyNet/lemmy-js-client.git"
git -C ./lemmy-js-client fetch --all --tags --prune
