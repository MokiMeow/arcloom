"""Run a real local FalkorDB in an existing x86-64 WSL distribution.

Windows development workaround when Docker Desktop's engine is unavailable.
Nothing is installed into WSL: pinned binaries and state live under data/wsl-graph.
Run configure.py first, then `python scripts/dev_graph.py start`.
Use `status` or `stop` to inspect or shut down this development instance.
This is a local development helper, not the supported production container.
"""

import argparse
import hashlib
import io
import json
import os
import shlex
import socket
import subprocess
import tarfile
import time
import urllib.request
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "data" / "wsl-graph"
DOWNLOADS = [
    (
        "https://files.pythonhosted.org/packages/2e/cf/d792cf46292f7756f96727916e77ebf9821371e22bff65ed8e90db6b80b9/falkordblite-0.10.0-cp313-cp313-manylinux_2_39_x86_64.whl",
        "7d52a3665f6de30cbffc5809a1c6d722492c95bf8dae4a7ee108ca58da939b25",
    ),
    (
        "https://deb.debian.org/debian/pool/main/g/glibc/libc6_2.41-12+deb13u4_amd64.deb",
        "967aa62605721081c3eb2a17650611a792aa802d76a6511d1840242623d204c9",
    ),
    (
        "https://deb.debian.org/debian/pool/main/g/gcc-14/libgcc-s1_14.2.0-19_amd64.deb",
        "3c71917b490d1a17aed43196a2787a256ecf060526cdb20216a74bedc061b150",
    ),
    (
        "https://deb.debian.org/debian/pool/main/g/gcc-14/libstdc++6_14.2.0-19_amd64.deb",
        "ab1fa05837aa7a92aae748fd07a18a35f7d18bb4a71c4724fe2bbf0e32089de0",
    ),
]


def settings():
    values = {}
    if (ROOT / ".env").is_file():
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and not key.lstrip().startswith("#"):
                values[key.strip()] = value.strip().strip("\"'")
    values.update({k: v for k, v in os.environ.items() if k.startswith("ARCLOOM_")})
    password = values.get("ARCLOOM_GRAPH_PASSWORD", "")
    port = int(values.get("ARCLOOM_GRAPH_PORT", "6379"))
    if not password or not 1 <= port <= 65535:
        raise SystemExit(
            "Generate .env with python scripts/configure.py before starting the graph."
        )
    if values.get("ARCLOOM_GRAPH_HOST", "127.0.0.1") not in {"localhost", "127.0.0.1"}:
        raise SystemExit("This helper only manages a graph on localhost.")
    return port, password


def read_response(stream):
    line = stream.readline()
    if not line:
        return None
    kind, value = line[:1], line[1:-2]
    if kind == b"-":
        raise RuntimeError(value.decode())
    if kind == b"*":
        return [read_response(stream) for _ in range(int(value))]
    if kind == b"$":
        length = int(value)
        return None if length < 0 else stream.read(length + 2)[:-2]
    return value


def command(port, password, *parts):
    def send(stream, words):
        words = [str(word).encode() for word in words]
        stream.write(
            b"*"
            + str(len(words)).encode()
            + b"\r\n"
            + b"".join(b"$" + str(len(word)).encode() + b"\r\n" + word + b"\r\n" for word in words)
        )
        stream.flush()
        return read_response(stream)

    with (
        socket.create_connection(("127.0.0.1", port), timeout=3) as connection,
        connection.makefile("rwb") as stream,
    ):
        send(stream, ("AUTH", password))
        return send(stream, parts)


def instance_identity(port, password):
    info = command(port, password, "INFO", "server").decode()
    fields = dict(line.split(":", 1) for line in info.splitlines() if ":" in line)
    config = command(port, password, "CONFIG", "GET", "dir", "pidfile")
    config = dict(zip(config[::2], config[1::2], strict=True))
    return {
        "port": port,
        "run_id": fields["run_id"],
        "process_id": fields["process_id"],
        "config_file": fields["config_file"],
        "directory": config[b"dir"].decode(),
        "pidfile": config[b"pidfile"].decode(),
    }


def ownership_file(port):
    return RUNTIME / f"instance-{port}.json"


def owns_instance(port, password):
    try:
        record = json.loads(ownership_file(port).read_text(encoding="utf-8"))
        saved = record["identity"]
        current = instance_identity(port, password)
        pid = (RUNTIME / "graph.pid").read_text(encoding="utf-8").strip()
        return (
            record["runtime"] == str(RUNTIME.resolve())
            and saved == current
            and bool(saved["run_id"])
            and saved["process_id"] == pid
        )
    except (OSError, RuntimeError, ValueError, KeyError, TypeError):
        return False


def prepare():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    for url, expected in DOWNLOADS:
        path = RUNTIME / url.rsplit("/", 1)[1]
        if not path.exists():
            print("Downloading", path.name)
            with urllib.request.urlopen(url, timeout=60) as response:
                path.write_bytes(response.read())
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise SystemExit(f"Checksum mismatch: {path}. Remove that file and retry.")
        if path.suffix == ".whl":
            with zipfile.ZipFile(path) as archive:
                archive.extractall(RUNTIME / "falkordb")
        else:
            # Debian packages are ar archives containing a compressed data tar.
            raw, position = path.read_bytes(), 8
            while position + 60 <= len(raw):
                header = raw[position : position + 60]
                name, size = header[:16].decode().strip().rstrip("/"), int(header[48:58])
                position += 60
                if name.startswith("data.tar"):
                    with tarfile.open(
                        fileobj=io.BytesIO(raw[position : position + size])
                    ) as archive:
                        archive.extractall(RUNTIME / "glibc", filter="data")
                position += size + size % 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "status", "stop"], default="start", nargs="?")
    parser.add_argument("--distribution", default="docker-desktop")
    args = parser.parse_args()
    port, password = settings()
    try:
        running = command(port, password, "PING") == b"PONG"
    except OSError:
        running = False
    if running:
        # Read-only capability check: a Redis PING alone does not prove FalkorDB.
        try:
            if not isinstance(command(port, password, "GRAPH.LIST"), list):
                raise RuntimeError("Invalid graph capability response")
        except RuntimeError as exc:
            raise SystemExit(
                "The configured port has a Redis server without FalkorDB support; leaving it running."
            ) from exc
    owned = running and owns_instance(port, password)
    if args.action == "status":
        state = (
            ("managed instance running" if owned else "externally managed graph running")
            if running
            else "stopped"
        )
        print(f"Local graph on 127.0.0.1:{port}: {state}")
        return
    if args.action == "stop":
        if running:
            if not owned:
                raise SystemExit(
                    "Refusing to stop an externally managed graph: instance ownership is unverified."
                )
            command(port, password, "SHUTDOWN", "SAVE")
            ownership_file(port).unlink(missing_ok=True)
        print("Local graph stopped.")
        return
    if running:
        management = "Managed instance" if owned else "Externally managed graph"
        print(f"{management} already running on 127.0.0.1:{port}; leaving it unchanged.")
        return
    if os.name != "nt":
        raise SystemExit(
            "Use FalkorDBLite or Docker directly on Linux/macOS; this helper is for Windows."
        )
    result = subprocess.run(
        ["wsl", "-d", args.distribution, "--", "uname", "-m"],
        text=True,
        capture_output=True,
        check=True,
        timeout=30,
    )
    if result.stdout.strip() != "x86_64":
        raise SystemExit("This helper requires an existing x86-64 WSL distribution.")
    prepare()
    mount = "/mnt/host" if args.distribution == "docker-desktop" else "/mnt"

    def linux(path):
        return f"{mount}/{path.drive[0].lower()}{path.as_posix()[2:]}"

    library = RUNTIME / "glibc" / "usr" / "lib" / "x86_64-linux-gnu"
    loader = library / "ld-linux-x86-64.so.2"
    server = RUNTIME / "falkordb" / "redislite" / "bin" / "redis-server"
    module = server.with_name("falkordb.so")
    database = RUNTIME / "database"
    database.mkdir(exist_ok=True)
    config = RUNTIME / "redis.conf"
    config.write_text(
        "bind 127.0.0.1\nprotected-mode yes\ndaemonize yes\nappendonly yes\n"
        f"port {port}\nrequirepass {json.dumps(password)}\n"
        f"dir {json.dumps(linux(database))}\n"
        f"logfile {json.dumps(linux(RUNTIME / 'graph.log'))}\n"
        f"pidfile {json.dumps(linux(RUNTIME / 'graph.pid'))}\n"
        f"loadmodule {json.dumps(linux(module))}\n",
        encoding="utf-8",
    )
    config.chmod(0o600)
    launcher = RUNTIME / "start.sh"
    libraries = linux(library) + ":" + linux(RUNTIME / "falkordb" / "falkordblite.libs")
    launcher.write_text(
        "#!/bin/sh\nset -eu\nexport LC_ALL=C\n"
        + "chmod +x "
        + shlex.quote(linux(loader))
        + " "
        + shlex.quote(linux(server))
        + "\n"
        + "exec "
        + " ".join(
            map(
                shlex.quote,
                [linux(loader), "--library-path", libraries, linux(server), linux(config)],
            )
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    subprocess.run(
        ["wsl", "-d", args.distribution, "--", "sh", linux(launcher)], check=True, timeout=30
    )
    for _ in range(30):
        try:
            probe = "arcloom_bootstrap_" + uuid.uuid4().hex
            command(port, password, "GRAPH.QUERY", probe, "CREATE (:BootstrapProbe) RETURN 1")
            command(port, password, "GRAPH.DELETE", probe)
            identity = instance_identity(port, password)
            if (
                identity["config_file"] != linux(config)
                or identity["directory"] != linux(database)
                or identity["pidfile"] != linux(RUNTIME / "graph.pid")
            ):
                raise RuntimeError(
                    "The graph on this port was not launched with this helper's configuration."
                )
            ownership_file(port).write_text(
                json.dumps({"runtime": str(RUNTIME.resolve()), "identity": identity}),
                encoding="utf-8",
            )
            print(f"Real FalkorDB ready on 127.0.0.1:{port}. Data: {database}")
            return
        except (OSError, RuntimeError):
            time.sleep(0.5)
    raise SystemExit(f"Graph startup failed; inspect {RUNTIME / 'graph.log'}.")


if __name__ == "__main__":
    main()
