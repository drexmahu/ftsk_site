# Site Image Web Optimizer

Turns arbitrary site photos (hero banners, galleries, feature images, ...)
into resized, web-ready `.webp` files. No cropping - aspect ratio is always
preserved, images are only ever shrunk to fit, never upscaled.

Inputs: JPG, PNG, WebP and HEIF/HEIC (including phone photos), decoded with
Pillow and `pillow-heif`. Multi-image HEIF files use their primary image;
extra frames, depth maps and motion are not exported. High-bit-depth images
are decoded to 8-bit for WebP output; this is not an HDR-preserving workflow.

For square, face-cropped member thumbnails, use **People & portraits** in
the Workbench. Its backend is [portraits.py](portraits.py).

## Setup (once)

Run `./scripts/setup-dev-env.ps1` from the repository root to install all
site tools and the converter/hero editor dependencies into `.venv`. See
the [setup guide](../../docs/TECHNICAL_ENVIRONMENT.md#local-setup-windows).
The Workbench launcher uses that environment automatically. Separate GUI,
CLI, dependency-installation and hero-server launchers have been retired.

## Use

Run `site_editor.bat` from
the repository root and choose **Site photos** or **Hero slideshow**. It uses
the same conversion and framing tools, with protected output names and a
shared preview/check dashboard. See [Site Workbench](../../docs/TECHNICAL_ENVIRONMENT.md#site-workbench).

1. Choose or drop a batch in **Site photos**. Pending thumbnails have an
   individual cancel button; removing one never deletes a converted file.
2. Set the destination under `static/images/`, max dimensions and quality.
3. Convert explicitly and inspect the results/progress. Existing filenames
   receive suffixes rather than being overwritten.

For page-owned photos, use **Pages & posts -> Add images & PDFs**. For CV
illustrations, use the person's **CV / necrolog** editor; its destination is
restricted to that person's ID folder.

The Python converter and `hero_config.py` are backend modules, not launchable
applications. `hero_focus_picker.html` and `hero_poi_editor.js` remain because
the Workbench embeds the hero composition editor.

## Output

For `cave-photo.jpg` you get `cave-photo.webp` - resized, original aspect
ratio kept, no crop.

## Hero editor: subject, composition, and motion

Open **Hero slideshow** in the Workbench to edit the real photos and settings
from `data/hero_images.yaml`. **Save** writes to that file. **Add new photo**
converts and adds a WebP photo; **Remove** removes its slideshow entry while
retaining the image file for other pages.

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

Hero POIs do not change article images, galleries, or social-card cropping.

Regression checks, from the repository root:

```powershell
node tests/js/test_hero_framing.js
```

## Troubleshooting

- **Missing Python/packages** - rerun the repository's `setup-dev-env.bat`.
