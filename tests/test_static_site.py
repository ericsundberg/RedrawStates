"""Regression tests for the static website and its deployment paths."""

import json
import subprocess
import sys
import tempfile
import threading
import unittest
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "build-site.py"
AREA_OVERLAY = Path("data/areas/2019.json")


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)

        if tag == "script" and attributes.get("src"):
            self.assets.append(attributes["src"])
        elif tag == "img" and attributes.get("src"):
            self.assets.append(attributes["src"])
        elif tag == "link" and "stylesheet" in attributes.get("rel", "").split():
            if attributes.get("href"):
                self.assets.append(attributes["href"])


def build_into(destination):
    return subprocess.run(
        [sys.executable, str(BUILDER), "--output", str(destination)],
        text=True,
        capture_output=True,
        check=False,
    )


def configured_datasets():
    """Read the actual browser dataset catalog, not legacy source syntax."""
    script = """
import { LEGACY_DATASETS } from "./js/data/legacy-datasets.mjs";
console.log(JSON.stringify(LEGACY_DATASETS));
"""

    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )

    return json.loads(result.stdout)


class StaticSiteTests(unittest.TestCase):
    def test_root_entry_point_and_assets(self):
        self.assertTrue((ROOT / "index.html").is_file())

        parser = AssetParser()
        parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))

        for asset in parser.assets:
            parsed = urlsplit(asset)
            if parsed.scheme or parsed.netloc:
                continue

            self.assertFalse(parsed.path.startswith("/"), asset)
            self.assertFalse(parsed.path.startswith("public/"), asset)
            self.assertNotIn("..", Path(parsed.path).parts, asset)
            self.assertTrue((ROOT / parsed.path).is_file(), asset)

    def test_all_configured_datasets_exist(self):
        datasets = configured_datasets()

        self.assertGreater(len(datasets), 0)

        seen_ids = set()

        for dataset in datasets:
            with self.subTest(dataset=dataset.get("id")):
                self.assertIn("id", dataset)
                self.assertIn("filename", dataset)
                self.assertNotIn(dataset["id"], seen_ids)
                seen_ids.add(dataset["id"])

                relative_path = dataset["filename"]
                parsed = urlsplit(relative_path)

                self.assertFalse(parsed.scheme)
                self.assertFalse(parsed.netloc)
                self.assertFalse(parsed.path.startswith("/"))
                self.assertNotIn("..", Path(parsed.path).parts)
                self.assertTrue(relative_path.startswith("data/"))

                path = ROOT / relative_path
                self.assertTrue(path.is_file(), relative_path)

                with path.open(encoding="utf-8") as stream:
                    data = json.load(stream)

                self.assertIn("objects", data)
                self.assertIn("counties", data["objects"])
                self.assertIn(
                    "geometries",
                    data["objects"]["counties"],
                )

    def test_area_overlay_is_packaged(self):
        source = ROOT / AREA_OVERLAY
        self.assertTrue(source.is_file(), str(source))

        with source.open(encoding="utf-8") as stream:
            overlay = json.load(stream)

        self.assertEqual(overlay["schema"], "redraw-area-v1")
        self.assertEqual(overlay["geographyVintage"], 2019)
        self.assertEqual(
            set(overlay["datasetIds"]),
            {"2020", "2020s", "2024"},
        )
        self.assertEqual(
            len(overlay["areas"]),
            overlay["coverage"]["recordCount"],
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site"
            result = build_into(output)
            self.assertEqual(result.returncode, 0, result.stderr)

            deployed = output / AREA_OVERLAY
            self.assertTrue(deployed.is_file())

            with deployed.open(encoding="utf-8") as stream:
                deployed_overlay = json.load(stream)

            self.assertEqual(deployed_overlay, overlay)

    def test_builder_is_clean_and_repeatable(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site"

            first = build_into(output)
            self.assertEqual(first.returncode, 0, first.stderr)

            self.assertTrue((output / "index.html").is_file())
            self.assertTrue((output / "js" / "map.js").is_file())
            self.assertTrue((output / "data" / "us2024.json").is_file())

            for excluded in (
                "src",
                "tests",
                "scripts",
                ".git",
                "pyproject.toml",
            ):
                self.assertFalse((output / excluded).exists())

            (output / "obsolete.txt").write_text(
                "stale",
                encoding="utf-8",
            )

            second = build_into(output)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertFalse((output / "obsolete.txt").exists())

    def test_builder_refuses_unmanaged_directories(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "important"
            output.mkdir()

            original = output / "keep.txt"
            original.write_text("Do not delete", encoding="utf-8")

            result = build_into(output)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(
                original.read_text(encoding="utf-8"),
                "Do not delete",
            )

    def test_http_paths_at_root_and_nested_directory(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site"
            result = build_into(output)
            self.assertEqual(result.returncode, 0, result.stderr)

            for prefix in ("/", "/tests/redraw-states/"):
                with self.subTest(prefix=prefix):
                    self.check_http_site(output, prefix)

    def check_http_site(self, directory, prefix):
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(directory), **kwargs)

            def translate_path(self, path):
                requested = urlsplit(path).path
                if requested.startswith(prefix):
                    requested = "/" + requested[len(prefix):]
                return super().translate_path(requested)

            def log_message(self, format, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(
            target=server.serve_forever,
            daemon=True,
        )
        thread.start()

        try:
            base = f"http://127.0.0.1:{server.server_port}{prefix}"

            def fetch(relative_path):
                with urlopen(urljoin(base, relative_path), timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    return response.read()

            html = fetch("").decode("utf-8")
            self.assertEqual(
                html,
                fetch("index.html").decode("utf-8"),
            )

            parser = AssetParser()
            parser.feed(html)

            for asset in parser.assets:
                parsed = urlsplit(asset)

                if not parsed.scheme and not parsed.netloc:
                    with self.subTest(asset=asset):
                        self.assertGreater(len(fetch(asset)), 0)

            self.assertGreater(len(fetch("js/map.js")), 0)

            data = json.loads(fetch("data/us2024.json"))
            self.assertIn("counties", data["objects"])

            area_data = json.loads(fetch(AREA_OVERLAY.as_posix()))
            self.assertEqual(area_data["schema"], "redraw-area-v1")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()