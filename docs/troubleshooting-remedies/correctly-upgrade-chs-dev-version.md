# Correctly Upgrade CHS-DEV Version

## Problem Summary

If the `chs-dev troubleshoot analyse` command suggests upgrading your chs-dev application version, follow these steps.

## Resolution Summary

1. Open your terminal.
2. Run:`chs-dev sync` to update chs-dev to a suitable version.

The `chs-dev sync` command takes the following arguments. `chs-dev sync [-v <value>] [-f]`:
FLAGS
  -f, --force            Forces all changes without prompting the user.
  -v, --version=<value>  Specifies the version/version range to sync to. When a range is specified it will select the
                         most recent that satisfies the range

## Rationale

Features that have been released to chs-dev may not be available on older version and docker-chs-development might require features in newer versions of chs-dev

## Related issues

<!-- Provide links to any related troubleshooting remedies which may help the user -->

## References/external resources

* [Git ReadMe for chs-dev sync](https://github.com/companieshouse/chs-dev?tab=readme-ov-file#chs-dev-sync)
