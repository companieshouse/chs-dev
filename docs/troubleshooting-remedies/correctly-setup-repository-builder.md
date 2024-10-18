# Correctly setup a repository to use the repository/default builder

## Problem Summary

When a `chs.local.builder` label is not supplied `chs-dev` will expect the code
repository for the service to contain a `Dockerfile`.

## Resolution Summary

1. You need to decide where in your repository you want to create your
  Dockerfile.
2. Depending on what you're building and how the `Dockerfile` will be used
  (i.e. will it be only used for your local docker environment or will it be
  used elsewhere) will inform how you build your Dockerfile. To get the most
  out of `chs-dev` it will work best as a multi-stage docker build which will
  take the source code, compile and then run it at the end.
3. If you decide to place your Dockerfile in another part of your repository
  rather than root, you can set the `chs.local.dockerfile` label on the service
  to reference its location. Setting `chs.local.repoContext` will specify a
  different docker context (other than repository root).

OR

[Use a predefined builder](./correctly-setup-builder.md)

> [!WARNING]
> When not including the compilation step in your dockerfile it may mean
> having to compile the application before running reload for the changes to be
> reflected in your local docker environment

## Rationale

`chs-dev` requires a Dockerfile to be able to build the service in development
mode. Without one it is harder to build the service using Docker Compose.

Not supplying the `chs.local.builder` label instructs `chs-dev` that the
repository can build itself

## Related issues

* [Correctly Setup Builder](./correctly-setup-builder.md)

## References/external resources

* [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
* [Dockerfile Best Practices](https://docs.docker.com/build/building/best-practices/)
