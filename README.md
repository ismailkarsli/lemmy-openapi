# Lemmy OpenAPI

Auto-generated Lemmy OpenAPI files from [lemmy-js-client](https://github.com/LemmyNet/lemmy-js-client).

## Use schema

- JSON: <https://openapi.lemy.lol/openapi.json?server=lemmy.ml&version=0.19.6>
- YAML: <https://openapi.lemy.lol/openapi.json?server=lemmy.ml&version=0.19.6>

| parameter | required | default |
| --- | --- | --- |
| server | false | lemy.lol |
| version | false | last version of lemmy-js-client |

## Generate

- Clone this repo.
- Run `bun install` to install dependencies.
- Run `./src/clone-repo.sh` to clone lemmy-js-client repo.
- Run `LEMMY_VERSION=0.20.0 ./src/generate-spec.sh` to generate OpenAPI schema.
`LEMMY_VERSION` is the target version. By default its the latest git tag.
