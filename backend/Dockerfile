# Helsa backend — a multi-stage build. One Dockerfile for both binaries:
#   docker build --build-arg APP=api    -t helsa-api .
#   docker build --build-arg APP=worker -t helsa-worker .
# The Nordic-Sys cicdGoBuild (golang:1.26-alpine) uses this too (see docs/05 §8).
ARG GO_VERSION=1.26

FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
# Dependency cache: go.mod/sum first, so that this layer stays cacheable.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG APP=api
# A static (CGO-free) binary — for a small, scratch-compatible image.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/${APP}

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 helsa
USER helsa
COPY --from=build /out/app /usr/local/bin/app
ENTRYPOINT ["/usr/local/bin/app"]
