# Phase 0 resolved versions

Recorded 2026-08-01. JavaScript and Python transitive versions are authoritative in `pnpm-lock.yaml` and `apps/worker-python/uv.lock`.

| Component          | Version or image                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Node.js            | 24.13.0                                                                                                                        |
| pnpm               | 10.29.2                                                                                                                        |
| CPython            | 3.13.12                                                                                                                        |
| uv                 | 0.10.0                                                                                                                         |
| PostgreSQL         | `postgres:18.1-bookworm` · `sha256:cc9f4143a8d2fa8cf3749d0cb4d26ecf2d53a77a2ac807e9ebd67ae22426221a`                           |
| Redis              | `redis:8.4.0-alpine` · `sha256:4eec4565e45aa0b3966554c866bc73211e281b0b3d89fe9a33c982e6faca809d`                               |
| MinIO              | `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` · `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` |
| MinIO Client       | `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z` · `sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727`    |
| Node base image    | `node:24.13.0-bookworm-slim` · `sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f`                       |
| Python base image  | `python:3.13.12-slim-bookworm` · `sha256:a58daefb915e1e03ad48f3ca4df8832065412c5c35cacb9d39f4229184de12b6`                     |
| uv image           | `ghcr.io/astral-sh/uv:0.10.0` · `sha256:78a7ff97cd27b7124a5f3c2aefe146170793c56a1e03321dd31a289f6d82a04f`                      |
| Keycloak reference | `quay.io/keycloak/keycloak:26.6.3` · `sha256:9b0330756022422149aa6502eb2def8cd47c6e1b000c7c65cdb13e7c0133e992`                 |
| age CLI            | `v1.3.1`, compiled in `golang:1.25.5-bookworm` · `sha256:d9132cce84391efab786495288756d60e1da215b1f94e87860aeefc3d4c45b6d`     |

Container tags are explicit and never use `latest`. Digests above are the resolved manifests observed during the Phase 0 Apple Silicon smoke build; release automation must record the supported release-platform digests separately.
