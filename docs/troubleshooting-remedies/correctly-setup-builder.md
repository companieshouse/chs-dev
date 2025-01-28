# Correctly setup service to use a predefined builder

## Problem Summary

When using the `chs.local.builder` label the service is referencing a directory
within `local/builders` which within a sub-directory contains a templated spec
file which can be used to build the service in development mode. So, this problem
occurs when:

1. Specifying a builder which does not exist in `local/builders`
2. Not supplying a builder label

When no builder label is supplied, `chs-dev` will assume the repository will
contain a `Dockerfile` which can be used to build an image for the service.

## Resolution Summary

1. Locate the `local/builders` directory within your local repository
  containing service files
2. Choose an appropriate builder from this list (i.e. the names of the
  directory within this list)
3. Add the label `chs.local.builder` to the service with the name of the
  builder
4. Further configure the labels with the following labels (where applicable):

    * `chs.local.builder.languageVersion` - for some builders may provide the
      ability to customise the language major version used to compile and run
      the service. Applicable when there is not a version number in the builder
      name
    * `chs.local.builder.requiresSecrets=true` - set this label on a service
      which requires access to the secrets attached to the
      `docker-compose.spec` file
    * `chs.local.builder.useServiceDockerfile=true` - set this label on a
      service whose repository provides a non-standard build for the Docker image.
    * `chs.local.repoContext` - when label:
      `chs.local.builder.useServiceDockerfile=true` is set then allows
      customisation of the docker context from which the service is built from
      within the repository directory
    * `chs.local.dockerfile` -  when label:
      `chs.local.builder.useServiceDockerfile=true` is set then allows
      customisation of the Dockerfile used to build the service

OR

[Setup the service to use a repository builder/Dockerfile.](./correctly-setup-repository-builder.md)

## Rationale

The `chs.local.builder` refers to a directory within the project which can be
used to build the project in development mode. When `chs-dev` comes around to
generating the development Docker Compose Specification for the service it
looks up the builder's template first and then enriches this with the
information coming from the service.

## Related issues

* [Setting up the default behaviour/repository builder](./correctly-setup-repository-builder.md)

## References/external resources

* [Docker Compose Service Labels](https://docs.docker.com/reference/compose-file/services/#labels)
