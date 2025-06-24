# Correctly Resolve Breaking Changes from Version Migrations

## Problem Summary

Upgrading or Downgrading from major versions, e.g  v1 to v2, or v3 to v2, may introduce breaking changes to the chs-dev environment.

## Resolution Summary

If breaking changes occur or the environment is corrupted, follow the steps below sequentially. Move to the next step only if the issue persists.

### 1. Remove local configuration
Delete the `.chs-dev.yaml` file in your project directory:

``` bash
rm -r .chs-dev.yaml
```

### 2. Reset chs-dev state
Revert your local chs-dev environment to its default state:

``` bash
chs-dev state clean
```

### 3. Reinstall chs-dev
If the issue persists, re-run Step 31 of the `dev-env-setup` guide by fully uninstalling and reinstalling `chs-dev`.


## Rationale

The steps above provide guidance for resolving a corrupted chs-dev environment that may occur due to upgrading or downgrading the CLI version.
