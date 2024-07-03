# chs-dev

A CLI tool for spinning up a CHS like system local in a Docker environment
orchestrated using Docker Compose.

## Table of Contents

1. [Installing](#installing)
1. [Usage](#usage)
1. [chs-dev Configuration](#chs-dev-configuration)

    1. [Environment configuration](#environment-configuration)
    1. [Service configuration](#service-configuration)
    1. [Builders](#builders)

## Installing

To install the latest version CLI run the following command:

```sh
curl -s -L \
    https://raw.githubusercontent.com/companieshouse/chs-dev/main/install.sh |
    bash -s
```

If using other options append following a `--` i.e.:

```sh
curl -s -L \
    https://raw.githubusercontent.com/companieshouse/chs-dev/main/install.sh |
    bash -s -- uninstall
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

### `install.sh` usage

The install script can manage the installation/uninstallation (or
reinstallation) of the chs-dev CLI. It can be use as follows

```sh
./install [OPTIONS] [COMMAND]
```

#### Options

* `-B` - installs current directory to local user profile (for testing)
* `-d <directory>` - specifies the installation directory (*Defaults to*
  *`${HOME}/.chs-dev`*)
* `-f` - forces the command and does not prompt user for input
* `-l <DEBUG|INFO|WARN|ERROR>` - specifies the Logging level (*Defaults to*
  *`INFO`*)
* `-S` - will prevent the Symlink file to be created
* `-s <directory>` - specifies the directory to add the symlink to, if there is
  already a local directory on your `PATH` which you can add symlinks to
  (*Defaults to `${HOME}/.companies_house_config/bin`*)
* `-v <version>` - when installing specifies the version of the CLI to use
  (*Defaults to the latest version*)
* `-W` - suppresses the warning about the `chs-dev` executable not being on the
  path
* `-h` - prints usage information and exits

#### COMMAND

Can be either:

* `install` - installs the CLI
* `uninstall` - removes the CLI and related files

#### Example usage

##### Install latest version

```sh
$ ./install.sh
[2024-06-13T13:30:49] - [INFO] - Installing version 1.1.4
[2024-06-13T13:30:49] - [INFO] - Downloading CLI tarball. Will take a few moments...
[2024-06-13T13:31:13] - [INFO] - chs-dev CLI installed successfully.
```

##### Install an explicit version (overwriting previous install)

```sh
$./install.sh -v 1.0.0  # installs version 1.0.0 of the CLI
[2024-06-13T13:32:04] - [WARN] - chs-dev (version chs-dev/1.1.4 darwin-arm64 node-v20.10.0) already installed
Do you want to reinstall chs-dev?
-- To continue press y
y
[2024-06-13T13:32:06] - [INFO] - Uninstalling CLI tool
[2024-06-13T13:32:07] - [INFO] - chs-dev CLI uninstalled successfully
[2024-06-13T13:32:07] - [INFO] - Installing version 1.0.0
[2024-06-13T13:32:07] - [INFO] - Downloading CLI tarball. Will take a few moments...
[2024-06-13T13:32:31] - [INFO] - chs-dev CLI installed successfully.
```

##### Uninstalling cli

```sh
$ ./install.sh uninstall
[2024-06-13T13:34:31] - [INFO] - Uninstalling CLI tool
This will uninstall chs-dev CLI do you want to continue?
-- To continue press y
y
[2024-06-13T13:34:34] - [INFO] - chs-dev CLI uninstalled successfully
```

##### Installing to different location (Without symlink)

```sh
$ ./install.sh -d "${HOME}"/.local/lib/chs-dev -S
...
$
```

## Usage

The chs-dev cli can be used with projects containing Docker Compose spec files.
It expects a directory `services` which contains `modules` directory and any
other directories containing services. `modules` contains directories
corresponding to modules, within the module directory are Docker Compose spec
files corresponding to services.

<!-- usage -->
```sh-session
$ npm install -g chs-dev
$ chs-dev COMMAND
running command...
$ chs-dev (--version)
chs-dev/0.1.0 darwin-arm64 node-v20.10.0
$ chs-dev --help [COMMAND]
USAGE
  $ chs-dev COMMAND
...
```
<!-- usagestop -->

### Commands

<!-- commands -->
* [`chs-dev autocomplete [SHELL]`](#chs-dev-autocomplete-shell)
* [`chs-dev compose-logs [SERVICENAME]`](#chs-dev-compose-logs-servicename)
* [`chs-dev development COMMAND [SERVICES]`](#chs-dev-development-command-services)
* [`chs-dev down`](#chs-dev-down)
* [`chs-dev exclusions COMMAND [EXCLUSIONS]`](#chs-dev-exclusions-command-exclusions)
* [`chs-dev help [COMMAND]`](#chs-dev-help-command)
* [`chs-dev logs [SERVICENAME]`](#chs-dev-logs-servicename)
* [`chs-dev modules COMMAND [MODULE]`](#chs-dev-modules-command-module)
* [`chs-dev reload SERVICE`](#chs-dev-reload-service)
* [`chs-dev service-logs [SERVICENAME]`](#chs-dev-service-logs-servicename)
* [`chs-dev services COMMAND [SERVICES]`](#chs-dev-services-command-services)
* [`chs-dev status`](#chs-dev-status)
* [`chs-dev sync`](#chs-dev-sync)
* [`chs-dev up`](#chs-dev-up)

## `chs-dev autocomplete [SHELL]`

display autocomplete installation instructions

```
USAGE
  $ chs-dev autocomplete [SHELL] [-r]

ARGUMENTS
  SHELL  shell type

FLAGS
  -r, --refresh-cache  Refresh cache (ignores displaying instructions)

DESCRIPTION
  display autocomplete installation instructions

EXAMPLES
  $ chs-dev autocomplete

  $ chs-dev autocomplete bash

  $ chs-dev autocomplete zsh

  $ chs-dev autocomplete --refresh-cache
```

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v0.2.1/src/commands/autocomplete/index.ts)_

## `chs-dev compose-logs [SERVICENAME]`

```
USAGE
  $ chs-dev compose-logs [SERVICENAME] [-C] [-f] [-n <value>]

ARGUMENTS
  SERVICENAME  specify the service name of the logs to follow, when not specified follows aggregated logs

FLAGS
  -C, --compose       View the compose logs rather than service logs
  -f, --follow        Follow the logs
  -n, --tail=<value>  [default: all] Number of lines from the end of the logs

ALIASES
  $ chs-dev service-logs
  $ chs-dev compose-logs
```

## `chs-dev development COMMAND [SERVICES]`

list available services and enable / disable service

```
USAGE
  $ chs-dev development COMMAND [SERVICES]

DESCRIPTION
  list available services and enable / disable service

EXAMPLES
  $ chs-dev development services

  $ chs-dev development enable [MODULE]

  $ chs-dev development disable [MODULE]
```

## `chs-dev down`

Takes down the docker-chs-development environment

```
USAGE
  $ chs-dev down

DESCRIPTION
  Takes down the docker-chs-development environment

EXAMPLES
  $ chs-dev down
```

## `chs-dev exclusions COMMAND [EXCLUSIONS]`

list available services and enable / disable service

```
USAGE
  $ chs-dev exclusions COMMAND [EXCLUSIONS]

DESCRIPTION
  list available services and enable / disable service

EXAMPLES
  $ chs-dev exclusions exclude [EXCLUSION]

  $ chs-dev exclusions include [EXCLUSION]
```

## `chs-dev help [COMMAND]`

display help for chs-dev

```
USAGE
  $ chs-dev help [COMMAND] [--all]

ARGUMENTS
  COMMAND  command to show help for

FLAGS
  --all  see all commands in CLI

DESCRIPTION
  display help for chs-dev
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v3.3.1/src/commands/help.ts)_

## `chs-dev logs [SERVICENAME]`

```
USAGE
  $ chs-dev logs [SERVICENAME] [-C] [-f] [-n <value>]

ARGUMENTS
  SERVICENAME  specify the service name of the logs to follow, when not specified follows aggregated logs

FLAGS
  -C, --compose       View the compose logs rather than service logs
  -f, --follow        Follow the logs
  -n, --tail=<value>  [default: all] Number of lines from the end of the logs

ALIASES
  $ chs-dev service-logs
  $ chs-dev compose-logs
```

## `chs-dev modules COMMAND [MODULE]`

list available modules and enable / disable module

```
USAGE
  $ chs-dev modules COMMAND [MODULE]

DESCRIPTION
  list available modules and enable / disable module

EXAMPLES
  $ chs-dev modules available

  $ chs-dev modules enable [MODULE]

  $ chs-dev modules disable [MODULE]
```

## `chs-dev reload SERVICE`

```
USAGE
  $ chs-dev reload SERVICE

ARGUMENTS
  SERVICE  Name of the service
```

## `chs-dev service-logs [SERVICENAME]`

```
USAGE
  $ chs-dev service-logs [SERVICENAME] [-C] [-f] [-n <value>]

ARGUMENTS
  SERVICENAME  specify the service name of the logs to follow, when not specified follows aggregated logs

FLAGS
  -C, --compose       View the compose logs rather than service logs
  -f, --follow        Follow the logs
  -n, --tail=<value>  [default: all] Number of lines from the end of the logs

ALIASES
  $ chs-dev service-logs
  $ chs-dev compose-logs
```

## `chs-dev services COMMAND [SERVICES]`

list available services and enable / disable service

```
USAGE
  $ chs-dev services COMMAND [SERVICES]

DESCRIPTION
  list available services and enable / disable service

EXAMPLES
  $ chs-dev services available

  $ chs-dev services enable [SERVICE]

  $ chs-dev services disable [SERVICE]
```

## `chs-dev status`

print status of an environment

```
USAGE
  $ chs-dev status

DESCRIPTION
  print status of an environment

EXAMPLES
  $ chs-dev status
```

## `chs-dev sync`

Synchronises the local version to the version specifed

```
USAGE
  $ chs-dev sync [-v <value>] [-f]

FLAGS
  -f, --force            Forces all changes without prompting the user.
  -v, --version=<value>  Specifies the version/version range to sync to. When a range is specified it will select the
                         most recent that satisfies the range

DESCRIPTION
  Synchronises the local version to the version specifed

  Calls the GitHub API to resolve the version depending on whether the version specified
  will depend on the number of calls to the GitHub API, the CLI may require the environment
  variable 'GITHUB_PAT' set with a PAT capable of calling GitHub. GitHub rate limiting
  will prevent >60 unauthenticated requests an hour.
```

## `chs-dev up`

Brings up the docker-chs-development environment

```
USAGE
  $ chs-dev up

DESCRIPTION
  Brings up the docker-chs-development environment

EXAMPLES
  $ chs-dev up
```
<!-- commandsstop -->

## chs-dev Configuration

### Environment configuration

To configure the environment `chs-dev` looks for a file: `chs-dev/config.yaml`
within the current working directory.

`chs-dev/config.yaml` file contains:

* `env` - `Mapping<string, string>` - provides environment variables for
  running the Docker Compose services. Values prepended with `file://` will be
  assumed to be files (unless the file does not exist) and will be replaced
  with the contents of the file.
* `authed_repositories` - `List<string>` - Lists ECR repositories which require
  authentication
* `ecr_login_threshold_hours` - `number` - Number of hours between attempting
  to login to ECR repos.

#### Environment variables

* `CHS_DEV_CHECK_VERSION` - when set will check the version is correct
  regardless of when it was previously run
* `CHS_DEV_FORCE_ECR_CHECK` - when set will always run ECR login before running
  up
* `GITHUB_PAT` - when supplied will use the PAT value to authenticate with
  Github to reduce the likelihood of encountering rate limits when interacting
  with GitHub's API.
* `CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING` - when set does not show any
  warnings relating to version not being suitable for project.

### Service configuration

Services should be configured using standard Docker Compose specification.
There are a few things specific to chs-dev which need to be defined for the
environment to work as expected

#### Labels

A service should have labels defined, these provide key/value pairs of
configuration values to Docker Compose as well as chs-dev. The following labels
are referenced by chs-dev for the given purposes:

* `chs.description` - meaningful description which describes the service
* `chs.repository.url` - URL to project which Git can use to clone the
  repository
* `chs.repository.branch` - default branch to checkout when the repository is
  cloned
* `chs.local.builder` - name of a builder to use to build the service in
  development mode
  ([refer to the Builders section for more detail](#builders)). When not
  supplied defaults to `repository` - i.e. expects the repository to contain a
  Dockerfile capable of building the application.
* `chs.local.builder.languageVersion` - passes the *major* language version
  for the builder which the builder can use to set the major version to use
* `chs.local.repoContext` - when not specifying a builder or builder is
  `repository`, specify specific part of the repository to use as the build
  context for the Docker build
* `chs.local.dockerfile` - specify the Dockerfile within the repository to use
  for development mode

#### Dependencies

chs-dev uses the Docker Compose `depends_on` specification for deriving an
exhaustive list of services to run as defined by the enabled services/modules
and their dependencies.

### Builders

A builder is a directory within `local/builders` which contains a Dockerfile
capable of building a repository into an image. Services can reference them via
the `chs.local.builder` label and provide a value for build argument
`LANGUAGE_MAJOR_VERSION` with the value from label:
`chs.local.builder.languageVersion`.

When a service is enabled in development mode a Docker Compose specification is
created within the `local` directory with `build` and `develop` sections
allowing Docker Compose the ability to build and watch for changes. If the
service configuration has been modified in the services directory it must be
re-enabled in development mode for the changes to be reflected for the service.
