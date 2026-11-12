FROM golang:1.27.4-alpine@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS builder
WORKDIR /build
RUN apk add --no-cache patch
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY main.go security_test.go ./
COPY patches/ /patches/
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod vendor && \
    patch -p1 -d vendor/github.com/go-jose/go-jose/v3 < /patches/json-depth.patch && \
    patch -p1 -d vendor/github.com/go-jose/go-jose/v3 < /patches/cbc-empty.patch && \
    go list -mod=vendor -deps . > /tmp/dependencies && \
    ! grep -q '^golang.org/x/crypto/openpgp' /tmp/dependencies && \
    go test -p 2 -mod=vendor ./... && \
    CGO_ENABLED=0 go build -p 2 -mod=vendor -trimpath -ldflags="-s -w" -o /out/caddy .

FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates tzdata
COPY --from=builder /out/caddy /usr/bin/caddy
ENV XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
EXPOSE 80 443 2019
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
