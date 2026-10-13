"""Local Lanczos enlargement. This baseline is not an AI super-resolution model."""
import argparse
from pathlib import Path
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 25_000_000


def upscale(source: Path, destination: Path, scale: int = 2) -> tuple[int, int]:
    if scale not in (2, 3, 4):
        raise ValueError("scale must be 2, 3 or 4")
    if source.resolve() == destination.resolve():
        raise ValueError("output must differ from input")
    if destination.exists():
        raise FileExistsError("output already exists")
    with Image.open(source) as image:
        if image.format not in ("JPEG", "PNG", "WEBP") or getattr(image, "n_frames", 1) > 1:
            raise ValueError("only static JPEG, PNG and WebP are supported")
        image = ImageOps.exif_transpose(image)
        size = (image.width * scale, image.height * scale)
        if size[0] * size[1] > 100_000_000:
            raise ValueError("output exceeds 100 million pixels")
        enlarged = image.resize(size, Image.Resampling.LANCZOS)
        if destination.suffix.lower() in (".jpg", ".jpeg"):
            enlarged = enlarged.convert("RGB")
        destination.parent.mkdir(parents=True, exist_ok=True)
        enlarged.save(destination)
        return size


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Local image enlargement (Lanczos)")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--scale", type=int, choices=(2, 3, 4), default=2)
    args = parser.parse_args()
    width, height = upscale(args.source, args.destination, args.scale)
    print(f"Saved {width}x{height} image: {args.destination}")
