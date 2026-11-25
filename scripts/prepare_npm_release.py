"""Prepare and inspect an exact npm tarball. This script never publishes or stages."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {
    "format-inspector-lite": ("./contract", "format-inspector-contract"),
    "form-path-explainer": ("./regression", "form-path-regression"),
}
META = {"package.json", "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md"}
MAX_ARCHIVE = 256 * 1024
MAX_CONTENT = 2 * 1024 * 1024
SECRET_PATTERNS = (
    rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    rb"\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{30,}\b",
    rb"\bgithub_pat_[A-Za-z0-9_]{60,}\b",
    rb"\bnpm_[A-Za-z0-9]{30,}\b",
)
LIFECYCLE = {"prepublish", "prepublishOnly", "prepack", "postpack", "prepare",
             "preinstall", "install", "postinstall", "publish", "postpublish",
             "prestage", "poststage"}


def run(args, *, cwd=ROOT, capture=True, timeout=120, ok=(0,)):
    p = subprocess.run([str(a) for a in args], cwd=cwd, capture_output=capture,
                       timeout=timeout, check=False)
    if p.returncode not in ok:
        # Do not print subprocess stderr, which can contain local paths or credentials.
        raise RuntimeError(f"command failed: {Path(str(args[0])).name}; exit {p.returncode}")
    return p


def npm_command():
    # Optional explicit npm CLI is useful for matching the reviewed CI npm
    # version in an isolated local preparation; CI uses the normal executable.
    cli = os.environ.get("REVIEW_NPM_CLI")
    if cli:
        return ["node", str(Path(cli).resolve(strict=True))]
    executable = shutil.which("npm")
    if not executable:
        raise RuntimeError("npm executable unavailable")
    return [executable]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify_metadata(p, name, version):
    if p.get("name") != name or p.get("version") != version or p.get("private"):
        raise ValueError("package identity mismatch")
    if p.get("repository", {}).get("url") != f"git+https://github.com/deepstriker88/{name}.git":
        raise ValueError("repository identity mismatch")
    if p.get("license") != "MIT" or p.get("type") != "module":
        raise ValueError("unexpected license or module type")
    if any(p.get(k) for k in ("dependencies", "optionalDependencies", "bundledDependencies",
                              "bundleDependencies", "peerDependencies")):
        raise ValueError("unexpected runtime dependency")
    if set(p.get("scripts", {})) & LIFECYCLE:
        raise ValueError("unexpected lifecycle hook")
    feature, command = PACKAGES[name]
    if feature not in p.get("exports", {}) or command not in p.get("bin", {}) or name not in p.get("bin", {}):
        raise ValueError("required feature export or CLI missing")
    if set(p.get("files", [])) != {"src", "bin", "README.md", "CHANGELOG.md", "SECURITY.md", "LICENSE"}:
        raise ValueError("unexpected publish allowlist")


def expected_files():
    names = run(["git", "ls-files", "-z", "--", "src", "bin", *sorted(META)]).stdout.decode().split("\0")
    files = set(filter(None, names))
    if not META <= files:
        raise ValueError("required tracked metadata missing")
    for name in files:
        if name in META:
            continue
        path = PurePosixPath(name)
        if (len(path.parts) != 2 or path.parts[0] not in ("src", "bin")
                or not re.fullmatch(r"[a-zA-Z0-9._-]+\.(?:js|mjs|ts|json)", path.name)
                or path.name.startswith(".")):
            raise ValueError("unexpected tracked package file")
    return files


def inspect_archive(archive, expected, name, version):
    if not archive.is_file() or archive.is_symlink() or archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError("invalid archive size or type")
    records = {}
    total = 0
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            if not member.name.startswith("package/") or not member.isfile():
                raise ValueError("unexpected tar member type")
            path = member.name.removeprefix("package/")
            if path not in expected or path in records or member.size < 0:
                raise ValueError("unexpected or duplicate tar member")
            total += member.size
            if total > MAX_CONTENT:
                raise ValueError("archive content limit exceeded")
            data = tar.extractfile(member).read()
            # npm's pack may normalize package.json; compare its parsed value,
            # while all other published files must match reviewed source bytes.
            source = (ROOT / path).read_bytes()
            if path == "package.json":
                verify_metadata(json.loads(data), name, version)
                if json.loads(data) != json.loads(source):
                    raise ValueError("packed package metadata differs from source")
            elif data != source:
                raise ValueError("packed file differs from source")
            if any(re.search(pattern, data) for pattern in SECRET_PATTERNS):
                raise ValueError("possible credential in package")
            records[path] = {"bytes": len(data), "sha256": sha(data)}
    if set(records) != expected:
        raise ValueError("archive omissions")
    return records


def smoke(npm, archive, name):
    with tempfile.TemporaryDirectory(prefix="npm-release-consumer-") as tmp:
        root = Path(tmp)
        (root / "package.json").write_text('{"private":true,"type":"module"}\n')
        run([*npm, "install", "--offline", "--ignore-scripts", "--no-audit",
             "--no-fund", str(archive)], cwd=root)
        _, feature_cli = PACKAGES[name]
        for command in (name, feature_cli):
            bin_path = root / "node_modules" / ".bin" / command
            run([bin_path, "--help"], cwd=root, timeout=15)
        if name == "format-inspector-lite":
            run(["node", "--input-type=module", "-e",
                 'import {inspectFormat} from "format-inspector-lite";'
                 'import {auditContract} from "format-inspector-lite/contract";'
                 'if(!inspectFormat("email","user@example.com").valid||'
                 '!auditContract("id\\n1",JSON.stringify({version:1,columns:[{name:"id"}]})).valid)process.exit(1)'],
                cwd=root, timeout=15)
            (root / "rules.json").write_text('{"version":1,"columns":[{"name":"id","unique":true}]}')
            (root / "good.csv").write_text("id\none\ntwo\n")
            (root / "bad.csv").write_text("id\nPRIVATE_VALUE\nPRIVATE_VALUE\n")
            cmd = [root / "node_modules/.bin" / feature_cli, "--profile", "rules.json", "--input"]
            good = run([*cmd, "good.csv"], cwd=root, timeout=15)
            bad = run([*cmd, "bad.csv", "--previous", "good.csv"], cwd=root, timeout=15, ok=(1,))
            if not json.loads(good.stdout)["valid"] or json.loads(bad.stdout)["valid"] or b"PRIVATE_VALUE" in bad.stdout:
                raise ValueError("installed CSV comparison smoke mismatch")
        else:
            run(["node", "--input-type=module", "-e",
                 'import {compareFormFixtures} from "form-path-explainer/regression";'
                 'if(!compareFormFixtures("[1]","{\\"type\\":\\"number\\"}","{\\"type\\":\\"number\\"}").comparable)process.exit(1)'],
                cwd=root, timeout=15)
            (root / "before.json").write_text('{"type":"string","minLength":1}')
            (root / "after.json").write_text('{"type":"string","minLength":2}')
            (root / "fixtures.json").write_text('["a","ab","PRIVATE_VALUE"]')
            cli = root / "node_modules/.bin" / feature_cli
            same = run([cli, "before.json", "before.json", "fixtures.json"], cwd=root, timeout=15)
            changed = run([cli, "before.json", "after.json", "fixtures.json"], cwd=root, timeout=15, ok=(1,))
            if json.loads(same.stdout)["hasNewRejections"] or json.loads(changed.stdout)["counts"]["newlyRejected"] != 1 or b"PRIVATE_VALUE" in changed.stdout:
                raise ValueError("installed form comparison smoke mismatch")


def prepare(expected_sha, version, output):
    if not re.fullmatch(r"[0-9a-f]{40}", expected_sha) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("exact SHA and stable version required")
    if run(["git", "rev-parse", "HEAD"]).stdout.decode().strip() != expected_sha:
        raise ValueError("checkout SHA mismatch")
    if run(["git", "status", "--porcelain", "--untracked-files=all"]).stdout:
        raise ValueError("checkout must be clean")
    output = Path(output).resolve()
    if output == ROOT or ROOT in output.parents or output.exists():
        raise ValueError("choose a new output directory outside the checkout")
    meta = json.loads((ROOT / "package.json").read_bytes())
    name = meta.get("name")
    if name not in PACKAGES:
        raise ValueError("unsupported product")
    verify_metadata(meta, name, version)
    expected = expected_files()
    npm = npm_command()
    run([*npm, "test"], capture=False)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    packed = run([*npm, "pack", "--offline", "--ignore-scripts", "--json",
                  "--pack-destination", str(output)])
    rows = json.loads(packed.stdout)
    if not isinstance(rows, list) or len(rows) != 1:
        raise ValueError("unexpected npm pack output")
    row = rows[0]
    filename = f"{name}-{version}.tgz"
    if row.get("filename") != filename or row.get("name") != name or row.get("version") != version:
        raise ValueError("archive identity mismatch")
    archive = output / filename
    records = inspect_archive(archive, expected, name, version)
    data = archive.read_bytes()
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if row.get("integrity") != integrity or row.get("size") != len(data):
        raise ValueError("npm integrity metadata mismatch")
    smoke(npm, archive, name)
    receipt = {"version": 1, "package": name, "package_version": version, "source_sha": expected_sha,
               "archive": filename, "bytes": len(data), "sha256": sha(data), "integrity": integrity,
               "node": run(["node", "--version"]).stdout.decode().strip(),
               "npm": run([*npm, "--version"]).stdout.decode().strip(),
               "core_tests": "passed", "installed_cli_smoke": "passed", "files": records,
               "published": False}
    if run(["git", "status", "--porcelain", "--untracked-files=all"]).stdout:
        raise ValueError("checkout changed during preparation")
    with (output / "release-receipt.json").open("x") as f:
        json.dump(receipt, f, indent=2, sort_keys=True)
        f.write("\n")
    print(json.dumps({k: v for k, v in receipt.items() if k != "files"}))
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        prepare(args.expected_sha, args.version, args.output)
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired, tarfile.TarError) as error:
        raise SystemExit(f"Release preparation refused: {type(error).__name__}: {error}")
