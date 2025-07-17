# Correctly Add Healthcheck to a Service Docker Composer File


## Problem Summary

To effectively monitor services during the development stage, health checks must be configured for each service in form of an api request.


## Resolution Summary

Follow these steps to configure a healthcheck on a service:
Example Service: `services/modules/delta/company-profile-api.docker-compose.yaml`

1. Open the docker-compose.yaml file - `company-profile-api.docker-compose.yaml`.
2. Configure an endpoint which the service will hit to check the health status of
the container, preferably a base route - `/healthcheck`.
3. Add the `expose` property if missing and set a port for internal communication by the container.

```yaml
 expose:
      - 8080
```
3. Add the healthcheck configuration to the service definition:
Example:

```yaml

healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/company-profile-api/healthcheck || exit 1",
        ]
      retries: 6
      start_period: 15s

```

Ensure the port number assigned to the healthcheck endpoint is the `expose`
property port number.
4. Save file.


## Rationale
Using healthcheck status to ensure the avaialbility of a container to receive request.

