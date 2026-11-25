import hashlib
import json
import os
import re
import struct
import subprocess
import sys

RESOURCES_DIR = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "antigravity", "resources")
ASAR_PATH = os.path.join(RESOURCES_DIR, "app.asar")
STAGED_PATH = os.path.join(RESOURCES_DIR, "app.asar.mcp-panel.staged")
HERE = os.path.dirname(os.path.abspath(__file__))

PRESERVED_MARKERS = {
    "ascii_wallpapers": "// BEGIN LOCAL ASCII WALLPAPERS",
    "fast_switch": "// BEGIN LOCAL FAST SWITCH",
}
MCP_START = "// BEGIN LOCAL MCP PANEL"
MCP_END = "// END LOCAL MCP PANEL"


def read_asar(path: str):
    with open(path, "rb") as f:
        raw = f.read()
    u = struct.unpack("<IIII", raw[:16])
    header_pickle_size = u[1]
    json_len = u[3]
    base = 8 + header_pickle_size
    header = json.loads(raw[16 : 16 + json_len].decode("utf-8"))
    return raw, base, header


def compute_integrity(data: bytes) -> dict:
    block_size = 4194304
    full_hash = hashlib.sha256(data).hexdigest()
    blocks = (
        [hashlib.sha256(data[i : i + block_size]).hexdigest() for i in range(0, len(data), block_size)]
        if data
        else [full_hash]
    )
    return {
        "algorithm": "SHA256",
        "hash": full_hash,
        "blockSize": block_size,
        "blocks": blocks,
    }


def strip_mcp_block(text: str) -> str:
    return (
        re.sub(
            r"\n?" + re.escape(MCP_START) + r"[\s\S]*?" + re.escape(MCP_END) + r"\n?",
            "\n",
            text,
        ).rstrip()
        + "\n"
    )


def apply_block(text: str, patch_text: str) -> str:
    return strip_mcp_block(text).rstrip() + "\n\n" + patch_text.strip() + "\n"


def repack_asar(raw: bytes, base: int, header: dict, overrides: dict[str, bytes], out_path: str):
    blobs = []
    offset = 0

    def walk_build(node, prefix=""):
        nonlocal offset
        if "files" in node:
            new_files = {}
            for k, v in node["files"].items():
                p = f"{prefix}/{k}" if prefix else k
                new_files[k] = walk_build(v, p)
            return {"files": new_files}
        if node.get("unpacked"):
            return dict(node)
        if prefix in overrides:
            content = overrides[prefix]
        else:
            old_off = base + int(node["offset"])
            content = raw[old_off : old_off + int(node["size"])]
        entry = {
            "size": len(content),
            "offset": str(offset),
            "integrity": compute_integrity(content),
        }
        if node.get("executable"):
            entry["executable"] = True
        blobs.append(content)
        offset += len(content)
        return entry

    new_header = walk_build(header)
    header_bytes = json.dumps(new_header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_len = len(header_bytes)
    pad = (4 - (json_len % 4)) % 4
    header_pickle_size = 8 + json_len + pad
    prefix = struct.pack("<IIII", 4, header_pickle_size, header_pickle_size - 4, json_len)
    padded_header = header_bytes + (b"\x00" * pad)

    tmp_path = out_path + ".tmp"
    with open(tmp_path, "wb") as f:
        f.write(prefix)
        f.write(padded_header)
        for b in blobs:
            f.write(b)
    os.replace(tmp_path, out_path)


def verify_staged(staged_path: str, required_markers: dict[str, list[str]]):
    raw, base, header = read_asar(staged_path)
    for rel in ("dist/main.js", "dist/preload.js"):
        node = header
        for part in rel.split("/"):
            node = node["files"][part]
        off = base + int(node["offset"])
        content = raw[off : off + int(node["size"])]
        expected = node["integrity"]["hash"]
        actual = hashlib.sha256(content).hexdigest()
        if expected != actual:
            raise RuntimeError(f"Integrity mismatch on {rel}")
        tmp_js = os.path.join(HERE, f"_verify_{os.path.basename(rel)}")
        try:
            with open(tmp_js, "wb") as f:
                f.write(content)
            subprocess.run(["node", "--check", tmp_js], check=True)
        finally:
            if os.path.exists(tmp_js):
                os.remove(tmp_js)
        text = content.decode("utf-8")
        for marker in required_markers.get(rel, []):
            if marker not in text:
                raise RuntimeError(f"Lost existing marker {marker} in {rel}")
        if MCP_START not in text or MCP_END not in text:
            raise RuntimeError(f"Missing mcp-panel marker in {rel}")


def main():
    with open(os.path.join(HERE, "main_patch.js"), "r", encoding="utf-8") as f:
        main_patch = f.read()
    with open(os.path.join(HERE, "preload_patch.js"), "r", encoding="utf-8") as f:
        preload_patch = f.read()

    raw, base, header = read_asar(ASAR_PATH)

    def extract(rel):
        node = header
        for part in rel.split("/"):
            node = node["files"][part]
        off = base + int(node["offset"])
        return raw[off : off + int(node["size"])].decode("utf-8")

    orig_main = extract("dist/main.js")
    orig_preload = extract("dist/preload.js")
    required_markers = {
        "dist/main.js": [m for m in PRESERVED_MARKERS.values() if m in orig_main],
        "dist/preload.js": [m for m in PRESERVED_MARKERS.values() if m in orig_preload],
    }

    new_main = apply_block(orig_main, main_patch).encode("utf-8")
    new_preload = apply_block(orig_preload, preload_patch).encode("utf-8")

    out_path = STAGED_PATH if "--stage" in sys.argv else ASAR_PATH
    repack_asar(raw, base, header, {"dist/main.js": new_main, "dist/preload.js": new_preload}, out_path)
    verify_staged(out_path, required_markers)
    print("OK:", out_path)


if __name__ == "__main__":
    main()
