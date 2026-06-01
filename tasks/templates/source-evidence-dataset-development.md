---
id: source-author-YYYYMMDD-short-name
title: Author TIDAS data from source document
state: Todo
kind: source-evidence-dataset-development
dataset_type: process
priority: P1
allow_remote_commit: false
source_document: inputs/source-documents/<document-note>.md
---

## Goal

Extract evidence from the source document, give AI the target TIDAS context pack, produce candidate rows, and route blockers into repair/review artifacts.

## Required Gates

- contract context pack
- source extraction report
- field-level evidence review
- schema validation
- review
- source-language completeness and placeholder scan
