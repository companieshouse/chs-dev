# chs-dev

A CLI tool for spinning up a CHS like system local in a Docker environment
orchestrated using Docker Compose.

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
