import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image

from tools.images import portraits as converter


class ManualCropTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "portrait.png"
        self.output = self.root / "output"
        self.output.mkdir()
        image = Image.new("RGB", (200, 100), "red")
        image.paste("blue", (100, 0, 200, 100))
        image.save(self.source)

    def process(self, picker):
        return converter.process_image(self.source, self.output, 64, 200, 100, 100,
                                       log=lambda message: None, manual_crop=picker)

    def test_manual_selection_uses_exact_region(self):
        picker = Mock(return_value=(100, 0, 200, 100))
        self.assertTrue(self.process(picker))
        picker.assert_called_once()
        with Image.open(self.output / "portrait_thumb.webp") as thumbnail:
            self.assertEqual(thumbnail.size, (64, 64))
            self.assertGreater(thumbnail.getpixel((32, 32))[2], 240)
        with Image.open(self.output / "portrait_full.webp") as full:
            self.assertEqual(full.size, (200, 100))

    def test_every_photo_uses_picker_without_detection(self):
        picker = Mock(return_value=(100, 0, 200, 100))
        with patch.object(converter, "detect_largest_face", side_effect=AssertionError("Automatic detection must not run"), create=True):
            self.assertTrue(self.process(picker))
        picker.assert_called_once()

    def test_no_picker_does_not_generate_automatic_crop(self):
        self.assertFalse(self.process(None))
        self.assertEqual(list(self.output.iterdir()), [])

    def test_cancel_does_not_write_outputs(self):
        self.assertFalse(self.process(lambda path, image: None))
        self.assertEqual(list(self.output.iterdir()), [])

    def test_invalid_selection_does_not_write_outputs(self):
        for box in ((-10, 0, 90, 100), (100, 0, 210, 110), (0, 0, 50, 75)):
            with self.subTest(box=box):
                self.assertFalse(self.process(lambda path, image: box))
        self.assertEqual(list(self.output.iterdir()), [])

    def test_picker_receives_exif_corrected_image(self):
        image = Image.new("RGB", (200, 100), "blue")
        exif = image.getexif()
        exif[274] = 6
        self.source = self.root / "rotated.jpg"
        image.save(self.source, exif=exif)

        def picker(path, oriented):
            self.assertEqual(oriented.size, (100, 200))
            return (0, 50, 100, 150)

        self.assertTrue(self.process(picker))

if __name__ == "__main__":
    unittest.main()