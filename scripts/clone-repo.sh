#!/bin/sh

URL=${URL:-"https://github.com/LemmyNet/lemmy-js-client/archive/refs/heads/main.zip"}

if [ -d "lemmy-js-client"  ]; then
  rm -rf lemmy-js-client
fi

curl -L "$URL" -o lemmy-js-client.zip
unzip lemmy-js-client.zip
rm lemmy-js-client.zip
mv lemmy-js-client-main lemmy-js-client
