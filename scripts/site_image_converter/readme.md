# Site Image Web Optimizer

Turns arbitrary site photos (hero banners, galleries, feature images, ...)
into resized, web-ready `.webp` files. No cropping - aspect ratio is always
preserved, images are only ever shrunk to fit, never upscaled.

Inputs: JPG, PNG, WebP and HEIF/HEIC (including phone photos), decoded with
Pillow and `pillow-heif`. Multi-image HEIF files use their primary image;
extra frames, depth maps and motion are not exported. High-bit-depth images
are decoded to 8-bit for WebP output; this is not an HDR-preserving workflow.

For member portraits that need a square, face-cropped thumbnail as well, use
the sibling tool `../membership_image_converter/` instead.

## Setup (once)

Run `./scripts/setup-dev-env.ps1` from the repository root to install all
site tools and the converter/hero editor dependencies into `.venv`. See
the [setup guide](../../docs/TECHNICAL_ENVIRONMENT.md#local-setup-windows).
The GUI/dependency/hero-picker launchers prefer that environment automatically.

For a standalone copy without the project environment, install Python 3
from [python.org/downloads](https://www.python.org/downloads/) with PATH/Tk
support, then double-click `install_dependencies.bat`.

## Use

For the integrated browser alternative, run `site_editor.bat` from
the repository root and choose **Site photos** or **Hero slideshow**. It uses
the same conversion and framing tools, with protected output names and a
shared preview/check dashboard. See [Site Workbench](../../docs/TECHNICAL_ENVIRONMENT.md#site-workbench).
The standalone GUI/CLI below remains available.

1. Double-click `run_gui.bat`.
2. Pick your **input folder** (original photos). The **output folder**
   defaults to this site's `static/images/hero/` folder (created
   automatically if it doesn't exist yet) - change it to any other
   `static/images/...` folder for other parts of the site.
3. Adjust max width/height/quality if needed (defaults suit most photos).
4. Click **Start** and watch the log - it also prints each output image's
   final pixel size and orientation (landscape/portrait), handy when wiring
   new images into a Hugo data file afterwards.

Prefer the terminal? `py site_image_converter.py` runs the same thing as
text prompts instead of the window, and also accepts flags for
non-interactive use:

```
py site_image_converter.py --input ./photos --output ./out --max-width 1600 --max-height 1600 --quality 82
```

## Output

For `cave-photo.jpg` you get `cave-photo.webp` - resized, original aspect
ratio kept, no crop.

## Hero editor: subject, composition, and motion

Double-click `run_hero_picker.bat` to open the connected editor with the
real photos and settings from `data/hero_images.yaml`. **Save** writes to
that file. **Add new photo** converts and adds a WebP photo; **Delete photo**
removes both its configuration and image file.

### Subject on the full source photo

Use the crosshair button in **Subject** to open the original, uncropped,
unmirrored photo. Click the important point, such as a face or helmet.
**Fit photo** shows the whole image; **100%** and **200%** allow scrolling
at native or enlarged resolution. Arrow keys adjust the point by 0.5%;
Shift+arrow moves it by 5%. Close with the close button or Escape.
Source X/Y inputs allow numeric adjustment.

Every photo uses POI framing. A missing POI starts at the source center,
and the reset button returns to that center. There is no alternate mode.
The initial center is not a guess at the true subject: select it yourself.
Coordinates refer to the original photo even when it is mirrored:

```yaml
poi:
   x: 33
   y: 40
```

Values are finite numbers between 0 and 100, without `%` signs. One source
point applies to desktop, tablet, and phone. It marks a point, not the
whole person or object; inspect the surrounding area too.

### Compose and animate

**Composition X/Y%** (`start.focus`) specifies where the selected subject
should appear in the hero, not where it is in the source photo. Clicking
the device preview changes composition only; source selection is independent.
Try placing the subject toward the right on desktop to leave space for
the headline. Use **Desktop**, **Tablet**, and **Phone** tabs for responsive
overrides; tablet/phone inherit desktop until custom settings are enabled.

```yaml
- path: /images/hero/ftsk-hero-cave-2.webp
   alt: "Describe the actual photo"
   poi: { x: 33, y: 40 }
   start:
      zoom: 1.35
      focus: "72% 50%"
   animation:
      type: pan
      direction: down
      amount: 4
      duration: 12
   mobile:
      focus: "50% 50%"
      type: zoom-in
      amount: 0.15
```

This is a syntax example, not a recommended subject point for every photo.
Adjust zoom, type, direction, amount, and duration; check the timeline at
0%, 50%, and 100%, then use **Play**. Site and editor share the same framing
calculation. Motion uses gentle easing and pauses on inactive slides/hidden
tabs; reduced-motion preference produces a static frame on the site.

Image coverage is recalculated on resize, including mirror and rotation.
Requested positions/pan are limited by available image area; extreme target
positions are restricted to the 10-90% range. Tilt may add enough zoom to
cover the corners. **Edge-limited framing** means the requested composition
cannot be achieved exactly without a blank border. **Outside this crop**
means subject positioning is impossible at that zoom/tilt phase. Reduce
tilt/zoom, choose a point farther inside the subject, use a device override,
or use a different photo. Borders take priority over an impossible subject
position; images are not stretched or distorted. Check that the headline
and cave motifs do not obscure the subject, and test the actual homepage
at narrow and wide widths as well as the representative device previews.

### Save or export

Connected **Save** persists POIs and responsive settings. Switching photos
before saving discards local edits. Saving another photo preserves existing
POIs and overrides. Selecting/resetting a POI does not reset motion settings.

Opening `hero_focus_picker.html` directly uses offline mode: drop local
files, select POIs, and adjust motion. **Copy YAML snippet** exports POI,
responsive overrides, mirror, and `hide_below` for manual inclusion in the
config. Offline files are only previewed, not uploaded or converted.
Hero POIs do not change article images, galleries, or social-card cropping.

Regression checks, from the repository root:

```powershell
node scripts/site_image_converter/test_hero_framing.js
```

## Troubleshooting

- **"python is not recognized"** - reinstall Python with "Add Python to PATH", or try `py` instead of `python`.
- **Missing module errors** - rerun `install_dependencies.bat`.
