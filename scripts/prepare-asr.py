"""Prepare a pinned public ASR model. --verify never imports the download SDK."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

REPOSITORY = "Systran/faster-whisper-small"
REVISION = "536b0662742c02347bc0e980a01041f333bce120"
MODEL_BYTES = 483546902
MODEL_SHA256 = "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"
REQUIRED_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
MANIFEST_NAME = "xrag-manifest.json"
ROOT = Path(__file__).resolve().parents[1]


class PreparationError(Exception):
    def __init__(self, code, message, name=None):
        super().__init__(message)
        self.code, self.name = code, name


def fail(code, message, name=None):
    raise PreparationError(code, message, name)


def file_record(target, name):
    file = target / name
    if file.is_symlink() or not file.is_file():
        fail("ASR_MODEL_MISSING", "Required regular model file is missing.", name)
    size = file.stat().st_size
    if name == "model.bin" and size != MODEL_BYTES:
        fail("ASR_MODEL_SIZE_MISMATCH", "Model size does not match the pinned official artifact; file was preserved.", name)
    if name != "model.bin":
        if not size or size > 20 * 1024 * 1024:
            fail("ASR_CONFIG_INVALID", "Auxiliary model file is empty or exceeds the supported size.", name)
        try:
            content = file.read_text(encoding="utf-8")
            if name.endswith(".json") and not isinstance(json.loads(content), dict):
                raise ValueError("not an object")
        except (UnicodeError, ValueError):
            fail("ASR_CONFIG_INVALID", "Auxiliary model file is not valid UTF-8 configuration data.", name)
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    record = {"name": name, "bytes": size, "sha256": digest.hexdigest()}
    if name == "model.bin" and record["sha256"] != MODEL_SHA256:
        fail("ASR_MODEL_HASH_MISMATCH", "Model SHA-256 does not match the pinned official artifact; file was preserved.", name)
    return record


def load_manifest(target, required=False):
    path = target / MANIFEST_NAME
    if not path.is_file() or path.is_symlink():
        if required:
            fail("ASR_MANIFEST_MISSING", "Run explicit preparation to create a verified manifest.")
        return None
    try:
        if path.stat().st_size > 1024 * 1024:
            raise ValueError("manifest too large")
        manifest = json.loads(path.read_text(encoding="utf-8"))
        records = manifest["files"]
        if (manifest.get("schemaVersion") != 1 or manifest.get("source") != REPOSITORY
                or manifest.get("revision") != REVISION or manifest.get("runtimeNetwork") != "disabled"
                or not isinstance(records, list) or len(records) != len(REQUIRED_FILES)
                or {record.get("name") for record in records} != set(REQUIRED_FILES)):
            raise ValueError("manifest contract mismatch")
        return manifest
    except (KeyError, TypeError, ValueError, UnicodeError):
        if required:
            fail("ASR_MANIFEST_INVALID", "Manifest does not match the pinned model version and supported file set.")
        return None


def recorded_match(manifest, record):
    return bool(manifest and any(previous == record for previous in manifest["files"]))


def pinned_cache_match(target, record):
    """Reuse only a same-commit cache entry whose actual content matches its ETag."""
    if record["name"] == "model.bin":
        return True  # file_record already checked the official size and SHA-256.
    metadata = target / ".cache" / "huggingface" / "download" / (record["name"] + ".metadata")
    if metadata.is_symlink() or not metadata.is_file() or metadata.stat().st_size > 4096:
        return False
    try:
        lines = metadata.read_text(encoding="utf-8").splitlines()
        if len(lines) < 2 or lines[0].strip() != REVISION:
            return False
        etag = lines[1].strip().strip('"')
        if len(etag) == 64:
            return etag.lower() == record["sha256"]
        if len(etag) == 40:
            blob = hashlib.sha1()
            blob.update(("blob " + str(record["bytes"]) + "\0").encode("ascii"))
            with (target / record["name"]).open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    blob.update(block)
            return blob.hexdigest() == etag.lower()
    except (OSError, UnicodeError):
        return False
    return False


def download_files(target, names):
    # Deliberately lazy: verification and reuse do not require this dependency or network.
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        fail("ASR_PREPARE_DEPENDENCY_MISSING", "Install scripts/asr-requirements.lock.txt before explicit downloads.")
    snapshot_download(
        repo_id=REPOSITORY, revision=REVISION, local_dir=str(target),
        token=False, allow_patterns=list(names), force_download=True,
    )


def prepare(target):
    target.mkdir(parents=True, exist_ok=True)
    if target.is_symlink():
        fail("ASR_TARGET_INVALID", "The model directory must not be a symbolic link.")
    manifest = load_manifest(target)
    needed, records, reused = [], {}, []
    for name in REQUIRED_FILES:
        path = target / name
        if path.exists() or path.is_symlink():
            # A bad existing weight is never silently replaced; a downloader may own it.
            record = file_record(target, name)
            if name == "model.bin" or recorded_match(manifest, record) or pinned_cache_match(target, record):
                records[name] = record
                reused.append(name)
                continue
        if name == "model.bin" and (target / "model.bin.download").exists():
            fail("ASR_DOWNLOAD_IN_PROGRESS", "An external model.bin.download is present; let its owner finish and verify it first.", name)
        needed.append(name)
    if needed:
        download_files(target, needed)
    for name in REQUIRED_FILES:
        records[name] = file_record(target, name)
    result = {
        "schemaVersion": 1, "source": REPOSITORY, "revision": REVISION,
        "files": [records[name] for name in sorted(REQUIRED_FILES)],
        "runtimeNetwork": "disabled", "modelValidation": "official-size-and-sha256",
    }
    temporary = target / (".xrag-manifest-" + str(os.getpid()) + ".tmp")
    try:
        temporary.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        temporary.replace(target / MANIFEST_NAME)
    finally:
        if temporary.exists():
            temporary.unlink()
    return {"ok": True, "mode": "prepare", "source": REPOSITORY, "revision": REVISION,
            "downloaded": needed, "reused": reused, "manifest": MANIFEST_NAME,
            "files": result["files"], "runtimeNetwork": "disabled"}


def verify(target):
    # No mkdir, writes, imports of SDKs, downloads, or scans of cache/temp files.
    if target.is_symlink():
        fail("ASR_TARGET_INVALID", "The model directory must not be a symbolic link.")
    model = file_record(target, "model.bin")
    manifest = load_manifest(target, required=True)
    records = []
    for name in sorted(REQUIRED_FILES):
        record = model if name == "model.bin" else file_record(target, name)
        if not recorded_match(manifest, record):
            fail("ASR_MANIFEST_HASH_MISMATCH", "Local file differs from its pinned-version manifest.", name)
        records.append(record)
    return {"ok": True, "mode": "verify", "source": REPOSITORY, "revision": REVISION,
            "files": records, "runtimeNetwork": "disabled", "networkRequests": 0}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Verify only; strictly offline and read-only.")
    parser.add_argument("--model-dir", type=Path, default=ROOT / "models" / "faster-whisper-small")
    args = parser.parse_args(argv)
    try:
        result = verify(args.model_dir) if args.verify else prepare(args.model_dir)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except PreparationError as error:
        print(json.dumps({"ok": False, "code": error.code, "message": str(error),
                          **({"file": error.name} if error.name else {})}), file=sys.stderr)
        return 1
    except Exception:
        # Avoid printing SDK exceptions, signed download URLs, proxy details, or credentials.
        print(json.dumps({"ok": False, "code": "ASR_PREPARE_FAILED",
                          "message": "Preparation failed; local model files were not intentionally removed."}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
