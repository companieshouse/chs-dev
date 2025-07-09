# Correctly Reload Respository Services Using CHS-DEV

## Summary

Repository services typically include:

- Java (e.g., CHIPS)
- Perl services
- Go services

Each of these has specific configuration or setup steps, which will be detailed individually below to help streamline your development process in chs-dev.


## JAVA (CHIPS)

Before starting the CHIPS service, ensure the healthcheck configuration is added to its `docker-compose.yaml` file as shown below:

```yaml
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -s -o /dev/null -w '%{http_code}' http://localhost:7001/chips/rest/healthcheck || exit 1",
        ]
      retries: 6
      start_period: 15s

```
Note: The retries and start_period settings are essential, as the CHIPS service typically has a longer startup time.

### Reload Behaviour

To reload the CHIPS service:

1. From the terminal within the CHIPS project directory, run:

```bash

ant -f build/developers/build.xml cbd

```
This builds the CHIPS files.

2. Then, execute:

```bash

chs-dev reload chips

```

3. For additional build information, refer to the [CHIPS documentation](https://github.com/companieshouse/docker-chs-development/blob/master/docs/chips.md).


## PERL and GO

Updates for Perl and Go-based services will be added soon.
