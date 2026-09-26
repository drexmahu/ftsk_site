# Member Image Web Optimizer

Turns raw member photos into two web-ready `.webp` files each: a square,
face-cropped thumbnail and a resized full image.

## Setup (once)

Run `./scripts/setup-dev-env.ps1` from the repository root to install all
site tools and this converter's dependencies into `.venv`. See the
[setup guide](../../docs/TECHNICAL_ENVIRONMENT.md#local-setup-windows).
The GUI/dependency launchers prefer that environment automatically.

For a standalone copy without the project environment, install Python 3
from [python.org/downloads](https://www.python.org/downloads/) with PATH/Tk
support, then double-click `install_dependencies.bat`.

## Use

1. Double-click `run_gui.bat`.
2. Pick your **input folder** (original photos). The **output folder**
   defaults to this site's `static/images/members/` folder (created
   automatically if it doesn't exist yet) - change it if you want to review
   the results somewhere else first.
3. Adjust settings if needed (defaults are fine for most photos).
4. Click **Start** and watch the log.

Starting `py membership_image_converter.py` opens the same GUI. Every photo
requires a manual crop; there is no automatic detection or center-crop fallback.

## Manual face selection

Each photo pauses the batch and opens
**Choose face crop**. The full, EXIF-corrected photo is shown with a movable
circle and a live **Avatar preview**.

- Drag the circle to position the face, or click elsewhere to move it there.
- Adjust **Crop size** with the slider or mouse wheel. The circle cannot
  move outside the image borders.
- Arrow keys move the selection; Shift+arrow moves farther.
- **Use crop** (or Enter) confirms the exact selection and resumes conversion.
- **Reset** restores the centered initial selection.
- **Skip photo**, Escape, or closing the picker skips that photo without
  writing new output files, then continues to the next image.

The circle previews the site's circular avatar; the exported thumbnail is
still a square WebP, as required by the existing site. Adjust crop tightness
in the popup for each photo. Skipped images are
reported together with failed images as “skipped or failed” in the GUI summary.

Crop regressions, from the repository root with the project environment active:

```powershell
python -m unittest discover -s scripts/membership_image_converter -p test_manual_crop.py
```

## Output

For `Gyovai_Tamas.jpg` you get:

- `Gyovai_Tamas_thumb.webp` - square, manually selected; review the avatar
  preview before confirming
- `Gyovai_Tamas_full.webp` - resized, original aspect ratio kept

## Using the images on the site

In `content/tagok.md`, per member:

```yaml
image: /images/members/Gyovai_Tamas_thumb.webp
modal_image: /images/members/Gyovai_Tamas_full.webp
```

Copy the generated files into `static/images/members/` in the repo.

## Troubleshooting

- **"python is not recognized"** - reinstall Python with "Add Python to PATH", or try `py` instead of `python`.
- **Missing module errors** - rerun `install_dependencies.bat`.
- The manual crop tool requires only Pillow and Python/Tk; OpenCV and NumPy
  are no longer required. Existing installations are not removed automatically.


