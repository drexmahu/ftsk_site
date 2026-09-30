# Site Image Web Optimizer

Turns arbitrary site photos (hero banners, galleries, feature images, ...)
into resized, web-ready `.webp` files. No cropping - aspect ratio is always
preserved, images are only ever shrunk to fit, never upscaled.

For member portraits that need a square, face-cropped thumbnail as well, use
the sibling tool `../membership_image_converter/` instead.

## Setup (once)

1. Install Python 3 from [python.org/downloads](https://www.python.org/downloads/) - tick **"Add Python to PATH"**.
2. Double-click `install_dependencies.bat`.

## Use

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

## Picking the homepage hero crop/zoom/pan

The homepage hero (`data/hero_images.yaml`) crops each photo with CSS
`object-fit: cover` and Ken-Burns-pans/zooms it slowly. Double-click
`run_hero_picker.bat` to start the local hero picker: it opens
`hero_focus_picker.html` in your browser, already loaded with the site's real
hero photos and their real settings from `data/hero_images.yaml`. Use the
dropdown to pick which photo you're editing, click on the photo to set its
focus point, use the sliders to fine-tune the animation, then **Mentés**
(save) writes straight back to `data/hero_images.yaml` - no copy-pasting.
**"+ Új fotó hozzáadása"** lets you add a brand new hero photo: pick a file and
it's automatically converted to `.webp` into `static/images/hero/` and added
to the config with sensible defaults, ready to fine-tune. **"Kép törlése"**
removes the currently selected photo from both the config and
`static/images/hero/`.

If you open `hero_focus_picker.html` directly (double-click the file, no
server running), it falls back to the older offline mode: drag and drop any
local photos to preview crops/animations and copy a YAML snippet to paste into
`data/hero_images.yaml` by hand.

## Troubleshooting

- **"python is not recognized"** - reinstall Python with "Add Python to PATH", or try `py` instead of `python`.
- **Missing module errors** - rerun `install_dependencies.bat`.
