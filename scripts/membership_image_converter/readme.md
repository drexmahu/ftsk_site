# Member Image Web Optimizer

Turns raw member photos into two web-ready `.webp` files each: a square,
face-cropped thumbnail and a resized full image.

## Setup (once)

1. Install Python 3 from [python.org/downloads](https://www.python.org/downloads/) - tick **"Add Python to PATH"**.
2. Double-click `install_dependencies.bat`.

## Use

1. Double-click `run_gui.bat`.
2. Pick your **input folder** (original photos) and **output folder**.
3. Adjust settings if needed (defaults are fine for most photos).
4. Click **Start** and watch the log.

Prefer the terminal? `py membership_image_converter.py` runs the same thing
as text prompts instead of the window.

## Output

For `Gyovai_Tamas.jpg` you get:

- `Gyovai_Tamas_thumb.webp` - square, face-cropped (falls back to a centered
  crop if no face is detected - review these before publishing)
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


