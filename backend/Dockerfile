# Helsa backend — a multi-stage build.
#
# ONE image, all three binaries: the API, the ingestion worker and the token CLI.
# Which one runs is a runtime choice, not a build-time one:
#
#   docker run ghcr.io/nordic-sys/helsa/backend                 # the API (default)
#   docker run ghcr.io/nordic-sys/helsa/backend helsa-worker    # the worker
#   docker run ghcr.io/nordic-sys/helsa/backend helsa-token -subject bob
#
# ⚠️ It used to build a single binary chosen by an APP build argument, which meant
# the published image could only ever be the API: CI builds one image per context,
# with no arguments, so `ghcr.io/.../backend` was the API and there was no worker
# image at all. Anyone told to "just pull the images" would have got a stack with
# nothing consuming the queue — uploads accepted, and never processed. Three static
# binaries weigh a few megabytes; a missing one costs an afternoon.
ARG GO_VERSION=1.26

FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
# Dependency cache: go.mod/sum first, so that this layer stays cacheable.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Static (CGO-free) binaries — small and scratch-compatible.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/helsa-api    ./cmd/api  && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/helsa-worker ./cmd/worker && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/helsa-token  ./cmd/token

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 helsa
USER helsa
COPY --from=build /out/helsa-api /out/helsa-worker /out/helsa-token /usr/local/bin/
# No ENTRYPOINT: the command names the binary, so a compose file can pick one with
# `command:` instead of having to override an entrypoint.
CMD ["helsa-api"]
