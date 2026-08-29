---
name: image-to-svg
description: Recreate suitable flat or graphic raster references as clean, editable SVGs through semantic vector reconstruction and an iterative render-and-difference check. Use for logos, icons, emblems, diagrams, and flat illustrations; do not use as the default for photographs, textures, complex shading, or detail that only makes sense as pixels.
---

# Image-to-SVG Reconstruction

You have a raster reference and have been asked to recreate it as SVG. Build an editable representation of the intended design, not a literal trace of every pixel.

## Procedure

1. **Check suitability.** Vectorize when the reference has clear silhouettes, flat or limited colors, and meaningful geometry. If its identity depends on photography, texture, brushwork, or complex shading, explain the limitation and use a hybrid or raster approach.

2. **Analyze the reference.** Record the canvas and aspect ratio, background, palette, alignment, symmetry, proportions, negative space, and semantic parts (for example: frame, symbol, cutouts, accents, and lettering). Treat antialiasing, compression, noise, and isolated defects as artifacts unless they clearly express design intent.

3. **Construct the SVG.** Rebuild the parts with simple primitives and paths. Use named groups/layers and keep major components independently editable. Preserve negative space and important letterforms; keep text editable only when its font is reliable, otherwise use paths. Expose colors and key proportions as easy-to-adjust values. Do not add geometry merely to reproduce raster noise.

4. **Verify and iterate.**
   - Render the SVG to a raster image on the same aspect-ratio canvas as the reference.
   - Align the two images and inspect an overlay plus a difference view. For reproducible diagnostics, run `scripts/compare_images.py` with the reference first and the rendered candidate second; it writes `diff.png`, `mask.png`, `overlay.png`, and `metrics.json`.
   - Fix the largest structural differences first: silhouette, placement, scale, proportions, spacing, symmetry, color boundaries, and negative space. Use thresholds and visual judgment to ignore minor antialiasing or compression differences.
   - Repeat render → compare → adjust until remaining differences are non-structural or would require disproportionate, brittle vector detail.

## Deliver

Provide the editable SVG and a rendered preview. Include difference artifacts when they help review the result, and briefly state important assumptions, ignored artifacts, or limits of the reconstruction.

If the reference cannot be represented faithfully as clean geometry, say so instead of forcing a complex trace.
