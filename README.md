# Lemmy OpenAPI

Auto-generated Lemmy OpenAPI files from [lemmy-js-client](https://github.com/LemmyNet/lemmy-js-client).

## Use schema

- UI: <https://openapi.lemy.lol/?server=lemy.lol>
- JSON: <https://openapi.lemy.lol/openapi.json?server=lemmy.ml&version=0.19.6>
- YAML: <https://openapi.lemy.lol/openapi.json?server=lemmy.ml&version=0.19.6>

| parameter | required | default |
| --- | --- | --- |
| server | false | lemy.lol |
| version | false | the most compatible version with the instance |

> In cases where the server is given but the version is not, the proxy tries to choose the version of lemmy-js-client that matches the version of the instance. If it cannot find it, it returns the latest version.

## Generate

- Clone this repo.
- Run `bun install` to install dependencies.
- Run `./src/clone-repo.sh` to clone lemmy-js-client repo.
- Run `LEMMY_VERSION=0.20.0 ./src/generate-spec.sh` to generate OpenAPI schema.
`LEMMY_VERSION` is the target version. By default its the latest git tag.
