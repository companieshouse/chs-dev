#!/bin/bash

set +e

# List of shell files which have useful functions within
shell_files=(
  "${HOME}"/.bash_profile
  "${HOME}"/.bashrc
  "${HOME}"/.companies_house_config/easy_aws_docker_login.sh
)

ecr_repo_pattern="([[:digit:]]+)\.dkr\.ecr\.([^.]+)\.amazonaws.com"

# Source all the user's shell files
for shell_file in "${shell_files[@]}"; do
  if [[ -f "${shell_file}" ]]; then
    # shellcheck disable=SC1090
    . "${shell_file}"
  fi
done

command -v l_aws >/dev/null 2>&1 || function l_aws() {
  while getopts 'p:' opt; do
    case "${opt}" in
    p) profile="${OPTARG}" ;;
    *) printf -- 'Unknown arg\n' >&2 ;;
    esac
  done

  : "${profile:?profile required}"

  aws sso login --profile "${profile}"
}

repository_urls=("$@")

# Create companies house config directory should it not exist
companies_house_configuration_directory="${HOME}"/.chs-dev/var

if [[ ! -d "${companies_house_configuration_directory}" ]]; then
  mkdir -p "${companies_house_configuration_directory}"
fi

profile_mapping_file="${companies_house_configuration_directory}"/aws_account_profile_mapping

aws_profiles="$(aws configure list-profiles --output text)"

if [[ -f "${profile_mapping_file}" ]]; then
  # Load profiles and check that each has an entry in the profile mapping
  # if not trigger the recreation of the profile mapping file

  if ! xargs -I % grep -q % "${profile_mapping_file}" <<<"${aws_profiles}"; then
    printf -- 'Profile mapping missing profiles, will recreate...\n'
    recreate_profile_mapping=true
  fi
fi

if [[ ! -f "${profile_mapping_file}" || -n "${recreate_profile_mapping}" ]]; then
  # Remove the old mapping file
  [[ -f "${profile_mapping_file}" ]] && rm "${profile_mapping_file}"

  # Iteratively process profile retrieving its account details and output to
  # mapping  file
  while read -r profile; do
    sso_account_id="$(aws configure get sso_account_id --profile "${profile}")"

    # Handle SSO profiles and login if necessary
    if [[ -n "${sso_account_id}" ]]; then
      while : ""; do
        account_id="$(aws sts get-caller-identity --query Account --output text --profile "${profile}" --no-verify-ssl)"

        if [[ -n "${account_id}" ]]; then
          region="$(aws configure get region --profile "${profile}")"
          printf -- '%s %s %s\n' "${account_id}" "${region}" "${profile}" >>"${profile_mapping_file}"
          break
        else
          l_aws -p "${profile}"
        fi
      done
    else
      # otherwise assume the user has configured AWS access for profile with access keys
      account_id="$(aws sts get-caller-identity --query Account --output text --profile "${profile}" --no-verify-ssl)"

      if [[ -n "${account_id}" ]]; then
        region="$(aws configure get region --profile "${profile}")"
        printf -- '%s %s %s\n' "${account_id}" "${region}" "${profile}" >>"${profile_mapping_file}"
      else
        printf -- 'Cannot determine account id for profile %s are the keys correct?\n' "${profile}" >&2
      fi

    fi
  done <<<"${aws_profiles}"
fi

# Iterate over each ECR repo and try to login to ECR
# When there is not an exact account/region match uses the correct profile
# configured for same account but for another region.
for required_repo in "${repository_urls[@]}"; do
  if [[ "${required_repo}" =~ ${ecr_repo_pattern} ]]; then
    required_account="${BASH_REMATCH[1]}"
    required_region="${BASH_REMATCH[2]}"

    profile="$(grep -E "^${required_account}\s${required_region}" "${profile_mapping_file}" | head -n1 | cut -d' ' -f3)"

    while : ""; do
      if [[ -n "${profile}" ]]; then
        printf -- 'Logging into %s\n' "${required_repo}"

        aws ecr get-login-password --profile "${profile}" --region "${required_region}" |
          docker login --username AWS --password-stdin "${required_repo}"
        break
      else
        profile="$(grep -E "^${required_account}\s" "${profile_mapping_file}" | head -n1 | cut -d' ' -f3)"

        if [[ -z "${profile}" ]]; then
          printf -- 'Could not find profile for '%s' you are going to have to configure one using "aws configure sso"\n' "${required_account}" >&2

          exit 1
        else
          break
        fi
      fi
    done
  fi
done
