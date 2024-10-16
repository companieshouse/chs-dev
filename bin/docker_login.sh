#!/bin/bash

set +e

# List of shell files which have useful functions within
shell_files=(
  "${HOME}"/.bash_profile
  "${HOME}"/.bashrc
  "${HOME}"/.companies_house_config/easy_aws_docker_login.sh
)

dev_group_name=dev
l_docker_script="${HOME}"/.ch_dev/bin/l_docker

# Source all the user's shell files
for shell_file in "${shell_files[@]}"; do
  if [[ -f "${shell_file}" ]]; then
    # shellcheck disable=SC1090
    . "${shell_file}"
  fi
done

function reinstall_l_aws() {
  local dev_env_setup_dir="$1"

  "${dev_env_setup_dir}"/scripts/aws/setup_aws_sso_login_util --install --auto

  return $?
}

function install_l_docker() {
  printf -- 'Does not look like the required utility: l_docker is installed on your local machine.\n'
  printf -- 'Do you want to install it? \n'
  printf -- '-- Answer y/n\n'

  local dev_env_setup_dir
  dev_env_setup_dir="$(mktemp -d)"

  trap 'rm -rf "${dev_env_setup_dir}"' RETURN

  read -n 1 -r install_y_n
  printf -- '\n'

  case "${install_y_n}" in
  y | Y)
    if git clone -- git@github.com:companieshouse/dev-env-setup "${dev_env_setup_dir}"; then

      if "${dev_env_setup_dir}"/scripts/aws/setup_aws_profiles --install; then

        # If the user has l_aws installed chances are they will have a former version of l_docker
        # which needs to be removed since it is not compatible with this script
        if command -v l_aws >/dev/null 2>&1; then

          if ! reinstall_l_aws "${dev_env_setup_dir}"; then

            printf -- 'Encountered an error reinstalling the updated l_aws command therefore could not remove former l_docker command. You may have to do this separately\n' >&2
            return 1
          fi
        fi

      else
        printf -- 'There was an error installing l_docker and aws profiles - try manually running this before trying again\n' >&2
        return 1
      fi
    else
      # shellcheck disable=SC2016
      printf -- 'Could not clone dev-env-setup. Run `scripts/aws/setup_aws_profiles --install` separately\n' >&2
      return 1
    fi

    ;;
  *)
    printf -- 'Bailing out...\n' >&2
    return 2
    ;;
  esac
}

if [[ ! -f "${l_docker_script}" ]]; then
  install_l_docker || exit $?
fi

# Check that the expected group 'dev' exists otherwise fallback on the default
# group
if "${l_docker_script}" -l | grep -q "Group ${dev_group_name}"; then
  "${l_docker_script}" -g "${dev_group_name}" || exit $?
else
  printf -- 'Unexpected setup discovered, using default profile group to login\n'

  "${l_docker_script}" || exit $?
fi
