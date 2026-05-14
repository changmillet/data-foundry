#!/usr/bin/env python3
"""Build Foundry wiki pages from the LCA-DATA-AGENT Rulesbook PDFs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = Path("/home/example/projects/LCA-DATA-AGENT/inputs/Rulesbook")
DEFAULT_WIKI_DIR = REPO_ROOT / "wiki"
DEFAULT_MAX_CHARS = 18_000
MINERU_SCRIPT = Path(
    os.environ.get(
        "DOCUMENT_GRANULAR_DECOMPOSE_SCRIPT",
        "/home/example/.agents/skills/document-granular-decompose/scripts/mineru_fulltext_extract.py",
    ),
)

MINERU_REQUIRED_ENV = ("UNSTRUCTURED_API_BASE_URL", "UNSTRUCTURED_AUTH_TOKEN")


@dataclass(frozen=True)
class DocumentMeta:
    file_name: str
    doc_id: str
    title: str
    language: str
    tags: list[str]
    source_identity: str


@dataclass(frozen=True)
class PageText:
    page: int
    text: str


@dataclass(frozen=True)
class TextChunk:
    index: int
    page_start: int | None
    page_end: int | None
    text: str


DOCUMENTS = {
    "1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf": DocumentMeta(
        file_name="1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf",
        doc_id="ilcd-handbook-general-guide-detailed-guidance-2010",
        title="ILCD Handbook General Guide for LCA Detailed Guidance (2010)",
        language="en",
        tags=["rulesbook", "ilcd", "lca", "handbook", "detailed-guidance"],
        source_identity=(
            "European Commission Joint Research Centre ILCD Handbook detailed guidance PDF "
            "for life cycle assessment method implementation."
        ),
    ),
    "9-MANPROJ-PR-ILCD-Handbook-Nomenclature-and-other-conventions-first-edition-ISBN-fin-v1.0-E.pdf": DocumentMeta(
        file_name="9-MANPROJ-PR-ILCD-Handbook-Nomenclature-and-other-conventions-first-edition-ISBN-fin-v1.0-E.pdf",
        doc_id="ilcd-handbook-nomenclature-conventions-2010",
        title="ILCD Handbook Nomenclature and Other Conventions (2010)",
        language="en",
        tags=["rulesbook", "ilcd", "lca", "nomenclature", "conventions"],
        source_identity=(
            "European Commission Joint Research Centre ILCD Handbook nomenclature and convention PDF "
            "for consistent LCA dataset naming and documentation."
        ),
    ),
    "产品碳足迹因子数据库建设指引.pdf": DocumentMeta(
        file_name="产品碳足迹因子数据库建设指引.pdf",
        doc_id="product-carbon-footprint-factor-database-guide",
        title="产品碳足迹因子数据库建设指引",
        language="zh",
        tags=["rulesbook", "product-carbon-footprint", "factor-database", "guidance", "zh"],
        source_identity="产品碳足迹因子数据库建设相关的中文指引 PDF。",
    ),
}


def load_env_file(path: Path, *, override: bool = False) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value.startswith("export "):
            value = value[len("export "):]
        value = value.strip().strip("\"'")
        if override or key not in os.environ:
            os.environ[key] = value


def load_runtime_env() -> None:
    load_env_file(REPO_ROOT / ".env")
    lca_env_file = os.environ.get("LCA_DATA_AGENT_ENV_FILE")
    if lca_env_file:
        load_env_file(Path(lca_env_file))


def sanitize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def yaml_scalar(value: object) -> str:
    return json.dumps("" if value is None else value, ensure_ascii=False)


def yaml_array(key: str, values: Iterable[str]) -> str:
    items = list(values)
    if not items:
        return f"{key}: []\n"
    lines = [f"{key}:"]
    lines.extend(f"  - {yaml_scalar(item)}" for item in items)
    return "\n".join(lines) + "\n"


def yaml_block(key: str, value: str) -> str:
    text = sanitize_text(value)
    if not text:
        return f"{key}: \"\"\n"
    lines = [f"{key}: |-"]
    lines.extend(f"  {line}" if line else "" for line in text.split("\n"))
    return "\n".join(lines) + "\n"


def frontmatter(fields: list[tuple[str, object]], arrays: dict[str, list[str]] | None = None, blocks: dict[str, str] | None = None) -> str:
    output = ["---"]
    array_keys = set(arrays or {})
    block_keys = set(blocks or {})
    for key, value in fields:
        if key in array_keys:
            output.append(yaml_array(key, arrays[key]).rstrip("\n"))
        elif key in block_keys:
            output.append(yaml_block(key, blocks[key]).rstrip("\n"))
        else:
            output.append(f"{key}: {yaml_scalar(value)}")
    output.append("---")
    return "\n".join(output) + "\n\n"


def write_page(path: Path, markdown: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(markdown, encoding="utf-8")


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return normalized or "rulesbook-source"


def metadata_for(path: Path) -> DocumentMeta:
    if path.name in DOCUMENTS:
        return DOCUMENTS[path.name]
    doc_id = slugify(path.stem)
    return DocumentMeta(
        file_name=path.name,
        doc_id=doc_id,
        title=path.stem,
        language="unknown",
        tags=["rulesbook", "lca", "source"],
        source_identity=f"Rulesbook PDF source file: {path.name}",
    )


def mineru_available() -> bool:
    return MINERU_SCRIPT.exists() and all(os.environ.get(key) for key in MINERU_REQUIRED_ENV)


def extract_with_mineru(pdf_path: Path) -> str:
    with tempfile.TemporaryDirectory(prefix="foundry-rulesbook-") as tmp_dir:
        output_path = Path(tmp_dir) / "fulltext.txt"
        subprocess.run(
            [
                sys.executable,
                str(MINERU_SCRIPT),
                "--file",
                str(pdf_path),
                "--output",
                str(output_path),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return sanitize_text(output_path.read_text(encoding="utf-8"))


def extract_with_pypdf(pdf_path: Path) -> tuple[list[PageText], int]:
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise SystemExit("Missing pypdf. Install pypdf or configure document-granular-decompose env.") from error

    reader = PdfReader(str(pdf_path))
    pages: list[PageText] = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as error:  # pragma: no cover - defensive extraction fallback.
            text = f"[Text extraction failed for page {index}: {error}]"
        pages.append(PageText(page=index, text=sanitize_text(text)))
    return pages, len(reader.pages)


def chunk_pages(pages: list[PageText], max_chars: int) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    current: list[PageText] = []
    current_len = 0

    def flush() -> None:
        nonlocal current, current_len
        if not current:
            return
        text = "\n\n".join(f"--- Page {item.page} ---\n{item.text}" for item in current)
        chunks.append(
            TextChunk(
                index=len(chunks) + 1,
                page_start=current[0].page,
                page_end=current[-1].page,
                text=sanitize_text(text),
            ),
        )
        current = []
        current_len = 0

    for page in pages:
        block_len = len(page.text) + 40
        if current and current_len + block_len > max_chars:
            flush()
        current.append(page)
        current_len += block_len
    flush()
    return chunks


def chunk_text(text: str, max_chars: int) -> list[TextChunk]:
    paragraphs = [item.strip() for item in re.split(r"\n{2,}", text) if item.strip()]
    chunks: list[TextChunk] = []
    current: list[str] = []
    current_len = 0

    def flush() -> None:
        nonlocal current, current_len
        if not current:
            return
        chunks.append(
            TextChunk(
                index=len(chunks) + 1,
                page_start=None,
                page_end=None,
                text=sanitize_text("\n\n".join(current)),
            ),
        )
        current = []
        current_len = 0

    for paragraph in paragraphs:
        block_len = len(paragraph) + 2
        if current and current_len + block_len > max_chars:
            flush()
        current.append(paragraph)
        current_len += block_len
    flush()
    return chunks


def page_range(chunk: TextChunk) -> str:
    if chunk.page_start is None or chunk.page_end is None:
        return f"chunk {chunk.index}"
    if chunk.page_start == chunk.page_end:
        return str(chunk.page_start)
    return f"{chunk.page_start}-{chunk.page_end}"


def build_chunk_page(meta: DocumentMeta, chunk: TextChunk, extraction_method: str, today: str) -> str:
    chunk_id = f"{meta.doc_id}-chunk-{chunk.index:03d}"
    summary_path = f"source-summaries/{meta.doc_id}.md"
    body = (
        "## Chunk Identity\n\n"
        f"- Source: {meta.title}\n"
        f"- Source file: `{meta.file_name}`\n"
        f"- Page range: {page_range(chunk)}\n"
        f"- Extraction method: {extraction_method}\n\n"
        "## Extracted Text\n\n"
        f"{chunk.text}\n"
    )
    return frontmatter(
        [
            ("pageType", "source-fulltext-chunk"),
            ("title", f"{meta.title} - chunk {chunk.index:03d}"),
            ("nodeId", chunk_id),
            ("status", "active"),
            ("visibility", "private"),
            ("sourceRefs", None),
            ("relatedPages", None),
            ("tags", None),
            ("createdAt", today),
            ("updatedAt", today),
            ("sourceTitle", meta.title),
            ("sourceFile", meta.file_name),
            ("sourceDocId", meta.doc_id),
            ("chunkIndex", chunk.index),
            ("pageRange", page_range(chunk)),
            ("extractionMethod", extraction_method),
            ("fullText", None),
        ],
        arrays={
            "sourceRefs": [summary_path],
            "relatedPages": ["concepts/foundry-rulesbook-wiki.md"],
            "tags": [*meta.tags, "source-fulltext"],
        },
        blocks={"fullText": chunk.text},
    ) + body


def build_source_summary(meta: DocumentMeta, pdf_path: Path, chunks: list[TextChunk], extraction_method: str, today: str, sha256: str) -> str:
    chunk_dir = f"source-fulltext-chunks/{meta.doc_id}"
    chunk_range = f"{chunk_dir}/{meta.doc_id}-chunk-001.md"
    if len(chunks) > 1:
        chunk_range = f"{chunk_dir}/{meta.doc_id}-chunk-001.md through {meta.doc_id}-chunk-{len(chunks):03d}.md"
    body = (
        "## Source Identity\n\n"
        f"{meta.source_identity}\n\n"
        f"- Source PDF: `wiki/vault/Rulesbook/{meta.file_name}`\n"
        f"- Original source path: `{pdf_path}`\n"
        f"- SHA-256: `{sha256}`\n"
        f"- Language: {meta.language}\n"
        f"- Extraction method used for this import: {extraction_method}\n"
        f"- Fulltext chunk pages: `{chunk_range}`\n\n"
        "## Key Claims\n\n"
        "- This page is the provenance anchor for the imported Rulesbook document.\n"
        "- The full extracted text is stored in `source-fulltext-chunk` pages so the wiki can index the source text without treating one PDF as one oversized page.\n"
        "- For exact wording, read the chunk page matching the relevant source page range.\n\n"
        "## Knowledge Connections\n\n"
        "This source supports the Foundry Rulesbook knowledge layer and should be queried before data-governance tasks that need LCA methodology, naming, carbon-footprint factor database, or ILCD background rules.\n\n"
        "## Evidence Pointers\n\n"
        f"Chunk count: {len(chunks)}. First chunk path: `{chunk_dir}/{meta.doc_id}-chunk-001.md`.\n"
    )
    return frontmatter(
        [
            ("pageType", "source-summary"),
            ("title", meta.title),
            ("nodeId", meta.doc_id),
            ("status", "active"),
            ("visibility", "private"),
            ("sourceRefs", None),
            ("relatedPages", None),
            ("tags", None),
            ("createdAt", today),
            ("updatedAt", today),
            ("sourceType", "pdf"),
            ("vaultPath", f"wiki/vault/Rulesbook/{meta.file_name}"),
            ("keyFindings", None),
        ],
        arrays={
            "sourceRefs": [],
            "relatedPages": ["concepts/foundry-rulesbook-wiki.md", "source-summaries/rulesbook-corpus.md"],
            "tags": meta.tags,
            "keyFindings": [
                "Rulesbook source PDF imported into the Foundry wiki.",
                "Full extracted text is represented as source-fulltext-chunk pages.",
                "Use chunk page ranges for exact source recovery.",
            ],
        },
    ) + body


def build_corpus_page(docs: list[dict[str, object]], today: str) -> str:
    related = [f"source-summaries/{doc['doc_id']}.md" for doc in docs]
    rows = [
        "| Source | Language | Pages | Chunks | Summary page |",
        "| --- | --- | --- | --- | --- |",
    ]
    for doc in docs:
        rows.append(
            "| "
            f"{doc['title']} | "
            f"{doc['language']} | "
            f"{doc.get('page_count', 'n/a')} | "
            f"{doc['chunk_count']} | "
            f"`source-summaries/{doc['doc_id']}.md` |"
        )
    body = (
        "## Source Identity\n\n"
        "Rulesbook is the first source corpus imported into the Foundry wiki. It is copied from the LCA-DATA-AGENT input directory and normalized into source summaries plus fulltext chunks.\n\n"
        "## Key Claims\n\n"
        "- The corpus is preserved as source PDFs under `wiki/vault/Rulesbook/`.\n"
        "- Each PDF has a source-summary page that records provenance and links to chunk pages.\n"
        "- Each chunk page stores extracted text in the `fullText` field so `tiangong-wiki fts` can retrieve terms from the source material.\n\n"
        "## Knowledge Connections\n\n"
        "Use this corpus before Foundry tasks that need LCA methodology, ILCD conventions, or product-carbon-footprint factor database guidance.\n\n"
        "## Evidence Pointers\n\n"
        + "\n".join(rows)
        + "\n"
    )
    return frontmatter(
        [
            ("pageType", "source-summary"),
            ("title", "Rulesbook Corpus"),
            ("nodeId", "rulesbook-corpus"),
            ("status", "active"),
            ("visibility", "private"),
            ("sourceRefs", None),
            ("relatedPages", None),
            ("tags", None),
            ("createdAt", today),
            ("updatedAt", today),
            ("sourceType", "pdf-corpus"),
            ("vaultPath", "wiki/vault/Rulesbook"),
            ("keyFindings", None),
        ],
        arrays={
            "sourceRefs": [],
            "relatedPages": ["concepts/foundry-rulesbook-wiki.md", *related],
            "tags": ["rulesbook", "lca", "foundry-wiki", "source-corpus"],
            "keyFindings": [
                "Rulesbook is available as a Foundry-local wiki corpus.",
                "Fulltext chunks are indexed through the source-fulltext-chunk type.",
                "Source PDFs are copied into the wiki vault for provenance.",
            ],
        },
    ) + body


def build_concept_page(docs: list[dict[str, object]], today: str) -> str:
    source_refs = ["source-summaries/rulesbook-corpus.md", *[f"source-summaries/{doc['doc_id']}.md" for doc in docs]]
    body = (
        "## Definition\n\n"
        "Foundry Rulesbook Wiki is the repo-local Tiangong Wiki knowledge layer that turns the LCA Rulesbook PDFs into queryable source summaries and indexed fulltext chunks for TianGong LCA Data Foundry tasks.\n\n"
        "## Prerequisites\n\n"
        "Use it from the foundry repository root with the npm `wiki:*` commands. The wiki stores Markdown as source of truth and derives `wiki/index.db` through `tiangong-wiki sync`.\n\n"
        "## Formal Specification\n\n"
        "- Source PDFs live under `wiki/vault/Rulesbook/`.\n"
        "- Provenance pages use `pageType: source-summary`.\n"
        "- Extracted source text uses `pageType: source-fulltext-chunk` and stores chunk text in the `fullText` field for FTS indexing.\n"
        "- `wiki/index.db` is a derived local index and should be rebuilt with `npm run wiki:sync`.\n"
        "- Future PDF refreshes should run `npm run wiki:build-rulesbook` before `npm run wiki:sync`.\n\n"
        "## Intuition & Analogy\n\n"
        "Treat this wiki as Foundry's local rulebook memory: source PDFs stay as provenance, source summaries tell the agent what each document is, and fulltext chunk pages make exact source wording recoverable without re-opening the PDFs.\n\n"
        "## Typical Applications\n\n"
        "- Query ILCD or product-carbon-footprint background before data-governance work.\n"
        "- Find exact terminology or convention text with `npm run wiki:fts -- \"<term>\"`.\n"
        "- Give Foundry workers a stable source layer before using CLI, skills, or database adapters.\n\n"
        "## Boundary & Confusion\n\n"
        "This wiki is not the task queue and not a replacement for source PDFs. Task execution still belongs in `tasks/` and `.foundry/workspaces/`; the wiki provides reusable background knowledge and source recovery.\n\n"
        "## Open Questions\n\n"
        "- Whether the wiki daemon/dashboard should later be started for interactive browsing.\n"
        "- Whether the unstructured parser should replace the current local extraction snapshot once `UNSTRUCTURED_*` credentials are available.\n"
    )
    return frontmatter(
        [
            ("pageType", "concept"),
            ("title", "Foundry Rulesbook Wiki"),
            ("nodeId", "foundry-rulesbook-wiki"),
            ("status", "active"),
            ("visibility", "private"),
            ("sourceRefs", None),
            ("relatedPages", None),
            ("tags", None),
            ("createdAt", today),
            ("updatedAt", today),
            ("confidence", "medium"),
            ("masteryLevel", "medium"),
            ("prerequisites", None),
        ],
        arrays={
            "sourceRefs": source_refs,
            "relatedPages": source_refs,
            "tags": ["foundry", "rulesbook", "wiki", "lca", "knowledge-base"],
            "prerequisites": [],
        },
    ) + body


def build_rulesbook_wiki(args: argparse.Namespace) -> dict[str, object]:
    load_runtime_env()
    source_dir = Path(args.source_dir).expanduser().resolve()
    wiki_dir = Path(args.wiki_dir).expanduser().resolve()
    if not source_dir.exists():
        raise SystemExit(f"Rulesbook source directory does not exist: {source_dir}")

    vault_dir = wiki_dir / "vault" / "Rulesbook"
    pages_dir = wiki_dir / "pages"
    summaries_dir = pages_dir / "source-summaries"
    chunks_root = pages_dir / "source-fulltext-chunks"
    concept_dir = pages_dir / "concepts"
    vault_dir.mkdir(parents=True, exist_ok=True)
    summaries_dir.mkdir(parents=True, exist_ok=True)
    chunks_root.mkdir(parents=True, exist_ok=True)
    concept_dir.mkdir(parents=True, exist_ok=True)

    if chunks_root.exists():
        shutil.rmtree(chunks_root)
        chunks_root.mkdir(parents=True, exist_ok=True)

    today = date.today().isoformat()
    parser_requested = args.parser
    mineru_ready = mineru_available()
    docs: list[dict[str, object]] = []

    for pdf_path in sorted(source_dir.glob("*.pdf")):
        meta = metadata_for(pdf_path)
        vault_path = vault_dir / pdf_path.name
        shutil.copy2(pdf_path, vault_path)
        pdf_sha256 = sha256_file(pdf_path)

        parser_used = "pypdf"
        extraction_method = "pypdf page.extract_text"
        page_count: int | str

        if parser_requested in {"auto", "mineru"} and mineru_ready:
            try:
                fulltext = extract_with_mineru(pdf_path)
                chunks = chunk_text(fulltext, args.max_chars)
                parser_used = "document-granular-decompose"
                extraction_method = "document-granular-decompose mineru_with_images return_txt=true"
                page_count = "n/a"
            except Exception as error:
                if parser_requested == "mineru":
                    raise SystemExit(f"document-granular-decompose failed for {pdf_path.name}: {error}") from error
                pages, real_page_count = extract_with_pypdf(pdf_path)
                chunks = chunk_pages(pages, args.max_chars)
                page_count = real_page_count
                extraction_method = "pypdf page.extract_text fallback after document-granular-decompose failure"
        else:
            if parser_requested == "mineru":
                missing = [key for key in MINERU_REQUIRED_ENV if not os.environ.get(key)]
                raise SystemExit(f"document-granular-decompose is not configured. Missing: {', '.join(missing)}")
            pages, real_page_count = extract_with_pypdf(pdf_path)
            chunks = chunk_pages(pages, args.max_chars)
            page_count = real_page_count
            if parser_requested == "auto" and not mineru_ready:
                extraction_method = "pypdf page.extract_text fallback; document-granular-decompose env unavailable"

        chunk_dir = chunks_root / meta.doc_id
        chunk_dir.mkdir(parents=True, exist_ok=True)
        total_chars = sum(len(chunk.text) for chunk in chunks)
        for chunk in chunks:
            chunk_page = build_chunk_page(meta, chunk, extraction_method, today)
            chunk_path = chunk_dir / f"{meta.doc_id}-chunk-{chunk.index:03d}.md"
            write_page(chunk_path, chunk_page)

        summary = build_source_summary(meta, pdf_path, chunks, extraction_method, today, pdf_sha256)
        write_page(summaries_dir / f"{meta.doc_id}.md", summary)

        docs.append(
            {
                "doc_id": meta.doc_id,
                "title": meta.title,
                "file_name": meta.file_name,
                "language": meta.language,
                "source_pdf": str(pdf_path),
                "vault_pdf": str(vault_path.relative_to(REPO_ROOT)),
                "sha256": pdf_sha256,
                "parser_used": parser_used,
                "extraction_method": extraction_method,
                "page_count": page_count,
                "chunk_count": len(chunks),
                "char_count": total_chars,
            },
        )

    write_page(summaries_dir / "rulesbook-corpus.md", build_corpus_page(docs, today))
    write_page(concept_dir / "foundry-rulesbook-wiki.md", build_concept_page(docs, today))

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_dir": str(source_dir),
        "wiki_dir": str(wiki_dir),
        "parser_requested": parser_requested,
        "document_granular_decompose_configured": mineru_ready,
        "document_granular_decompose_required_env": {key: bool(os.environ.get(key)) for key in MINERU_REQUIRED_ENV},
        "max_chars": args.max_chars,
        "document_count": len(docs),
        "chunk_count": sum(int(doc["chunk_count"]) for doc in docs),
        "documents": docs,
    }
    (wiki_dir / "rulesbook-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", default=str(DEFAULT_SOURCE_DIR), help="Directory containing Rulesbook PDFs.")
    parser.add_argument("--wiki-dir", default=str(DEFAULT_WIKI_DIR), help="Foundry wiki directory.")
    parser.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS, help="Approximate max extracted characters per chunk page.")
    parser.add_argument(
        "--parser",
        choices=("auto", "pypdf", "mineru"),
        default="auto",
        help="auto uses document-granular-decompose when configured, otherwise pypdf.",
    )
    return parser.parse_args()


def main() -> None:
    manifest = build_rulesbook_wiki(parse_args())
    print(
        json.dumps(
            {
                "ok": True,
                "document_count": manifest["document_count"],
                "chunk_count": manifest["chunk_count"],
                "manifest": "wiki/rulesbook-manifest.json",
            },
            ensure_ascii=False,
            indent=2,
        ),
    )


if __name__ == "__main__":
    main()
