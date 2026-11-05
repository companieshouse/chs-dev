# Start modes

Every enabled service has an effective start mode: `always` (started when the
environment is applied) or `lazy` (its container is created at Apply but not
started; the first proxied request cold-starts it, and it is stopped again
after roughly 30 minutes without traffic). A created-but-not-started
container uses no RAM, so lazy subtrees cost disk, not memory.

## Where the mode comes from

In precedence order:

1. **Your override** — in the TUI, open a service and cycle **Start mode**
   between Default, Lazy and Always. Stored per service as
   `serviceStartModes` in `.chs-dev.yaml`; clearing it returns to Default.
2. **Journey lists** — while a journey is selected, its `services:` and
   `lazy:` lists outrank your override.
3. **Manual enablement** — a service you enabled directly (or via a module)
   always starts, whatever its label says.
4. **The `chs.start-mode` Compose label** — `lazy` makes a service lazy even
   under an eager dependent. `always` means "start eagerly with my parent":
   inside an all-lazy subtree it starts when the parent starts, not at Apply.
5. **Inheritance** — an unlabelled service is lazy when every enabled service
   directly depending on it is lazy, so an exclusive subtree defers with its
   lazy root (`A -> B -> C` with B lazy makes C lazy too).
6. **The learned usage cache** — services demoted after unused runs, as
   before, subordinate to every explicit signal above. Usage is always
   recorded; the `usageCache` setting (default off) decides whether the
   learned list is applied.

Base infrastructure and Development-mode services are never lazy.

## Cold starts

A request to a stopped lazy service starts it **and its dependency chain**
(dependencies first) and is held for up to ~90 seconds for the whole chain;
past that it returns a "still starting" 503 and a retry succeeds once things
are up. Readiness includes configured container health, not just an open TCP port.
Healthcheck traffic never cold-starts a service or refreshes its idle timer; active
requests and streams protect the service and its applied dependency chain.

Manual Start and Restart from the TUI or CLI use the applied Compose artifacts,
including Mock runtime and Development builder dependencies. Compose preserves
started, healthy and completed-successfully conditions. These actions release
manual holds only for the applied chain they actually need; pending saved edits
and refreshed version metadata remain inactive until Apply. Traffic never releases
a manual hold. Stop also creates a hold for an already idle or created service.

The Services selection details show the effective start mode, and the service modal shows
where it came from (override, label, inherited, learned, default).

## For service authors

Add `chs.start-mode: lazy` to a service's Compose labels if it is heavy,
rarely used, and reachable through the proxy (or only needed by lazy
services). Leave it off — or use `always` — for anything an eager service
needs the moment it starts.
