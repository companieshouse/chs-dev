# Correctly set AWS Environment Variables

## Problem Summary

If the `chs-dev troubleshoot analyse` command suggests setting your AWS environment variables, check the following:
1. AWS_PROFILE
2. _AWS_PROFILE
3. _DEFAULT_AWS_PROFILE
4. _AWS_REGION
5. _DEFAULT_AWS_REGION

Follow the steps below to resolve the issue.

## Resolution Summary

1. Open your terminal.
2. Run:`env | grep 'AWS'` to identify which variables have an invalid value or are missing (not set).
3. Run: `aws configure list-profiles` or `aws configure get region` to list the available profiles or regions.
4. Run: `export AWS_PROFILE=<profile_name>` or `export _AWS_REGION=<region_name>` to set the variable.

To ensure AWS environment variables are set across all shell sessions, add `export AWS_PROFILE=<profile_name>` or `export _AWS_REGION=<region_name>` to your `~/.zshrc` or `~/.bash_profile` file.

## Rationale

The chs-dev environment requires AWS environment variables to be correctly configured to ensure the seamless startup of services.


