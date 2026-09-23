# SSH key passphrase coordinated rollout

## Purpose

The SSH key passphrase changes in
[chs-dev#186](https://github.com/companieshouse/chs-dev/pull/186) and
[docker-chs-development#2649](https://github.com/companieshouse/docker-chs-development/pull/2649)
must be released as one coordinated change.

`chs-dev` 5.0.0 obtains the SSH key passphrase from the macOS Keychain before
running Docker Compose. The corresponding `docker-chs-development` change
requires `chs-dev >=5.0.0 <6.0.0`, regenerates the developer's SSH key with a
mandatory passphrase, registers the replacement public key with GitHub, and
removes the legacy plaintext passphrase file.

This is a breaking migration. Docker Compose-backed commands will not work
until the developer has upgraded both components and completed `./bin/init`.
The init process replaces the SSH key currently selected for GitHub, so any
other service using that key must also be updated.

The supported developer environment is macOS on Apple Silicon. Linux and
Intel macOS are outside the supported environment and are not release
blockers.

## Ownership

Assign named owners before announcing the release date:

| Role | Responsibility |
| --- | --- |
| Release lead | Runs the timeline, records decisions, and sends communications |
| `chs-dev` maintainer | Merges chs-dev#186 and verifies the 5.0.0 release |
| Docker development maintainer | Merges docker-chs-development#2649 and verifies its release |
| Pilot coordinator | Coordinates pilot users and records results |
| Support lead | Monitors the developer support channel and triages failures |
| Rollback approver | Makes the go/no-go or rollback decision |

Use one release coordination thread or call throughout the release window.
Pause unrelated merges to both repositories until the rollout is confirmed
stable.

## Preparation

Complete the following before either pull request is approved:

1. Obtain the required reviews and confirm CI is green on both pull requests.
2. Explicitly accept the documented residual risk that a passphrase may
   briefly be visible in process arguments during `ssh-keygen` or Keychain
   operations.
3. Publish a migration guide containing:
   - The required order: update the repositories, run `./bin/init`, verify SSH,
     and then use `chs-dev`.
   - A prominent warning that `./bin/init` replaces the SSH key currently
     selected for GitHub.
   - Instructions to identify every other service using that key, including
     other Git hosts, deploy keys, jump hosts, and internal systems.
   - Secure backup and recovery instructions for the existing private and
     public key and legacy passphrase configuration.
   - GitHub registration through `gh` and through the manual browser path.
   - macOS Keychain troubleshooting.
   - `ssh-add --apple-use-keychain` setup.
4. Publish an FAQ explaining:
   - Why the key must have a passphrase and why it is being replaced.
   - What happens if the user declines regeneration.
   - How to recover from an incorrect or missing Keychain item.
   - How to restore the old key if another service was missed.
5. Prepare rollback changes:
   - A revert pull request for docker-chs-development#2649.
   - Instructions for reinstalling `chs-dev` 4.0.0 with
     `install.sh -v 4.0.0`.
   - Tested recovery steps for restoring the previous SSH key and legacy
     configuration.
6. Confirm support coverage for the release window and the following business
   day.

## Pilot

Run both pull request branches together before merging. Use Apple Silicon Macs
to cover:

- A clean installation.
- An existing installation with a key and legacy plaintext passphrase file.
- GitHub registration with an authenticated `gh` CLI.
- Manual GitHub registration without an authenticated `gh` CLI.
- A developer whose SSH key is also registered with another service.

Each pilot user must confirm:

1. The existing key can be recovered before starting.
2. `./bin/init` generates a passphrase-protected key.
3. The public key is registered successfully with GitHub.
4. `ssh -T git@github.com` succeeds.
5. The passphrase exists in the macOS Keychain.
6. `local/.ssh_key_passphrase` has been removed.
7. `ssh-add --apple-use-keychain ~/.ssh/<key-name>` succeeds.
8. `chs-dev --version` reports 5.0.0.
9. `chs-dev troubleshoot`, `status`, `up`, `logs`, `down`, state clean and
   restore, and a private-dependency build work.
10. Git operations outside containers work.
11. A simulated recovery using the backed-up key succeeds.

The pilot is complete only when all scenarios pass, no unresolved key-loss or
Docker Compose-blocking issue exists, and the migration guide incorporates
pilot feedback.

## Communications

### Five business days before release

Send an advance notice through the main developer broadcast channel and the
engineering distribution list. Ask team leads to forward it to every
developer using `docker-chs-development`.

The notice must state:

- This is a breaking, mandatory coordinated upgrade.
- The release date and staffed support window.
- `./bin/init` will replace the SSH key currently selected for GitHub.
- Developers must identify anywhere else that key is used before migrating.
- Docker Compose-backed commands will fail until migration is complete.
- Developers should not migrate immediately before critical delivery work.
- The expected migration time is 15 to 30 minutes.
- The migration guide and developer support channel.
- Team leads must acknowledge receipt and identify absent developers.

### One business day before release

Repeat the impact, prerequisites, release window, expected migration time, and
support route. Ask developers to commit or stash work before migration.

### Release start

Post:

> The coordinated SSH key security rollout has started. Do not update
> `chs-dev` or `docker-chs-development` until the explicit "ready to migrate"
> message.

### Ready to migrate

Send this only after both releases and all production smoke tests pass.
Include the exact update, migration, and verification commands from the tested
runbook.

### During and after release

Post progress updates after 30 and 90 minutes with known issues, mitigations,
and whether rollout remains open. Keep one canonical thread to prevent
conflicting advice.

At completion, confirm success, repeat the required actions for absent
developers, identify the long-term support route, and state when backups of
superseded keys should be securely destroyed.

## Production release sequence

Use a staffed mid-week release window and avoid Friday deployment.

1. Start the coordination call and freeze unrelated merges.
2. Confirm all named owners are present.
3. Confirm CI and reviews are green on both pull requests.
4. Merge chs-dev#186 first.
5. Publish `chs-dev` 5.0.0 and verify the `darwin-arm64` artifact.
6. Perform a clean installation of 5.0.0 on an Apple Silicon Mac and verify
   download, installation, startup, and version output.
7. Stop if 5.0.0 is not installable. Do not merge the Docker repository pull
   request.
8. Merge docker-chs-development#2649.
9. Verify its release and confirm `chs-dev/config.yaml` requires
   `>=5.0.0 <6.0.0`.
10. Run the migration on one fresh clone and one existing installation.
11. Execute the pilot smoke-test checklist.
12. Send the "ready to migrate" communication.
13. Keep maintainers available for at least two hours and retain the merge
    freeze until the first rollout cohort succeeds.

The gap between releasing `chs-dev` 5.0.0 and merging the Docker repository
pull request should be minutes, not hours. Do not tell users to upgrade during
that gap.

## Controlled adoption

Roll out in cohorts:

1. Release team and pilot users immediately after the production smoke test.
2. One volunteer from each delivery team during the first hour.
3. Remaining active developers after no systemic issue has appeared.
4. Absent or returning developers through the same migration runbook.

Team leads should report completion counts rather than relying only on
reactions to the announcement.

## Go/no-go criteria

Continue the rollout only when:

- `chs-dev` 5.0.0 installs successfully on an Apple Silicon Mac.
- Fresh and existing installations migrate successfully.
- GitHub SSH authentication and a private-dependency build succeed.
- Docker Compose-backed commands work.
- No pilot user has lost access to another service because of key replacement.
- Support has a documented response for every known issue.

Stop immediately if:

- A key is generated without a passphrase.
- An existing key is lost without a working recovery path.
- Keychain retrieval fails for multiple users.
- GitHub registration consistently fails.
- Docker Compose-backed commands fail for the supported environment.

## Rollback

Before docker-chs-development#2649 merges, hold that pull request and direct
any early adopters back to `chs-dev` 4.0.0.

After both releases, prefer a rapid roll-forward fix. If a systemic failure
cannot be corrected within 30 minutes:

1. Publish the prepared Docker repository revert.
2. Direct users to install `chs-dev` 4.0.0.
3. Follow the tested key and legacy configuration recovery procedure.
4. Send a single rollback communication with the reason, impact, exact
   recovery steps, and the next update time.

## Completion and follow-up

The rollout is successful when:

- Every active delivery team confirms at least one successful migration on
  release day.
- No unresolved critical migration issue remains after two hours.
- No plaintext `local/.ssh_key_passphrase` remains on migrated installations.
- Docker Compose workflows and private repository builds work on supported
  Apple Silicon Macs.
- All active users migrate within five business days.
- Superseded key backups are securely deleted after users confirm that all
  external key registrations have been updated.

Hold a short review two business days after release covering migration
completion, support incidents, missed key consumers, documentation changes,
and any further automation required. Keep the migration notice pinned and
included in onboarding documentation for at least one month.
