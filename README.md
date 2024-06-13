# chs-dev

A CLI tool for spinning up a CHS like system local in a Docker environment
orchestrated using Docker Compose.

## Installing

To install the latest version CLI run the following command:

```sh
curl -s -L \
    https://raw.githubusercontent.com/companieshouse/chs-dev/main/install.sh |
    bash -c -
```

You will need to add `${HOME}/.companies_house_config/bin` to your path:

```sh
$ printf -- 'export PATH="${PATH}":"${HOME}"/.companies_house_config/bin' >> ~/.bashrc # or ~/.zshrc if using Zsh

$
```

To verify installation open a new terminal and run:

```sh
$ chs-dev --version
chs-dev/0.1.0 darwin-arm64 node-v20.10.0
$
```
