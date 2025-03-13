# Correctly set AWS Environment Variable

## Problem Summary

If the `chs-dev troubleshoot analyse` command suggests setting your AWS_PROFILE, follow the steps below:-

## Resolution Summary

1. Open your terminal.
2. Run:`echo $AWS_PROFILE` to ascertain the variable value.
3. Run: `aws configure list-profiles` to list the available profiles.
4. Run: `export AWS_PROFILE=<profile_name>` and set the variable value to one of the listed profiles.

The above command temporarily sets AWS_PROFILE in your current shell. To ensure AWS environment variable persist across all shell sessions, skip item 4, and add `export AWS_PROFILE=<profile_name>` to your `~/.zshrc` or `~/.bash_profile` file.

## Rationale

The chs-dev environment requires AWS environment variable to be correctly configured to ensure the seamless startup of services.


