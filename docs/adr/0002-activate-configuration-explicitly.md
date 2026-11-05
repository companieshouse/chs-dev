# Activate environment configuration explicitly

Status: accepted; process placement updated by [ADR 0004](0004-retain-host-controller.md).

Saving service configuration stages changes until explicit Apply, whether the
writer is the TUI, CLI or a text editor. This replaces background automatic
application so a human and an AI can edit a shared environment without silently
executing work. The environment continues using applied configuration until
activation; competing mutations coordinate through the shared controller.
