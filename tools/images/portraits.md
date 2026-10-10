# Member portrait conversion backend

The Site Workbench replaces the old desktop GUI and its launchers. Run
`site_editor.bat` from the repository root and choose **People & portraits**.
Set up the project environment with `setup-dev-env.bat` first; see the
[setup guide](../../docs/TECHNICAL_ENVIRONMENT.md#local-setup-windows).
Python/Tk is no longer required.

This folder retains image-processing functions used by the Workbench:
square, manually face-cropped WebP thumbnails and resized full portraits.
Inputs include JPG, PNG, WebP and HEIF/HEIC. EXIF orientation is corrected;
multi-image HEIF uses its primary image and high-bit-depth inputs become
8-bit WebP. HDR, depth maps and motion are not preserved.

## Workbench workflow

1. Open the person, then **Portrait photo**, and choose or drop originals.
2. Pending thumbnails offer **Choose crop** and an individual cancel button.
   Cancellation removes only the temporary original, not saved portrait files.
3. Click or drag in the crop canvas to position the face; arrow keys move the
   selection and Shift moves farther. Adjust crop size and inspect the circular
   avatar preview. The exported thumbnail is square.
4. Explicitly confirm the crop and convert. New assignments belong to the open
   person draft; **Save person** persists them.

Person portraits use fixed ID-based names inside
`static/images/members/<person-id>/`. Replacing an existing pair requires
confirmation. The Workbench also supports an unassigned portrait-export mode;
it is part of the same browser workspace, not a separate application.

The thumbnail and full image are recognized by their `_thumb.webp` and
`_full.webp` suffixes and exact registry URLs, even when the same ID folder
contains many CV illustrations. Other illustrations do not appear as loose
portraits in the image audit.

For older flat portrait pairs, run `python -m scripts.migrate_member_images`
from the repository root to review the migration. Add `--apply` only after
reviewing the plan. The command preserves image bytes and source formatting,
updates local source references, and refuses shared images, existing
destinations and stale plans. Unassigned files and existing nested images
are left untouched.

The converter requires an explicit crop callback. It never substitutes
automatic face detection or a guessed center crop.

## Regression tests

From the repository root, using the project environment:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests\python -p test_manual_crop.py
npm test
```

The Python suite covers exact crop regions, cancellation, invalid selections
and EXIF orientation. Workbench tests cover the browser crop interaction.
