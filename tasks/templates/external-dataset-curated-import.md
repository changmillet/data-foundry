---
id: external-import-YYYYMMDD-short-name
title: Import packaged LCA dataset into TIDAS
state: Todo
kind: external-dataset-curated-import
dataset_type: process
priority: P1
allow_remote_commit: false
source_package: inputs/source-packages/<package-manifest-or-note>.md
---

## Goal

Convert the source package through the CLI/tools lane, validate generated TIDAS data, and prepare dry-run database import artifacts.

## Required Gates

- contract context pack
- tidas-tools conversion report
- schema validation
- review
- source-language completeness and placeholder scan
- reference closure
- publish/import dry run
