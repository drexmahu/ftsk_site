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

## Picking the homepage hero crop/focus point

The homepage hero (`data/hero_images.yaml`) crops each photo with CSS
`object-fit: cover` and pans it slightly - for some photos the interesting
part isn't centered, so double-click `hero_focus_picker.html` (opens
directly in your browser, no server needed) to preview the real crop/pan for
each converted `.webp`, click on the photo to set its focus point, adjust
zoom, and copy the generated `focus`/`zoom` lines straight into
`data/hero_images.yaml`.

## Troubleshooting

- **"python is not recognized"** - reinstall Python with "Add Python to PATH", or try `py` instead of `python`.
- **Missing module errors** - rerun `install_dependencies.bat`.
