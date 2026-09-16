"""Free checks of trusted grader examples. No agent, judge, host, or storage."""

import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
EXAMPLES = Path(__file__).resolve().parent
EVALS = ROOT / "evals" / "azure-functions-update"


class MigrationGraders(unittest.TestCase):
    def grade(self, scenario, example=None, changes=(), settings_version="3.12",
              indexing=True, dependency=True, event_changes=()):
        with tempfile.TemporaryDirectory(prefix="python-migration-test-") as temp:
            workspace = Path(temp)
            fixture = EVALS / scenario / "fixtures"
            for name in ("function_app.py", "requirements.txt", "host.json",
                         "events.py", "app-settings.json"):
                if (fixture / name).exists():
                    shutil.copyfile(fixture / name, workspace / name)
            if example:
                code = (EXAMPLES / example).read_text(encoding="utf-8")
                for old, new in changes:
                    self.assertIn(old, code)
                    code = code.replace(old, new)
                (workspace / "function_app.py").write_text(code, encoding="utf-8")
            if event_changes:
                code = (workspace / "events.py").read_text(encoding="utf-8")
                for old, new in event_changes:
                    self.assertIn(old, code)
                    code = code.replace(old, new)
                (workspace / "events.py").write_text(code, encoding="utf-8")
            package = ("azurefunctions-extensions-bindings-blob" if scenario == "python-blob-sdk"
                       else "azurefunctions-extensions-http-fastapi")
            if dependency:
                with (workspace / "requirements.txt").open("a", encoding="utf-8") as output:
                    output.write(package + "\n")
            if scenario == "python-http-streaming":
                settings = json.loads((workspace / "app-settings.json").read_text())
                settings["pythonVersion"] = settings_version
                if indexing:
                    settings["Values"]["PYTHON_ENABLE_INIT_INDEXING"] = "1"
                (workspace / "app-settings.json").write_text(json.dumps(settings))
            result = subprocess.run(
                [sys.executable, "-I", "-B", str(fixture / "grade.py")],
                cwd=workspace, capture_output=True, text=True, timeout=30,
            )
            evidence = workspace / "grading-evidence" / "execution.json"
            self.assertTrue(evidence.exists(), result.stdout + result.stderr)
            report = json.loads(evidence.read_text())
            self.assertEqual(result.returncode == 0, report["passed"], report)
            return report

    def test_blob_valid_full_unicode_and_empty(self):
        report = self.grade("python-blob-sdk", "blob_valid.py")
        self.assertTrue(report["passed"], report)

    def test_blob_invalid_examples(self):
        for changes in [
            (("readall()", "read(size=1)"),),
            (("file.download_blob().readall()", "file.read()"),),
            (("file: blob.BlobClient", "file: func.InputStream"),),
            (('methods=["GET"]', 'methods=["POST"]'),),
            (('route="file"', 'route="renamed"'),),
            (("func.AuthLevel.FUNCTION", "func.AuthLevel.ANONYMOUS"),),
            (("python-worker-tests/test-filelike.txt", "other/file.txt"),),
            (("connection=\"AzureWebJobsStorage\"", "connection=\"OtherStorage\""),),
            (('status_code=200', 'status_code=201'),),
            (('.decode("utf-8")', '.decode("latin-1")'),),
            (('.decode("utf-8")', ''),),
        ]:
            with self.subTest(changes=changes):
                self.assertFalse(self.grade("python-blob-sdk", "blob_valid.py", changes)["passed"])
        self.assertFalse(self.grade("python-blob-sdk", "blob_valid.py", dependency=False)["passed"])
        self.assertFalse(self.grade("python-blob-sdk")["passed"])

    def test_streaming_valid_and_version_settings(self):
        report = self.grade("python-http-streaming", "streaming_valid.py")
        self.assertTrue(report["passed"], report)
        self.assertFalse(self.grade("python-http-streaming", "streaming_valid.py",
                                   settings_version="3.13", indexing=False)["passed"])
        self.assertFalse(self.grade("python-http-streaming", "streaming_valid.py",
                                    indexing=False)["passed"])
        checker = runpy.run_path(str(EVALS / "python-http-streaming" / "fixtures" / "grade.py"))["check_settings"]
        settings = {"pythonVersion": "3.13", "Values": {
            "FUNCTIONS_WORKER_RUNTIME": "python", "FUNCTIONS_EXTENSION_VERSION": "~4",
            "APP_LABEL": "migration-fixture",
        }}
        checker(settings)
        settings["pythonVersion"] = "3.12"
        with self.assertRaisesRegex(AssertionError, "INIT_INDEXING"):
            checker(settings)

    def test_streaming_invalid_examples(self):
        for changes in [
            (("StreamingResponse(count_events(),", 'StreamingResponse([event async for event in count_events()],'),),
            (("async def echo(req: Request)", "async def echo(req: func.HttpRequest)"),),
            (('return Response(data["message"], status_code=200, media_type="text/plain")',
              'return func.HttpResponse(data["message"])'),),
            (('methods=["POST"]', 'methods=["GET"]'),),
            (('route="echo"', 'route="renamed"'),),
            (("http_auth_level=func.AuthLevel.FUNCTION", "http_auth_level=func.AuthLevel.ANONYMOUS"),),
            (("await req.json()", "req.get_json()"),),
            (('status_code=422', 'status_code=400'),),
            (('media_type="text/event-stream"', 'media_type="text/plain"'),),
        ]:
            with self.subTest(changes=changes):
                self.assertFalse(self.grade("python-http-streaming", "streaming_valid.py", changes)["passed"])
        self.assertFalse(self.grade("python-http-streaming", "streaming_valid.py", dependency=False)["passed"])
        self.assertFalse(self.grade("python-http-streaming")["passed"])
        for event_changes in [
            (("range(5)", "range(6)"),),
            (("range(5)", "range(4, -1, -1)"),),
            (("import asyncio", "import asyncio\nimport time"),
             ("await asyncio.sleep(0)", "time.sleep(0.1)")),
        ]:
            with self.subTest(event_changes=event_changes):
                self.assertFalse(self.grade("python-http-streaming", "streaming_valid.py",
                                            event_changes=event_changes)["passed"])


if __name__ == "__main__":
    unittest.main()
