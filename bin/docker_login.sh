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

profile_mapping_file="$(mktemp)"
trap 'rm "${profile_mapping_file}"' EXIT

aws configure list-profiles --output text |
  while read -r profile; do
    sso_account_id="$(aws configure get sso_account_id --profile "${profile}")"

    if [[ -n "${sso_account_id}" ]]; then
      while : ""; do
        account_id="$(aws sts get-caller-identity --query Account --output text --profile "${profile}")"

        if [[ -n "${account_id}" ]]; then
          region="$(aws configure get region --profile "${profile}")"
          printf -- '%s %s %s\n' "${account_id}" "${region}" "${profile}" >>"${profile_mapping_file}"
          break
        else
          l_aws -p "${profile}"
        fi
      done
    else
      account_id="$(aws sts get-caller-identity --query Account --output text --profile "${profile}")"

      if [[ -n "${account_id}" ]]; then
        region="$(aws configure get region --profile "${profile}")"
        printf -- '%s %s %s\n' "${account_id}" "${region}" "${profile}" >>"${profile_mapping_file}"
      else
        printf -- 'Cannot determine account id for profile %s are the keys correct?\n' "${profile}" >&2
      fi

    fi
  done

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
        profile="$(grep -E "^${required_account}\s" | head -n1 | cut -d' ' -f3)"
      fi
    done
  fi
done
