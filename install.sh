#!/bin/sh

temp_d=$(mktemp -d)
trap 'rm -rf "${temp_d}"' EXIT

releases_file="${temp_d}"/releases.json
downloaded_cli_tar_file="${temp_d}"/chs-dev.tar.gz
backup_cli="${temp_d}"/chs-dev.bak
backup_symlink="${temp_d}"/chs-dev.sym.bak

F_FG_RED="$(tput setaf 1)"
F_FG_GREEN="$(tput setaf 2)"
F_FG_YELLOW="$(tput setaf 3)"
F_FG_CYAN="$(tput setaf 6)"
F_BOLD="$(tput bold)"
F_RESET="$(tput sgr0)"

# Prints usage
usage() {
  cat <<EOF
install.sh [options] [COMMAND]

Installs the chs-dev CLI tool.

OPTIONS
-------

-B - builds and installs the local directory
-d <directory> - local directory to install CLI to (Defaults to ~/.chs-dev)
-f - forces the installation - will overwrite existing installation if it
    exists. Without the flag, user will have to confirm reinstallation
-l <loglevel> - sets the log level to set logging output, valid options are DEBUG,
    INFO, WARN, ERROR (defaults to INFO)
-n <name> - sets the name of the symlink file (defaults to chs-dev)
-S - when set does not create symlink to binary
-s <path-to-symlink-loc> - Sets the path to the place to output the symlink to (Defaults to ~/.companies_house_config/bin)
-v <version> - installs a specific version (Defaults to latest)
-W - suppresses the warning about the chs-dev not being on the path
-h print this message and exit

ARGUMENTS
---------

COMMAND - Specifies the action to do, must be install or uninstall. Defaults to installl
EOF
}

# Logs error and then exits process with error exit code
panic() {
  log ERROR "${1:?message required}" >&2

  revert_uninstall

  exit 1
}

# Logs messages to terminal and controls logging
log() {
  log_level="${1:?level required}"
  log_message="${2:?message required}"

  case "${LOGGING_LEVEL}" in
  DEBUG) ;;
  INFO)
    if [ "${log_level}" = 'DEBUG' ]; then
      return 0
    fi
    ;;
  WARN*)
    if [ "${log_level}" = 'DEBUG' ] || [ "${log_level}" = 'INFO' ]; then
      return 0
    fi
    ;;
  ERROR)
    if [ ! "${log_level}" = "ERROR" ]; then
      return 0
    fi
    ;;
  esac

  case "${log_level}" in
  DEBUG) log_colour="" ;;
  INFO) log_colour="${F_FG_GREEN}" ;;
  WARN*) log_colour="${F_FG_YELLOW}" ;;
  ERROR) log_colour="${F_FG_RED}" ;;
  *) panic "Invalid log level: ${log_level}" ;;
  esac

  printf '[%s] - [%s] - %s\n' "${F_FG_CYAN}$(date +'%Y-%m-%dT%H:%M:%S')${F_RESET}" "${log_colour}${F_BOLD}${log_level}${F_RESET}" "${log_message}"
}

# Checks that the requested version is valid i.e. there is a release with the
# name of the version supplied
# RETURNS
# 0  - version is valid
# 1  - version is not valid
validate_version() {
  log DEBUG 'validating version'

  {
    jq -r '.[] | .name' "${releases_file}"
    printf -- '%s' "$?" >"${temp_d}"/jq_status
  } |
    {
      grep -q "${VERSION}"
      printf -- '%s' "$?" >"${temp_d}"/grep_status
    }

  if ! grep -q '^0$' "${temp_d}"/jq_status "${temp_d}"/grep_status; then
    log ERROR "Version ${VERSION} not found"
    return 1
  fi
}

# Sets the variable OS to the name of the operating system. Panics if the
# operating system is unsupported by the CLI (i.e. missing compiled CLI
# artifacts). Panics if not OSX or Linux compatible
determine_operating_system() {
  log DEBUG 'determining operating system'
  uname_out="$(uname -a | tr '[:upper:]' '[:lower:]')"
  case "${uname_out}" in
  *microsoft*) OS="linux" ;;
  linux*) OS="linux" ;;
  darwin*) OS="darwin" ;; # Apple Mac
  *)
    panic "Unsupported operating system. Must be Linux or Mac."
    ;;
  esac
}

# Sets the variable CHIPSET with the name of the current chipset architecture.
# Panics if the chipset is not arm64 or x86
determine_chipset() {
  log DEBUG 'determining chipset'
  uname_out="$(uname -m | tr '[:upper:]' '[:lower:]')"

  case "${uname_out}" in
  aarch64 | arm64) CHIPSET=arm64 ;;
  x86_64*) CHIPSET=x64 ;;
  *)
    panic "Unsupported chipset. Supports: arm64 or x64 architectures."
    ;;
  esac
}

# Downloads the releases to local file
download_releases() {
  curl --fail-with-body -s -L \
    -o "${releases_file}" \
    -H 'Accept: application/vnd.github+json' \
    https://api.github.com/repos/companieshouse/chs-dev/releases
}

# Interrogates the release to determine the download URL for the CLI tarball
determine_download_url() {
  release_file="${temp_d}"/release.json

  if [ "${VERSION}" = "${DEFAULT_VERSION}" ]; then
    log DEBUG 'Fetching latest release'
    curl --fail-with-body -s -L -H \
      'Accept: application/vnd.github+json' \
      https://api.github.com/repos/companieshouse/chs-dev/releases/latest >"${release_file}" || return $?
  else
    log DEBUG "Looking up version ${VERSION}"
    jq \
      --arg version "${VERSION}" \
      '.[] | select(.name == $version)' \
      "${releases_file}" >"${release_file}"
  fi

  install_version="$(jq -r '.name' "${release_file}")"
  log INFO "Installing version ${install_version}"

  jq -r --arg expected_suffix "-${OS}-${CHIPSET}.tar.gz" \
    '.assets[] | select(.name | endswith($expected_suffix)) | .browser_download_url' \
    "${release_file}" >"${temp_d}"/download_url
}

# Downloads the tarball to temporary directory.
download_cli_tarball() {
  log DEBUG "Downloading - '${DOWNLOAD_URL}'"

  curl --fail-with-body -s \
    -o "${downloaded_cli_tar_file}" \
    -L \
    -H 'Accept: application/tar+gzip' \
    "${DOWNLOAD_URL}"
}

# If Symlink directory is not found on path then output instructions on how to
# add to path
add_chs_dev_cli_to_path() {
  if printf -- '%s' "${PATH}" | grep -qv -- "${SYMLINK_DIRECTORY}" && [ -z "${SUPPRESS_NOT_ON_PATH_WARN}" ]; then
    log WARN "Does not look like chs-dev will be on your path"
    cat <<EOF
If you haven't installed via dev-env-setup you will need to modify your shell
profile to add the following:

    export PATH="\${PATH}":${SYMLINK_DIRECTORY}

This can be added to your ~/.bashrc or ~/.zshrc file (depending on your shell)
EOF
  fi
}

# Given the installation directory, unzip the downloaded tarball and extract
# to the installation directory and then create symlink to chs-dev binary
install_cli_tarball() {
  log DEBUG "installing tarball..."
  return_status=0

  if [ ! -d "${INSTALLATION_DIRECTORY}" ]; then
    log DEBUG "Creating ${INSTALLATION_DIRECTORY}"
    mkdir -p "${INSTALLATION_DIRECTORY}" || return_status=$?
  fi

  if [ "${return_status}" -eq 0 ]; then
    log DEBUG "Unzipping tarball..."

    tar -xf "${downloaded_cli_tar_file}" \
      -C "${temp_d}" || return_status=$?
  fi

  if [ "${return_status}" -eq 0 ]; then
    (
      cd "${temp_d}"/chs-dev/ || exit 1
      tar c .
    ) | (
      cd "${INSTALLATION_DIRECTORY}" || exit 1
      tar xf -
    ) || return_status=$?

    if [ "${return_status}" -ne 0 ]; then
      panic 'Unable to install CLI to destination'
    fi
  fi

  if [ -z "${NO_SYMLINK}" ]; then
    log DEBUG "Installing symlink"
    mkdir -p "${SYMLINK_DIRECTORY}" || return_status=$?

    if [ "${return_status}" -eq 0 ]; then
      ln -s "${INSTALLATION_DIRECTORY}"/bin/chs-dev "${SYMLINK_DIRECTORY}"/"${SYMLINK_NAME}" || return_status=$?
    fi

    if [ "${return_status}" -eq 0 ]; then
      add_chs_dev_cli_to_path || return_status=$?
    fi
  else
    log WARN "Skipping symlink installation"
    printf -- '\n'
    cat <<'EOF'
It is unlikely that chs-dev will be on your path, therefore you will have to
add it to your shell profile. Your options:

* Create symlink to the `bin/chs-dev` executable in your local installation
  directory in a directory which you can add to your path
* Create a function/alias in your shell profile to the absolute path to the
  `bin/chs-dev` executable in your local installation directory
EOF
  fi

  return "${return_status}"
}

# Function which prompts user to confirm they are happy to continue
# ARGUMENTS
# 1 - prompt - prompt to make to the user for confirmation
# RETURNS
# 0  - Action confirmed
# 1  - User has explicitly not confirmed the action
user_confirm_action() {
  prompt="${1:?prompt required}"

  if [ -z "${FORCE}" ]; then
    printf -- '%s\n-- To continue press y (or to exit press another key)\n' "${prompt}"
    # explicitly read from tty since stdin may be a pipe
    read -r user_confirmation </dev/tty

    case "${user_confirmation}" in
    [Yy]) return 0 ;;
    *)
      log WARN "User not entered 'y' bailing out..."
      return 1
      ;;
    esac
  else
    log DEBUG 'In force mode autoconfirming'
    return 0
  fi

}

# Runs through the steps of installing the chs-dev cli
install() {
  # Try to find chs-dev and if present offer to uninstall it before
  # installing the latest version
  if [ -L "${SYMLINK_DIRECTORY}"/"${SYMLINK_NAME}" ] ||
    [ -d "${INSTALLATION_DIRECTORY}" ]; then
    chs_dev_version_installed="$("${SYMLINK_NAME}" --version || : "")"
    upgrade_downgrade="upgrade"

    if [ -n "${chs_dev_version_installed}" ]; then
      chs_dev_version_number_installed="$(grep -oE 'chs-dev/[0-9]+\.[0-9]+\.[0-9]+' <<< "${chs_dev_version_installed}" | cut -d'/' -f2)"

      if [[ -n "${VERSION}" && "${VERSION}" != 'latest' ]]; then

        # Compare versions to determine upgrade or downgrade
        if [[ $(sort -V <<< "${chs_dev_version_number_installed}"$'\n'"${VERSION}" | head -n1) = "${VERSION}" && "${chs_dev_version_number_installed}" != "${VERSION}" ]]; then
          upgrade_downgrade="downgrade"
        else
          upgrade_downgrade="upgrade"
        fi

      fi

      log WARN "chs-dev (version ${chs_dev_version_installed}) already installed"
    else
      log WARN "chs-dev already installed"
    fi

    if user_confirm_action "Do you want to ${upgrade_downgrade} to ${VERSION}?"; then
      FORCE=1 uninstall
    else
      panic "chs-dev cli not installed"
    fi
  fi

  if [ -n "${THIS_DIR}" ]; then
    if ! make clean package; then
      panic 'Could not build local package'
    fi
  fi

  # Download the most recent releases and validate the version
  if [ -z "${THIS_DIR}" ]; then
    if ! download_releases; then
      panic "Cannot download latest releases."
    fi

    if [ ! "${VERSION}" = "${DEFAULT_VERSION}" ]; then
      if ! validate_version; then
        panic 'Could not install chs-dev'
      fi
    fi
  fi

  # Set the required information in order to download tarball
  determine_operating_system

  determine_chipset

  if [ -z "${THIS_DIR}" ]; then
    # captured in variable so no way of doing ! cmd
    # shellcheck disable=SC2181
    if ! determine_download_url; then
      panic "Could not find download for release specified."
    fi

    # Download tarball
    DOWNLOAD_URL="$(cat "${temp_d}"/download_url)"

    log INFO 'Downloading CLI tarball. Will take a few moments...'

    if ! download_cli_tarball; then
      panic "Could not download release tarball."
    fi
  else
    log 'DEBUG' 'Looking for tar to install in built artefacts'
    for tar_ball in dist/*.tar.gz; do
      log 'DEBUG' "tar_ball=${tar_ball}"
      if printf -- '%s' "${tar_ball}" | grep -Eq "${OS}-${CHIPSET}\.tar\.gz$"; then
        log 'DEBUG' "using tar_ball=${tar_ball}"
        downloaded_cli_tar_file="${tar_ball}"
        break
      fi
    done

    if [ -z "${downloaded_cli_tar_file}" ]; then
      panic "CLI not built as expected"
    fi
  fi

  # Install tarball
  if install_cli_tarball; then
    log INFO 'chs-dev CLI installed successfully.'
  else
    panic "CLI not installed"
  fi
}

# When called will attempt to revert any possible uninstall by moving the files
# from the backed up location to their installed location.
revert_uninstall() {
  if [ -d "${backup_cli}" ]; then
    log "DEBUG" 'Restoring installation'
    mv "${backup_cli}" "${INSTALLATION_DIRECTORY}"
  fi

  if [ -f "${backup_symlink}" ]; then
    log "DEBUG" 'Restoring symlink'
    mv "${backup_symlink}" "${SYMLINK_DIRECTORY}"/"${SYMLINK_NAME}"
  fi
}

# Uninstalls the installed CLI - does this by moving the files to the temporary
# directory and so are removed after script is successful
uninstall() {
  log INFO "Uninstalling CLI tool"

  # Get user to confirm they are happy to uninstall chs-dev CLI
  if ! user_confirm_action "This will uninstall chs-dev CLI do you want to continue?"; then
    panic "chs-dev cli not uninstalled"
  fi

  # Remove symlink and the chs-dev directory
  log DEBUG "Removing symlink"
  mv "${SYMLINK_DIRECTORY}"/"${SYMLINK_NAME}" "${backup_symlink}"

  log DEBUG "Removing CLI files"
  mv "${INSTALLATION_DIRECTORY}" "${backup_cli}"

  log INFO "chs-dev CLI uninstalled successfully"
}

if ! command -v jq >/dev/null 2>&1; then
  panic 'Required utility: jq is not installed'
fi

# Setup default values
DEFAULT_LOGGING_LEVEL=INFO
DEFAULT_VERSION=latest
DEFAULT_INSTALLATION_DIRECTORY="${HOME}"/.chs-dev
DEFAULT_SYMLINK_DIRECTORY="${HOME}"/.companies_house_config/bin
DEFAULT_SYMLINK_NAME=chs-dev
DEFAULT_COMMAND=install

# Parse options
while getopts 'd:l:n:s:v:BSfhW' opt; do
  case "${opt}" in
  d) INSTALLATION_DIRECTORY="${OPTARG}" ;;
  l) LOGGING_LEVEL="${OPTARG}" ;;
  n) SYMLINK_NAME="${OPTARG}" ;;
  s) SYMLINK_DIRECTORY="${OPTARG}" ;;
  v) VERSION="${OPTARG}" ;;
  B) THIS_DIR=1 ;;
  S) NO_SYMLINK=1 ;;
  f) FORCE=1 ;;
  W) SUPPRESS_NOT_ON_PATH_WARN=1 ;;
  h)
    usage
    exit 0
    ;;
  *) ;;
  esac
done

# Determine and validate the command
shift "$((OPTIND - 1))"
COMMAND="${1-"${DEFAULT_COMMAND}"}"

case "${COMMAND}" in
install | uninstall) ;;
*) panic "Command can only be install or uninstall" ;;
esac

# Set the values of the variables to the defaults if unset
: "${LOGGING_LEVEL:="${DEFAULT_LOGGING_LEVEL}"}"
: "${VERSION:="${DEFAULT_VERSION}"}"
: "${INSTALLATION_DIRECTORY:="${DEFAULT_INSTALLATION_DIRECTORY}"}"
: "${SYMLINK_DIRECTORY:="${DEFAULT_SYMLINK_DIRECTORY}"}"
: "${SYMLINK_NAME:="${DEFAULT_SYMLINK_NAME}"}"

"${COMMAND}"
