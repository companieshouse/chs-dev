# Mock providers

Every service uses a **service**, **development**, or **mock** provider. Service runs
the normal image; Development uses the existing repository/builder flow; Mock uses
a checked-in OpenAPI contract served by Microcks. Mock is offered only when a
contract exists, so unsupported services never silently return invented responses.

## Using mocks

After building this branch, restart the daemon when its current work has finished:

```sh
npm run build
chs-dev daemon restart
chs-dev service mocks
chs-dev service configure company-profile-api --enabled true --provider mock --scenario success
chs-dev start --yes
curl -H 'Host: api.chs.local' http://localhost/company/00000006
chs-dev service configure company-profile-api --scenario not-found
chs-dev service configure company-profile-api --scenario error
chs-dev service configure company-profile-api --provider service
```

Use `npm run dev -- <command>` if the executable is not linked. Configuration saves
apply automatically while the environment is running and auto-apply is on. Otherwise
choose Apply or run `chs-dev apply --yes`; a stopped environment needs Start. Save
success reports configuration acceptance; explicit Apply waits for reconciliation.

In the TUI, open a service with Enter, cycle **Provider**, choose **Mock scenario**,
then **Save & apply**. The Services list shows the active scenario. Closing the
modal discards edits. Unsupported Development/Mock choices are omitted. The previous
scenario is remembered when switching away from Mock and back.

The starter contracts cover these common API operations:

| Service                          | Example request                                        |
| -------------------------------- | ------------------------------------------------------ |
| `company-profile-api`            | `GET /company/00000006`                                |
| `transactions-api-ch-gov-uk`     | `GET /transactions/mock-transaction`                   |
| `accounts-filing-api`            | `GET /transactions/mock-transaction/accounts-filing`   |
| `company-accounts-api-ch-gov-uk` | `GET /transactions/mock-transaction/company-accounts`  |
| `felixvalidator`                 | `POST /validate`, `/validateBase64`, `/validate-async` |

The company and filing APIs offer `success`, `not-found` (404), and `error` (503). Success returns 200
for reads/updates and 201 for creates. These are starter contracts with synthetic
development data, covering the operations declared in each OpenAPI file rather
than every endpoint of the original API. Add operations/examples as a feature
needs them. Unknown operations stay visible as Microcks errors.

Felix offers `success`, `validation-failed`, and `error`. Its synchronous endpoints
return `text/xml` with `validationStatus="OK"` or `"FAILED"`; business validation
failure still returns HTTP 200. The `error` scenario returns HTTP 503 and XML with
status `ERROR`. Success uses synthetic company `00000006`, balance sheet date
`2025-12-31`, and accounts type `16`. It does not inspect the submitted accounts.

```sh
npm run dev -- daemon restart
npm run dev -- service configure felixvalidator --enabled true --provider mock --scenario success
npm run dev -- service configure felixvalidator --scenario validation-failed
```

`POST /validate-async` accepts JSON with `fileId` and `callbackUrl` (snake case
`file_id`/`callback_url` also works). It returns an empty HTTP 200 response and,
after a short delay, PATCHes the selected Microcks XML result to the callback URL.
The callback forwards the incoming Authorization header; requests without that
header produce an unauthenticated callback. Callback URLs must be reachable from
the mock container. Failures appear in the `felixvalidator` logs. The `error`
scenario does not accept the request or send a callback. Accepted work retains its
scenario if the selection changes while it is waiting.

No files are downloaded from file transfer, and no TNDP, antivirus, Keycloak or
database connections are made. The mock sends the final validation result rather
than intermediate processing updates. The endpoints and XML shape follow the
[Felix controller and servlet](https://github.com/companieshouse/felixvalidator/tree/1f79c77c8fa9c12012563c4c7ecd2e76befc1297/src/main/java/uk/gov/ch/felixvalidator).

## Dependencies and routing

Dependency traversal stops at a mocked service. Its databases, queues, authentication
services and other sub-dependencies are not selected on its behalf. Dependencies
needed by another real service, explicit roots, selected modules or required base
infrastructure remain enabled. Switch back to Service/Development to restore normal
dependency resolution. Existing exclusions still apply project-wide.

chs-dev starts one shared `chs-dev-microcks` container and a small Node HTTP adapter
for each selected mock. Each adapter replaces its real service, keeps its internal
HTTP ports/network aliases, and retains its Traefik routing labels. Requests work
through ingress or directly through the service hostname. Debug ports, real service
environment variables, builders and SSH secrets are not carried into mocks.

The daemon proxy discovers replacements through Docker routing labels. Compose
creates the services and their networks; the daemon proxy forwards requests.
The service adapters translate normal request paths to Microcks invocation paths
and supply a scenario header; Microcks produces the response. Responses expose
`x-chs-dev-provider: mock` and `x-chs-dev-scenario` for troubleshooting.

Applied scenarios are stored as atomic JSON files in the private project state
directory. Adapters read the selected scenario for every request, so changing it
does not restart the service, Microcks, or ingress. Provider switches reconcile
containers normally. The first selected adapter imports contracts sequentially,
with unique artifact names, avoiding concurrent import collisions. It checks for
changed contracts and a restarted Microcks every 15 seconds and imports as needed.

Microcks uses the pinned multi-architecture Uber image in `mocks/catalogue.json`,
with an ephemeral embedded database. Its UI is at <http://localhost:8585>; the port
binds to loopback. Free port 8585 if another application uses it. The first start
pulls the public Microcks and Node images. An environment containing only generic
mocks and base ingress does not require AWS/ECR authentication. Mixed environments
retain their existing authentication requirements. Removing the last selected mock
also removes the shared Microcks container on the next apply.

## Adding a contract

1. Add a self-contained OpenAPI JSON file under `mocks/<service>/openapi.json`.
2. Add the service to `mocks/catalogue.json`, with matching `title` and `version`,
   its artifact path, internal HTTP ports, health paths, default scenario and named
   scenarios with useful descriptions. Ports must cover the original ingress ports.
3. Give each supported operation matching request-header and response examples.
   The existing contracts use `QUERY_HEADER` with `x-chs-dev-scenario` and an
   `x-microcks-operation` extension. Do not use external references or real credentials.
4. Restart the daemon after catalogue changes so CLI/TUI choices refresh. Existing
   contract content changes are imported automatically; catalogue changes need an apply.

Provider choices are saved in the existing `.chs-dev.yaml`:

```yaml
services: [company-profile-api]
serviceProviders:
    company-profile-api: mock
mockScenarios:
    company-profile-api: not-found
```

Development selections also keep `servicesWithLiveUpdate` synchronized, including
legacy development commands. Saves preserve unrelated settings/comments and reject
stale revisions or unsupported providers/scenarios before writing.

## Verification

```sh
npm run check
npm test
npm run test:docker:mocks
# Against a separately running Microcks instance:
CHS_MICROCKS_URL=http://localhost:8585 node --test test/mock-runtime.test.mjs
CHS_MICROCKS_URL=http://localhost:8585 node --test test/mock-callback.test.mjs
```

The Docker integration suite uses temporary checkouts and free ports. It verifies
ingress routing, dependency removal/restoration, unchanged container IDs during
scenario switches, and re-import after a Microcks restart. Only the Compose
execution backend is supported.

Microcks references: [Uber deployment](https://microcks.io/documentation/explanations/deployment-options/),
[artifact upload](https://microcks.io/documentation/guides/usage/importing-content/),
[header dispatching](https://microcks.io/documentation/explanations/dispatching/).
