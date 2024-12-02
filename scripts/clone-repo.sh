#!/bin/sh

URL=${URL:-"https://github.com/LemmyNet/lemmy-js-client.git"}

if [ -d "lemmy-js-client"  ]; then
  rm -rf lemmy-js-client
fi

git clone "$URL"
cd lemmy-js-client || exit 1
git fetch --all --tags
