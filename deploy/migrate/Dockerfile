# The goose migration runner for the Helsa database.
#
# Why a separate image: the backend/ runtime image (alpine + the app binary)
# deliberately does not contain goose, and running it from the golang image would
# require a source mount and a module cache. This way it is self-contained and
# cacheable.
#
# The migrations are NOT baked into the image: compose mounts them from
# backend/db/migrations, so the repository stays the source of truth.

FROM golang:1.26-alpine AS build
ARG GOOSE_VERSION=v3.27.0
RUN go install github.com/pressly/goose/v3/cmd/goose@${GOOSE_VERSION}

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /go/bin/goose /usr/local/bin/goose
# goose uses the GOOSE_DRIVER / GOOSE_DBSTRING / GOOSE_MIGRATION_DIR environment
# form — the -dir flag could only go AFTER the driver and dbstring, which is easy to
# get wrong (see the earlier make migrate bug).
ENTRYPOINT ["goose"]
CMD ["up"]
