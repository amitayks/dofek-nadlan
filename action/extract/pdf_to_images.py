import tempfile
import os

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

try:
    from pdf2image import convert_from_path
    HAS_PDF2IMAGE = True
except ImportError:
    HAS_PDF2IMAGE = False


def pdf_to_images(pdf_path: str, dpi: int = 300) -> list[str]:
    """Convert PDF pages to PNG images at specified DPI.

    Returns list of image file paths. Uses PyMuPDF if available,
    falls back to pdf2image (requires poppler).
    """
    output_dir = tempfile.mkdtemp(prefix="pdf_images_")

    if HAS_PYMUPDF:
        return _convert_with_pymupdf(pdf_path, output_dir, dpi)
    elif HAS_PDF2IMAGE:
        return _convert_with_pdf2image(pdf_path, output_dir, dpi)
    else:
        raise RuntimeError("No PDF library available. Install PyMuPDF or pdf2image.")


def _convert_with_pymupdf(pdf_path: str, output_dir: str, dpi: int) -> list[str]:
    doc = fitz.open(pdf_path)
    image_paths = []

    zoom = dpi / 72  # Default PDF resolution is 72 DPI
    matrix = fitz.Matrix(zoom, zoom)

    for page_num in range(len(doc)):
        page = doc[page_num]
        pix = page.get_pixmap(matrix=matrix)
        img_path = os.path.join(output_dir, f"page_{page_num + 1:03d}.png")
        pix.save(img_path)
        image_paths.append(img_path)

    doc.close()
    print(f"Converted {len(image_paths)} pages from {pdf_path}")
    return image_paths


def _convert_with_pdf2image(pdf_path: str, output_dir: str, dpi: int) -> list[str]:
    images = convert_from_path(pdf_path, dpi=dpi, output_folder=output_dir, fmt="png")
    image_paths = []

    for i, img in enumerate(images):
        img_path = os.path.join(output_dir, f"page_{i + 1:03d}.png")
        img.save(img_path, "PNG")
        image_paths.append(img_path)

    print(f"Converted {len(image_paths)} pages from {pdf_path}")
    return image_paths
