# Declared dependency findings

This read-only audit used the adjacent `docker-chs-development` checkout on
2026-11-05 through the production definition loader and selection resolver.
No containers, remote services or business workflows ran. Source definitions
can change independently of this report.

The checkout has 267 service definitions; 73 use list-form `depends_on`.
Dependency inspection must handle both list and mapping forms. Mapping-form
readiness conditions must survive preparation; reducing the graph to names
alone is insufficient for startup execution.

| Selection                     | Declared service count | Meaning                                                                          |
| ----------------------------- | ---------------------: | -------------------------------------------------------------------------------- |
| `ch-gov-uk`                   |                     40 | Raw transitive closure including this root                                       |
| `ch-gov-uk-minimal`           |                      1 | Raw transitive closure including this root                                       |
| `document-generator-consumer` |                      8 | Raw transitive closure including this root                                       |
| `authentication-service`      |                     12 | Raw transitive closure including this root                                       |
| `docgen` module               |                     49 | Resolved selection with required base infrastructure and retired ingress removed |

Raw closures do not add unrelated base services. These counts do not establish
runtime RAM, startup time, functional completeness or equivalence between the
full and minimal images. They also do not reproduce the reported 83-service
small-full-accounts selection: that exact selection and historical checkout are
not established by the archive. A replacement image needs service-owner contract
validation before it becomes a default.

Ten services directly declare both `kafka` and `kafka3`:

- `data-document-rendering-api`
- `document-generator-consumer`
- `extensions-processor-api`
- `penalty-payment-api`
- `chd-order-consumer`
- `orders-api-ch-gov-uk`
- `secure-application-consumer`
- `officers-search-consumer`
- `psc-search-consumer`
- `transactions-api-ch-gov-uk`

The archived discussion explains intentional migration, rollback and dual-flow
requirements for some services. This audit therefore does not remove either
dependency. Service owners must establish which flows still require each broker;
finding a dual declaration is evidence for review, not evidence of an error.
Kafka instability and consumer restart cascades also remain separate service
issues rather than being attributed to selection alone.

The resolved docgen selection includes both brokers, their ZooKeeper services,
the Kafka initialization job, Oracle query and authentication/identity services.
This supports a representative tooling fixture for condition ordering, missing
dependencies, first causal failures, reload/ingress and stop behavior. Such a
fixture cannot prove GCI generates a valid company snapshot or that intermittent
Oracle/identity failures are fixed. Authentication cycle presentation is covered
by finite dependency traversal; changing a real service cycle requires its
owners to agree the runtime contract.

The local audit command was
`node scripts/test-local.mjs .scratch/delivery/dependency-audit.test.ts`.
Its JSON evidence and the small script are retained under `.scratch/delivery/`.
Permanent parser/selection coverage lives in
[project preparation tests](../test/project-preparation.test.ts),
[dependency tests](../test/service-dependencies.test.ts) and
[legacy configuration tests](../test/legacy-configuration.test.ts).
See [feedback coverage](feedback-coverage.md) for all source messages and
remaining service/platform obligations.
