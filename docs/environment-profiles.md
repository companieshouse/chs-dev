# Sharing environments and copying CIDEV versions

For choosing which versions Service providers run, use
[Service versions](service-versions.md): **Ctrl+E → v** selects the global
environment (CIDEV by default), and each service can override it. The file workflow
below shares a captured setup or imports explicit version pins.

Environment files capture enabled services and modules, exclusions, Service /
Development / Mock providers, mock scenarios, and image pins. Both frontends use
the selected daemon checkout. After updating chs-dev, restart an idle daemon with
`npm run dev -- daemon restart` and reopen the TUI.

## TUI

Press **Ctrl+E**, then **p** for **Share environment**. Use **v** to select versions.

- **Export environment** writes a portable YAML file. Send it to a colleague or
  commit it to a shared repository. Existing files are protected from overwrite.
- **Import environment** reads a file and displays its changes and warnings.
  Select **Save environment** to replace your local selections.

Use PgUp/PgDn to scroll reviews. Back is selected initially. Saving keeps changes
pending, including when auto-apply is enabled and across daemon restarts. Return
to the Environment panel and choose **Apply** or **Start** when ready.

File paths default to `environments/environment.yaml` in the selected checkout;
Ctrl+U clears the input so you can enter another path. AWS reads can be cancelled
with Esc. Already accepted file writes may finish after leaving the screen.

## CLI

Run these from this package, substituting your file path:

```sh
npm run dev -- environment export ./team-environment.yaml
npm run dev -- environment diff ./team-environment.yaml
npm run dev -- environment import ./team-environment.yaml
npm run dev -- environment import ./team-environment.yaml --yes
npm run dev -- apply
```

Import without `--yes` previews only. Full import replaces all selections and image
pins; unknown services, modules, providers or scenarios fail validation before
configuration changes. A preview becomes stale if another frontend changes the
configuration before saving. Unrelated `.chs-dev.yaml` settings are preserved.

For versions only, merging into your current setup:

```sh
npm run dev -- environment versions cidev
npm run dev -- environment versions cidev --output ./cidev-versions.yaml
npm run dev -- environment versions cidev --yes
npm run dev -- environment import ./cidev-versions.yaml --versions-only --yes
```

`environment versions cidev` previews by default. `--yes` saves local image pins;
`--output` exports the discovered pins without changing local configuration.
This bulk-copy command supports CIDEV. `--profile` and `--region` override the defaults; the AWS
CLI must already be installed and authenticated. Reading versions needs ECS
ListClusters, ListTasks and DescribeTasks permissions. This feature performs no
AWS writes and does not change the selected AWS login profile.

The reader inspects running tasks in CIDEV clusters and matches image repositories
to local service definitions. It pins the actual image digest reported by ECS,
rather than a moving ECR environment tag. See the
[ECS DescribeTasks reference](https://docs.aws.amazon.com/cli/latest/reference/ecs/describe-tasks.html).
Canonical `cidev-<service>` deployments take precedence over old-Kafka and green
variants. Rolling deployments with multiple digests, shared sidecar repositories
without an explicit matching deployment, and missing digests are skipped with
warnings. Existing pins for unmatched services are retained on version-only import.

To explicitly pin or reset an individual service:

```sh
npm run dev -- service configure felixvalidator --image REGISTRY/felixvalidator:2.0.39
npm run dev -- service configure felixvalidator --image default
```

Pins apply to the Service provider. Mock and Development retain their selected
provider; stored image pins become active when switching back to Service.
`service configure` follows your normal auto-apply setting.

## What is portable

The file records the docker-chs-development Git revision and fingerprints of
selected mock contracts. Import warns when these differ locally. Mocks remain in
the chs-dev repository; the recipient needs the same mock catalogue and scenarios.

Exports contain configuration, not container data, local development source,
uncommitted changes, `.env` files, credentials, engine settings or local paths.
Recipients need their own credentials and development checkouts. Exports resolve
the selected environment's images for active CHS Service providers; other image
references retain their project settings. Tag pins can move and do not identify an
already running image digest. CIDEV imports use runtime digests for exact versions.
Those digests may be architecture-specific: use a compatible runtime or emulation
for CIDEV x86_64 images on an ARM machine.

CLI file paths are relative to the invoking shell; TUI paths are relative to the
selected checkout. Use `--force` with export or CIDEV `--output` to overwrite a file.
`--json` provides structured matches, ambiguous candidates, warnings and changes.
