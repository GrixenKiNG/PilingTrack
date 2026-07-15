from pathlib import Path
from urllib.parse import urlparse

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "orion" / "specs"
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

EXPECTED_PDFS = {
    "pve-50pr.pdf": (
        "PVE 50PR",
        "https://www.mascus.fr/construction/piling-rigs/pve-50-pr/en8q8rgq.html",
    ),
    "liebherr-lrh100.pdf": (
        "Liebherr LRH 100",
        "https://www.liebherr.com/shared/media/construction-machinery/deep-foundation/pdf/"
        "data-sheet-archive/lrb-series/liebherr-lrh-100-piling-rig-english-technical-"
        "data-sheet-specifications-10538148-english.pdf",
    ),
    "kburg-16.pdf": (
        "КБУРГ-16",
        "https://www.gruzovik.com/stroitelnaya-tehnika/svaeboynye-ustanovki/"
        "bashstroy-kburg-16-a9759783.html",
    ),
    "kopernik-sd20c.pdf": (
        "Kopernik SD-20C",
        "https://ehkskavator.ru/item/1038754",
    ),
    "banut-655.pdf": (
        "Banut 655",
        "https://www.fymasauctions.dk/us/Listing/Details/24097910",
    ),
    "bauer-rtg-rm20.pdf": (
        "Bauer RTG RM20",
        "https://www.rtg-rammtechnik.de/de/rm-20",
    ),
}


def main() -> None:
    present = {path.name for path in OUTPUT_DIR.glob("*.pdf")} if OUTPUT_DIR.exists() else set()
    expected = set(EXPECTED_PDFS)
    missing = sorted(expected - present)
    unexpected = sorted(present - expected)

    errors: list[str] = []
    if missing:
        errors.append(f"missing PDFs: {', '.join(missing)}")
    if unexpected:
        errors.append(f"unexpected PDFs: {', '.join(unexpected)}")

    for filename, (model, source_url) in EXPECTED_PDFS.items():
        pdf_path = OUTPUT_DIR / filename
        if not pdf_path.exists():
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

        text = " ".join((page.extract_text() or "").split())
        source_host = urlparse(source_url).netloc
        expected_texts = (
            model,
            source_host,
            REFERENCE_PHRASE,
            DISCLAIMER,
            *BRANDING_PHRASES,
        )
        for expected_text in expected_texts:
            if expected_text not in text:
                errors.append(f"{filename}: missing text {expected_text!r}")

    if errors:
        raise AssertionError("ORION PDF verification failed:\n- " + "\n- ".join(errors))

    print(f"{len(EXPECTED_PDFS)} ORION equipment PDFs verified")


if __name__ == "__main__":
    main()