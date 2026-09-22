"""Offline preparation regressions: tiny temporary fixtures, never real model weights."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("xrag_prepare_asr", Path(__file__).with_name("prepare-asr.py"))
asr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)


class PrepareAsrTests(unittest.TestCase):
    def fixture(self, directory):
        target = Path(directory)
        model = b"temporary fake weight"
        for name, value in {
            "model.bin": model, "config.json": b'{"model_type":"whisper"}',
            "tokenizer.json": b'{"version":"1.0"}', "vocabulary.txt": "测试\n".encode("utf-8"),
        }.items():
            (target / name).write_bytes(value)
            if name != "model.bin":
                metadata = target / ".cache" / "huggingface" / "download" / (name + ".metadata")
                metadata.parent.mkdir(parents=True, exist_ok=True)
                etag = hashlib.sha1(("blob " + str(len(value)) + "\0").encode("ascii") + value).hexdigest()
                metadata.write_text(asr.REVISION + "\n" + etag + "\n0\n", encoding="utf-8")
        return target, model

    def constants(self, model):
        return patch.multiple(asr, MODEL_BYTES=len(model), MODEL_SHA256=hashlib.sha256(model).hexdigest())

    def test_official_identity_is_pinned(self):
        self.assertEqual(asr.REVISION, "536b0662742c02347bc0e980a01041f333bce120")
        self.assertEqual(asr.MODEL_BYTES, 483546902)
        self.assertEqual(asr.MODEL_SHA256, "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671")

    def test_missing_model_is_explicit_without_writes_or_network(self):
        with tempfile.TemporaryDirectory(prefix="xrag-asr-") as directory:
            target = Path(directory) / "not-created"
            with patch.object(asr, "download_files", side_effect=AssertionError("NETWORK FORBIDDEN")):
                with self.assertRaises(asr.PreparationError) as raised:
                    asr.verify(target)
                self.assertEqual(raised.exception.code, "ASR_MODEL_MISSING")
                self.assertFalse(target.exists())

    def test_pinned_cache_and_manifest_reuse_are_offline_and_exclude_temporary_files(self):
        with tempfile.TemporaryDirectory(prefix="xrag-asr-") as directory:
            target, model = self.fixture(directory)
            (target / "model.bin.download").write_bytes(b"partial")
            (target / ".xrag-manifest-stale.tmp").write_bytes(b"partial")
            (target / "unrelated.txt").write_text("never include", encoding="utf-8")
            with self.constants(model), patch.object(asr, "download_files", side_effect=AssertionError("NETWORK FORBIDDEN")):
                result = asr.prepare(target)
                self.assertEqual(result["downloaded"], [])
                self.assertEqual(set(result["reused"]), set(asr.REQUIRED_FILES))
                verified = asr.verify(target)
                self.assertEqual(verified["networkRequests"], 0)
                self.assertEqual({r["name"] for r in verified["files"]}, set(asr.REQUIRED_FILES))
                # A good manifest is sufficient even when the SDK cache has gone away.
                for item in (target / ".cache" / "huggingface" / "download").iterdir():
                    item.unlink()
                self.assertEqual(asr.prepare(target)["downloaded"], [])

    def test_weight_size_or_hash_failure_preserves_original_file(self):
        with tempfile.TemporaryDirectory(prefix="xrag-asr-") as directory:
            target, model = self.fixture(directory)
            with self.constants(model):
                (target / "model.bin").write_bytes(b"x" * len(model))
                with self.assertRaises(asr.PreparationError) as raised:
                    asr.prepare(target)
                self.assertEqual(raised.exception.code, "ASR_MODEL_HASH_MISMATCH")
                self.assertEqual((target / "model.bin").read_bytes(), b"x" * len(model))
                (target / "model.bin").write_bytes(b"short")
                with self.assertRaises(asr.PreparationError) as raised:
                    asr.verify(target)
                self.assertEqual(raised.exception.code, "ASR_MODEL_SIZE_MISMATCH")

    def test_external_download_is_not_adopted_or_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="xrag-asr-") as directory:
            target = Path(directory)
            for name, data in {"config.json": b"{}", "tokenizer.json": b"{}", "vocabulary.txt": b"test"}.items():
                (target / name).write_bytes(data)
            partial = target / "model.bin.download"
            partial.write_bytes(b"owned by another downloader")
            with patch.object(asr, "download_files", side_effect=AssertionError("NETWORK FORBIDDEN")):
                with self.assertRaises(asr.PreparationError) as raised:
                    asr.prepare(target)
                self.assertEqual(raised.exception.code, "ASR_DOWNLOAD_IN_PROGRESS")
                self.assertEqual(partial.read_bytes(), b"owned by another downloader")
                self.assertFalse((target / "model.bin").exists())

    def test_manifest_tamper_and_configuration_change_fail_offline_verification(self):
        with tempfile.TemporaryDirectory(prefix="xrag-asr-") as directory:
            target, model = self.fixture(directory)
            with self.constants(model), patch.object(asr, "download_files", side_effect=AssertionError("NETWORK FORBIDDEN")):
                asr.prepare(target)
                manifest_path = target / asr.MANIFEST_NAME
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest["files"].append({"name": "../outside", "bytes": 0, "sha256": ""})
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(asr.PreparationError) as raised:
                    asr.verify(target)
                self.assertEqual(raised.exception.code, "ASR_MANIFEST_INVALID")
                asr.prepare(target)
                (target / "config.json").write_text('{"model_type":"changed"}', encoding="utf-8")
                with self.assertRaises(asr.PreparationError) as raised:
                    asr.verify(target)
                self.assertEqual(raised.exception.code, "ASR_MANIFEST_HASH_MISMATCH")

    def test_only_unproven_small_files_are_requested_at_the_pinned_revision(self):
        with tempfile.TemporaryDirectory(prefix="xrag-asr-") as directory:
            target, model = self.fixture(directory)
            metadata = target / ".cache" / "huggingface" / "download" / "config.json.metadata"
            metadata.write_text("other-commit\nwrong\n0\n", encoding="utf-8")
            requested = []
            def fake_download(destination, names):
                self.assertEqual(destination, target)
                requested.extend(names)
            with self.constants(model), patch.object(asr, "download_files", side_effect=fake_download):
                result = asr.prepare(target)
                self.assertEqual(requested, ["config.json"])
                self.assertNotIn("model.bin", result["downloaded"])
                self.assertEqual(asr.verify(target)["networkRequests"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
