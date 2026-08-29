#!/usr/bin/env python3
"""Compare two raster renders pixel by pixel and write review artifacts.

The comparison is a diagnostic aid for vector reconstruction. It exposes large,
meaningful disagreements without implying that antialiasing or compression
artifacts should be copied into the SVG.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image


def parse_color(value: str) -> tuple[int, int, int, int]:
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        raise argparse.ArgumentTypeError("background must be a six-digit hex color")
    try:
        red, green, blue = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("background must be a hex color") from exc
    return red, green, blue, 255


def load_image(path: Path, background: tuple[int, int, int, int] | None) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    if background is not None:
        canvas = Image.new("RGBA", image.size, background)
        image = Image.alpha_composite(canvas, image).convert("RGB")
    return image


def comparable_images(
    reference: Image.Image,
    candidate: Image.Image,
    allow_resize: bool,
) -> tuple[Image.Image, Image.Image, bool]:
    if reference.size == candidate.size:
        return reference, candidate, False

    reference_ratio = reference.width / reference.height
    candidate_ratio = candidate.width / candidate.height
    if not math.isclose(reference_ratio, candidate_ratio, rel_tol=0, abs_tol=1e-6):
        raise ValueError(
            "images have different aspect ratios; align their canvases before comparing"
        )
    if not allow_resize:
        raise ValueError(
            "images have different dimensions; omit --no-resize to normalize the candidate"
        )

    resampling = getattr(Image, "Resampling", Image).LANCZOS
    return reference, candidate.resize(reference.size, resampling), True


def channel_values(image: Image.Image) -> Iterable[Sequence[int]]:
    return image.getdata()


def make_artifacts(
    reference: Image.Image,
    candidate: Image.Image,
    threshold: int,
    structural_threshold: int,
) -> tuple[Image.Image, Image.Image, Image.Image, dict[str, float | int]]:
    reference_pixels = channel_values(reference)
    candidate_pixels = channel_values(candidate)
    diff_pixels: list[tuple[int, int, int]] = []
    mask_pixels: list[int] = []
    overlay = Image.blend(reference.convert("RGB"), candidate.convert("RGB"), 0.5)

    pixel_count = reference.width * reference.height
    channel_count = len(reference.getpixel((0, 0)))
    sum_channel_delta = 0
    sum_pixel_delta = 0
    sum_squared_pixel_delta = 0
    max_pixel_delta = 0
    changed_pixels = 0
    structural_pixels = 0

    for reference_pixel, candidate_pixel in zip(reference_pixels, candidate_pixels):
        deltas = [abs(int(left) - int(right)) for left, right in zip(reference_pixel, candidate_pixel)]
        pixel_delta = max(deltas)
        sum_channel_delta += sum(deltas)
        sum_pixel_delta += pixel_delta
        sum_squared_pixel_delta += pixel_delta * pixel_delta
        max_pixel_delta = max(max_pixel_delta, pixel_delta)

        if pixel_delta >= threshold:
            changed_pixels += 1
        if pixel_delta >= structural_threshold:
            structural_pixels += 1
        mask_pixels.append(255 if pixel_delta >= threshold else 0)

        if pixel_delta == 0:
            diff_pixels.append((0, 0, 0))
        else:
            intensity = min(255, pixel_delta * 4)
            # Black means equal; increasing disagreement moves from yellow to red.
            diff_pixels.append((255, max(0, 255 - intensity), 0))

    metrics: dict[str, float | int] = {
        "width": reference.width,
        "height": reference.height,
        "pixels": pixel_count,
        "channels_compared": channel_count,
        "mean_absolute_channel_difference": sum_channel_delta / (pixel_count * channel_count),
        "mean_max_channel_difference": sum_pixel_delta / pixel_count,
        "rms_max_channel_difference": math.sqrt(sum_squared_pixel_delta / pixel_count),
        "maximum_channel_difference": max_pixel_delta,
        "threshold": threshold,
        "structural_threshold": structural_threshold,
        "pixels_at_or_above_threshold": changed_pixels,
        "fraction_at_or_above_threshold": changed_pixels / pixel_count,
        "pixels_at_or_above_structural_threshold": structural_pixels,
        "fraction_at_or_above_structural_threshold": structural_pixels / pixel_count,
    }

    diff = Image.new("RGB", reference.size)
    diff.putdata(diff_pixels)
    mask = Image.new("L", reference.size)
    mask.putdata(mask_pixels)
    return diff, mask, overlay, metrics


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compare a reference image and a candidate raster render pixel by pixel."
    )
    parser.add_argument("reference", type=Path, help="original/reference raster image")
    parser.add_argument("candidate", type=Path, help="candidate raster render of the SVG")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("image-diff"),
        help="directory for diff.png, mask.png, overlay.png, and metrics.json",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=12,
        help="minimum per-pixel channel difference shown in mask.png (0-255)",
    )
    parser.add_argument(
        "--structural-threshold",
        type=int,
        default=32,
        help="threshold used for the structural-difference metric (0-255)",
    )
    parser.add_argument(
        "--background",
        type=parse_color,
        help="hex color used to flatten transparency before comparison, e.g. #050505",
    )
    parser.add_argument(
        "--no-resize",
        action="store_true",
        help="fail instead of resizing a same-aspect-ratio candidate to the reference size",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not 0 <= args.threshold <= 255 or not 0 <= args.structural_threshold <= 255:
        parser.error("threshold values must be between 0 and 255")

    reference = load_image(args.reference, args.background)
    candidate = load_image(args.candidate, args.background)
    try:
        reference, candidate, resized = comparable_images(
            reference, candidate, allow_resize=not args.no_resize
        )
    except ValueError as exc:
        parser.error(str(exc))

    diff, mask, overlay, metrics = make_artifacts(
        reference, candidate, args.threshold, args.structural_threshold
    )
    metrics["candidate_resized_to_reference"] = resized

    args.out_dir.mkdir(parents=True, exist_ok=True)
    diff.save(args.out_dir / "diff.png")
    mask.save(args.out_dir / "mask.png")
    overlay.save(args.out_dir / "overlay.png")
    with (args.out_dir / "metrics.json").open("w", encoding="utf-8") as metrics_file:
        json.dump(metrics, metrics_file, indent=2)
        metrics_file.write("\n")

    print(json.dumps(metrics, indent=2))
    print(f"Artifacts written to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
