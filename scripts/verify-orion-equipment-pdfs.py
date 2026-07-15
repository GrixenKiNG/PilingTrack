import json
import re
from pathlib import Path
from urllib.parse import urlparse

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "orion" / "specs"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
REFERENCE_PHRASE = "Справочные характеристики модели"
BRANDING_PHRASES = (
    "Справочная карточка ОРИОН",
    "не официальный перевод производителя",
)
DISCLAIMER = (
    "Справочные характеристики модели. Фактическая комплектация конкретной "
    "установки уточняется по паспорту машины."
)
A4_WIDTH_POINTS = 595.28
A4_HEIGHT_POINTS = 841.89
A4_TOLERANCE_POINTS = 1.0

EXPECTED_SOURCE_URLS = {
    "pve-50pr.pdf": "https://www.agd-equipment.co.uk/images/articles/large/folder_pve_piling_1005_lr.pdf",
    "liebherr-lrh100.pdf": (
        "https://www.liebherr.com/shared/media/construction-machinery/deep-foundation/pdf/"
        "data-sheet-archive/lrb-series/liebherr-lrh-100-piling-rig-english-technical-"
        "data-sheet-specifications-10538148-english.pdf"
    ),
    "kburg-16.pdf": (
        "https://www.gruzovik.com/stroitelnaya-tehnika/svaeboynye-ustanovki/"
        "bashstroy-kburg-16-a9759783.html"
    ),
    "kopernik-sd20c.pdf": "https://exkavator.ru/excapedia/technic/kopernik_sd-20c",
    "banut-655.pdf": "https://www.prommashini.ru/upload/burovie_ust/BANUT%20655.pdf",
    "bauer-rtg-rm20.pdf": (
        "https://www.agd-equipment.co.uk/images/pdf/RTG_RM20_Specification_Details.pdf"
    ),
}


def normalized_text(value: str) -> str:
    return " ".join(value.split())


def pdf_text(value: str) -> str:
    return re.sub(r"[‐‑‒–—−]", "-", value)


def annotation_uris(page: object) -> set[str]:
    uris: set[str] = set()
    annotations = page.get("/Annots") or []
    for reference in annotations:
        annotation = reference.get_object()
        action = annotation.get("/A")
        if action and action.get("/S") == "/URI" and action.get("/URI"):
            uris.add(str(action.get("/URI")))
    return uris


def load_manifest() -> dict[str, dict[str, object]]:
    if not MANIFEST_PATH.exists():
        raise AssertionError(f"missing generated manifest: {MANIFEST_PATH}")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if set(manifest) != set(EXPECTED_SOURCE_URLS):
        raise AssertionError(
            "manifest filenames differ: "
            f"expected {sorted(EXPECTED_SOURCE_URLS)}, found {sorted(manifest)}"
        )
    return manifest


def main() -> None:
    manifest = load_manifest()
    present = {path.name for path in OUTPUT_DIR.glob("*.pdf")} if OUTPUT_DIR.exists() else set()
    expected = set(EXPECTED_SOURCE_URLS)
    missing = sorted(expected - present)
    unexpected = sorted(present - expected)

    errors: list[str] = []
    if missing:
        errors.append(f"missing PDFs: {', '.join(missing)}")
    if unexpected:
        errors.append(f"unexpected PDFs: {', '.join(unexpected)}")

    for filename, expected_source_url in EXPECTED_SOURCE_URLS.items():
        pdf_path = OUTPUT_DIR / filename
        if not pdf_path.exists():
            continue

        profile = manifest[filename]
        source = profile.get("source")
        source_url = source.get("url") if isinstance(source, dict) else None
        if source_url != expected_source_url:
            errors.append(
                f"{filename}: manifest source mismatch: "
                f"expected {expected_source_url!r}, found {source_url!r}"
            )
            continue

        reader = PdfReader(pdf_path)
        if len(reader.pages) != 1:
            errors.append(f"{filename}: expected exactly 1 page, found {len(reader.pages)}")
            continue

        page = reader.pages[0]
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        if (
            abs(width - A4_WIDTH_POINTS) > A4_TOLERANCE_POINTS
            or abs(height - A4_HEIGHT_POINTS) > A4_TOLERANCE_POINTS
        ):
            errors.append(
                f"{filename}: expected A4 mediabox within {A4_TOLERANCE_POINTS} pt, "
                f"found {width:.2f} x {height:.2f} pt"
            )

        raw_text = page.extract_text() or ""
        text = normalized_text(raw_text)
        compact_text = "".join(raw_text.split())
        model = str(profile.get("model", ""))
        source_host = urlparse(expected_source_url).netloc
        expected_texts = (
            model,
            source_host,
            REFERENCE_PHRASE,
            DISCLAIMER,
            *BRANDING_PHRASES,
        )
        for expected_text in expected_texts:
            if normalized_text(pdf_text(expected_text)) not in text:
                errors.append(f"{filename}: missing text {expected_text!r}")

        if expected_source_url not in compact_text:
            errors.append(f"{filename}: missing full source URL in extracted text")

        if expected_source_url not in annotation_uris(page):
            errors.append(f"{filename}: missing exact source link annotation")

        specifications = profile.get("specifications")
        if not isinstance(specifications, list) or not specifications:
            errors.append(f"{filename}: manifest has no specifications")
        else:
            for specification in specifications:
                if not isinstance(specification, dict):
                    errors.append(f"{filename}: malformed specification {specification!r}")
                    continue
                for field in ("label", "value"):
                    expected_value = normalized_text(pdf_text(str(specification.get(field, ""))))
                    if not expected_value or expected_value not in text:
                        errors.append(
                            f"{filename}: missing specification {field} {expected_value!r}"
                        )

    if errors:
        raise AssertionError("ORION PDF verification failed:\n- " + "\n- ".join(errors))

    print(f"{len(EXPECTED_SOURCE_URLS)} ORION equipment PDFs verified")


if __name__ == "__main__":
    main()
