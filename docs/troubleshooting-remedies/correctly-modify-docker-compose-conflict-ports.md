# Correctly modify docker compose conflict ports to unique values.

## Problem Summary

If the `chs-dev troubleshoot analyse` command suggests changing the docker compose port of specific services, follow these steps.

## Resolution Summary

1. Open your local docker-chs-development folder in any editor of your choosing.
2. Navigate and open the affected docker-compose.yaml file, as listed in the suggestions from the `chs-dev troubleshoot analyse` command output for port conflicts.
3. Scroll to the `ports` section and edit the port number to a unique number of your choosing.
4. Save the docker-compose.yaml file with the new port number.
5. Rerun `chs-dev up`.


## Rationale

Port conflicts may occur in enabled services, causing the chs-dev up command to fail.
To resolve this, update the conflicting port numbers to unique values.




