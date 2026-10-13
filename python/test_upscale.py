import tempfile
import unittest
from pathlib import Path
from PIL import Image
from upscale import upscale


class UpscaleTest(unittest.TestCase):
    def test_enlarges_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "input.png"
            target = Path(folder) / "output.png"
            Image.new("RGB", (8, 6), "green").save(source)
            self.assertEqual(upscale(source, target), (16, 12))
            with Image.open(target) as image:
                self.assertEqual(image.size, (16, 12))
            with Image.open(source) as image:
                self.assertEqual(image.size, (8, 6))
            with self.assertRaises(FileExistsError):
                upscale(source, target)

    def test_rejects_overwrite_and_invalid_scale(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "input.png"
            Image.new("RGB", (8, 6)).save(source)
            with self.assertRaises(ValueError):
                upscale(source, source)
            with self.assertRaises(ValueError):
                upscale(source, Path(folder) / "output.png", scale=5)


if __name__ == "__main__":
    unittest.main()
