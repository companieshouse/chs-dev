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

### Installing a local copy of your changes

To test out development changes you likely will want to install a development
copy like so:

```sh
$ ./install.sh -B -d "${HOME}"/.devchs-dev -n devchs-dev
$ devchs-dev --version
...
$
```

Provided you've configured your path properly with the default Symlink
directory you should be able to run:

```sh
devchs-dev --version
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
* `-n <name>` - specifies the name of the symlink created in the symlink
  directory (*Defaults to* *`chs-dev`*)
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
chs-dev/3.0.0 darwin-arm64 node-v20.18.0
$ chs-dev --help [COMMAND]
USAGE
  $ chs-dev COMMAND
...
```
<!-- usagestop -->

### Commands

<!-- commands -->
* [`chs-dev autocomplete [SHELL]`](#chs-dev-autocomplete-shell)
* [`chs-dev development disable SERVICES`](#chs-dev-development-disable-services)
* [`chs-dev development enable SERVICES`](#chs-dev-development-enable-services)
* [`chs-dev development services`](#chs-dev-development-services)
* [`chs-dev down`](#chs-dev-down)
* [`chs-dev exclude SERVICE`](#chs-dev-exclude-service)
* [`chs-dev exclusions add SERVICE`](#chs-dev-exclusions-add-service)
* [`chs-dev exclusions list`](#chs-dev-exclusions-list)
* [`chs-dev exclusions remove SERVICE`](#chs-dev-exclusions-remove-service)
* [`chs-dev help [COMMAND]`](#chs-dev-help-command)
* [`chs-dev include SERVICE`](#chs-dev-include-service)
* [`chs-dev logs [SERVICENAME]`](#chs-dev-logs-servicename)
* [`chs-dev modules available`](#chs-dev-modules-available)
* [`chs-dev modules disable MODULES`](#chs-dev-modules-disable-modules)
* [`chs-dev modules enable MODULES`](#chs-dev-modules-enable-modules)
* [`chs-dev reload SERVICE`](#chs-dev-reload-service)
* [`chs-dev services available`](#chs-dev-services-available)
* [`chs-dev services disable SERVICES`](#chs-dev-services-disable-services)
* [`chs-dev services enable SERVICES`](#chs-dev-services-enable-services)
* [`chs-dev status`](#chs-dev-status)
* [`chs-dev sync`](#chs-dev-sync)
* [`chs-dev troubleshoot analyse [OUTPUTFILE]`](#chs-dev-troubleshoot-analyse-outputfile)
* [`chs-dev troubleshoot report OUTPUTDIRECTORY`](#chs-dev-troubleshoot-report-outputdirectory)
* [`chs-dev up`](#chs-dev-up)

## `chs-dev autocomplete [SHELL]`

Display autocomplete installation instructions.

```
USAGE
  $ chs-dev autocomplete [SHELL] [-r]

ARGUMENTS
  SHELL  (zsh|bash|powershell) Shell type

FLAGS
  -r, --refresh-cache  Refresh cache (ignores displaying instructions)

DESCRIPTION
  Display autocomplete installation instructions.

EXAMPLES
  $ chs-dev autocomplete

  $ chs-dev autocomplete bash

  $ chs-dev autocomplete zsh

  $ chs-dev autocomplete powershell

  $ chs-dev autocomplete --refresh-cache
```

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v3.1.11/src/commands/autocomplete/index.ts)_

## `chs-dev development disable SERVICES`

Removes a service from development mode

```
USAGE
  $ chs-dev development disable SERVICES... [-P]

ARGUMENTS
  SERVICES...  names of services to be removed to development mode

FLAGS
  -P, --noPull  Does not perform a docker compose pull to reset the service to what is stored in ECR

DESCRIPTION
  Removes a service from development mode
```

## `chs-dev development enable SERVICES`

Adds a service to development mode

```
USAGE
  $ chs-dev development enable SERVICES... [-b <value>]

ARGUMENTS
  SERVICES...  names of services to be added to development mode

FLAGS
  -b, --builderVersion=<value>  [default: latest] version of the builder to use with service

DESCRIPTION
  Adds a service to development mode
```

## `chs-dev development services`

Lists all services which are available to enable in development mode

```
USAGE
  $ chs-dev development services [-j]

FLAGS
  -j, --json  output as json

DESCRIPTION
  Lists all services which are available to enable in development mode
```

## `chs-dev down`

Takes down the docker-chs-development environment

```
USAGE
  $ chs-dev down [-V] [-I]

FLAGS
  -I, --removeImages   Will remove all images built by the environment
  -V, --removeVolumes  Will remove all associated volumes

DESCRIPTION
  Takes down the docker-chs-development environment

EXAMPLES
  Take down environment

    $ chs-dev down

  Take down environment, removing all images and volumes created

    $ chs-dev down -I -V
```

## `chs-dev exclude SERVICE`

Adds a new service to the exclusions list

```
USAGE
  $ chs-dev exclude SERVICE...

ARGUMENTS
  SERVICE...  name of service being excluded from the docker environment

DESCRIPTION
  Adds a new service to the exclusions list

ALIASES
  $ chs-dev exclude
```

## `chs-dev exclusions add SERVICE`

Adds a new service to the exclusions list

```
USAGE
  $ chs-dev exclusions add SERVICE...

ARGUMENTS
  SERVICE...  name of service being excluded from the docker environment

DESCRIPTION
  Adds a new service to the exclusions list

ALIASES
  $ chs-dev exclude
```

## `chs-dev exclusions list`

lists the current list of services which have been excluded

```
USAGE
  $ chs-dev exclusions list [-j]

FLAGS
  -j, --json  Output to log as json

DESCRIPTION
  lists the current list of services which have been excluded
```

## `chs-dev exclusions remove SERVICE`

Removes an exclusion for a service.

```
USAGE
  $ chs-dev exclusions remove SERVICE...

ARGUMENTS
  SERVICE...  name of service being reincluded in the docker environment

DESCRIPTION
  Removes an exclusion for a service.

ALIASES
  $ chs-dev include
```

## `chs-dev help [COMMAND]`

Display help for chs-dev.

```
USAGE
  $ chs-dev help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for chs-dev.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.7/src/commands/help.ts)_

## `chs-dev include SERVICE`

Removes an exclusion for a service.

```
USAGE
  $ chs-dev include SERVICE...

ARGUMENTS
  SERVICE...  name of service being reincluded in the docker environment

DESCRIPTION
  Removes an exclusion for a service.

ALIASES
  $ chs-dev include
```

## `chs-dev logs [SERVICENAME]`

Outputs the logs for services and compose logs (i.e. logs from 'up' and 'down' commands)

```
USAGE
  $ chs-dev logs [SERVICENAME...] [-C] [-f] [-n <value>]

ARGUMENTS
  SERVICENAME...  specify the service names of the logs to follow, when not specified follows aggregated logs

FLAGS
  -C, --compose       View the compose logs rather than service logs
  -f, --follow        Follow the logs
  -n, --tail=<value>  [default: all] Number of lines from the end of the logs

DESCRIPTION
  Outputs the logs for services and compose logs (i.e. logs from 'up' and 'down' commands)

EXAMPLES
  view all aggregated service logs

    $ chs-dev logs

  follow aggregated service logs

    $ chs-dev logs -f

  follow logs for service

    $ chs-dev logs service-one service-two -f

  load the last line in the aggregated service logs

    $ chs-dev logs -n 1

  view all compose logs

    $ chs-dev logs -C

  follow compose logs

    $ chs-dev logs -C -f

  load the last line in the compose logs

    $ chs-dev logs -C -n 1
```

## `chs-dev modules available`

Lists the available modules

```
USAGE
  $ chs-dev modules available [-j]

FLAGS
  -j, --json  output as json

DESCRIPTION
  Lists the available modules
```

## `chs-dev modules disable MODULES`

Removes the services within the supplied modules from the state and any unnecessary dependencies

```
USAGE
  $ chs-dev modules disable MODULES...

ARGUMENTS
  MODULES...  list of module names

DESCRIPTION
  Removes the services within the supplied modules from the state and any unnecessary dependencies
```

## `chs-dev modules enable MODULES`

Enables the services within the supplied modules

```
USAGE
  $ chs-dev modules enable MODULES...

ARGUMENTS
  MODULES...  list of module names

DESCRIPTION
  Enables the services within the supplied modules
```

## `chs-dev reload SERVICE`

Rebuilds and restarts the supplied service running in development mode to load in any changes to source code

```
USAGE
  $ chs-dev reload SERVICE [-f]

ARGUMENTS
  SERVICE  Name of the service

FLAGS
  -f, --force  Forcefully reload service and force a rebuild

DESCRIPTION
  Rebuilds and restarts the supplied service running in development mode to load in any changes to source code
```

## `chs-dev services available`

Lists all the available services

```
USAGE
  $ chs-dev services available [-j]

FLAGS
  -j, --json  output as json

DESCRIPTION
  Lists all the available services
```

## `chs-dev services disable SERVICES`

Removes the supplied services and any unnecessary dependencies from the Docker environment

```
USAGE
  $ chs-dev services disable SERVICES...

ARGUMENTS
  SERVICES...  names of services to be removed to docker environment

DESCRIPTION
  Removes the supplied services and any unnecessary dependencies from the Docker environment
```

## `chs-dev services enable SERVICES`

Enables the services and any dependencies for use within the Docker environment

```
USAGE
  $ chs-dev services enable SERVICES...

ARGUMENTS
  SERVICES...  names of services to be added to development mode

DESCRIPTION
  Enables the services and any dependencies for use within the Docker environment
```

## `chs-dev status`

print status of an environment

```
USAGE
  $ chs-dev status [-j]

FLAGS
  -j, --json  output as json

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

## `chs-dev troubleshoot analyse [OUTPUTFILE]`

Provides analyses of the environment to determine root cause of any issues encountered. Providing information to user as to how they can resolve the issues encountered.

```
USAGE
  $ chs-dev troubleshoot analyse [OUTPUTFILE] [-q]

ARGUMENTS
  OUTPUTFILE  Path to output the analysis results (if desired)

FLAGS
  -q, --quiet  Suppresses log output

DESCRIPTION
  Provides analyses of the environment to determine root cause of any issues encountered. Providing information to user
  as to how they can resolve the issues encountered.
```

## `chs-dev troubleshoot report OUTPUTDIRECTORY`

Produces an artifact containing resources to aid others providing assistance

```
USAGE
  $ chs-dev troubleshoot report OUTPUTDIRECTORY [-A] [-a <value>]

ARGUMENTS
  OUTPUTDIRECTORY  Directory to output the produced report to

FLAGS
  -A, --skipTroubleshootAnalyses      Whether to skip producing the analyses output if not provided as input (Not
                                      recommended)
  -a, --troubleshootAnalyses=<value>  Previously generated analyses of the environment

DESCRIPTION
  Produces an artifact containing resources to aid others providing assistance
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

* `CHS_DEV_PROJECT` - specifies the directory containing the project files to
  use to provision the environment
* `CHS_DEV_CHECK_VERSION` - when set will check the version is correct
  regardless of when it was previously run
* `CHS_DEV_FORCE_ECR_CHECK` - when set will always run ECR login before running
  up
* `GITHUB_PAT` - when supplied will use the PAT value to authenticate with
  Github to reduce the likelihood of encountering rate limits when interacting
  with GitHub's API.
* `CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING` - when set does not show any
  warnings relating to version not being suitable for project.
* `CHS_DEV_SKIP_PROJECT_STATE_VALIDATION` - when set will not check that the
  project is valid before running any commands
* `CHS_DEV_SKIP_ECR_LOGIN_CHECK` - when set will not attempt to login to ECR
* `CH_IBOSS_TRIAL` - when set will bypass the vpn and proxies checks.
* `CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY` - when set will use the specified
  directory as local directory for the service specs repository, used when
  requesting new services.

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
* `chs.local.builder.outputDir` - specifies the value for `OUTDIR` on the
  builder build arg. Typically for node applications which do not build to
  standard output directory of `dist`.
* `chs.local.builder.requiresSecrets` - when set to `true` will apply all the
  secrets defined in the docker compose spec to the builder service
* `chs.local.builder.useServiceDockerfile` - when set to `true` will us the
  Dockerfile for the service rather than the one provided by the builder. The
  equivalent of merging repository builder with one of the builders within the
  repository.
* `chs.local.entrypoint` - specifies the entrypoint script for a given service
  typically for a node application which does not have a
  `ecs-image-buid/docker_start.sh` file
* `chs.local.repositoryRequired` - marks the service as requiring the
  repository locally in order to be run. This is useful where there may not be
  a remote repository to use for the service. The service can define its own
  build configuration referencing its repository/Dockerfile.
* `chs.deprecated` - when set to `true` the service is deprecated and no longer
  in use, useful where there are multiple service definitions for the same
  service and only want to maintain one.

#### Dependencies

chs-dev uses the Docker Compose `depends_on` specification for deriving an
exhaustive list of services to run as defined by the enabled services/modules
and their dependencies.

### Builders

In this project, a builder is a template Docker Compose spec with service(s)
capable of taking a project repository and building it to a runnable service.
For example, a service which needs compiling before being run a service could
take care of building it.

A builder is a directory within `local/builders` and versions of the builder
are sub-directories within it. The spec file must have the name
`builder.docker-compose.yaml`. The builder spec can have any of the following
strings which are replaced when a development Docker Compose spec file is
generated:

* `<service>` becomes the name of the service
* `<chs_dev_root>` becomes the absolute path to root of the chs-dev project
* `<repository_path>` becomes the relative path of the repository from the root
  of the project
* `<absolute_repository_path>` becomes the absolute path to the repository

An example template spec is below:

```yaml
services:
  <service>-builder:
    build:
      dockerfile: local/builders/my-awesome-builder/v3/build.Dockerfile
      context: <chs_dev_root>
      args:
        one: two three
    volumes:
      - <absolute_repository_path>:/opt/out
      - ${HOME}/.m2:/root/.m2
    develop:
      watch:
        - path: .touch
          action: rebuild

  <service>:
    build:
      dockerfile: local/builders/my-awesome-builder/v3/Dockerfile
      context: <chs_dev_root>
      args:
        one: two three
    volumes:
      - <absolute_repository_path>:/opt/out
    depends_on:
      <service>-builder:
        condition: service_completed_successfully
        restart: true

```

Within these directories can be an useful resources for the images or the
builder.

To select a builder the service must have a `chs.local.builder` label which is
the name of the directory. Optionally, it can have a
`chs.local.builder.languageVersion` to customise the specific major version for
any language or base image(s) used. When no builder label is supplied the
generated spec file will point at the root of the repository and expect a
Dockerfile to be present. This can be further customised with the
`chs.local.dockerfile` and `chs.local.repoContext` labels.
