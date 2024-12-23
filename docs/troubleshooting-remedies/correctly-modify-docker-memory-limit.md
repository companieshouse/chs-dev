# Correctly Modify Docker Memory Limit guildlines

## Problem Summary

If the `chs-dev troubleshoot analyse` command suggests increasing the allocated memory limit for Docker, follow these steps to adjust the settings effectively.

## Resolution Summary

1. Open the  Docker Desktop application.
2. Navigate to `Settings` by clicking the gear icon
3. Select the `Resource` Tab, then click `Advanced`
4. On Advanced section view, locate the `Memory Limit` settings.
5. Adjust the memory limit by dragging the slider:
   - Drag to the right to increase the memory.
   - Drag to the left to decrease the memory.

## Rationale

Increasing the memory allocation can improve performance, especially when Docker Desktop becomes slow or when running multi-container workloads. Allocating additional resources can help avoid bottlenecks and ensure smooth operation.

## Related issues

<!-- Provide links to any related troubleshooting remedies which may help the user -->

## References/external resources

* [Docker Desktop Settings: Memory Limit](https://docs.docker.com/desktop/settings-and-maintenance/settings/#advanced)
