FROM quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z AS minio-client

FROM golang:1.25.5-bookworm AS age-builder
RUN GOBIN=/out go install filippo.io/age/cmd/age@v1.3.1 && GOBIN=/out go install filippo.io/age/cmd/age-keygen@v1.3.1

FROM postgres:18.1-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates jq && rm -rf /var/lib/apt/lists/*
COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc
COPY --from=age-builder /out/age /out/age-keygen /usr/local/bin/
COPY deploy/admin/engrove-backup /usr/local/bin/engrove-backup
RUN chmod 0555 /usr/local/bin/engrove-backup
USER postgres
ENTRYPOINT ["engrove-backup"]
