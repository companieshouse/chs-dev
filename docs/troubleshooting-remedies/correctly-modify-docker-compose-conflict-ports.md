# Correctly modify conflicting services docker compose ports number to unique values.

## Problem Summary

If the `chs-dev troubleshoot analyse` command suggests changing the docker compose port of specific services, follow these steps.

## Resolution Summary

1. Open your local docker-chs-development folder in any editor of your choosing.
2. Navigate and open the affected docker compose file by following the service paths in the suggestion information.
3. Scroll to the `ports` section and edit the port number to a unique number of your choosing.
4. Save the docker compose file with the new port number.
5. Rerun `chs-dev up`.


## Rationale

Port conflicts might exist in enabled services which will fail the `chs-dev up` command.
To rectify this, change the conflicting port numbers to unique values.

## Related issues

<!-- Provide links to any related troubleshooting remedies which may help the user -->


