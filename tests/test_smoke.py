"""FFmpeg integration smoke test for the timeline compositor."""
import json
import sys
import subprocess
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import JOBS, process_edit


def main():
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        source = temp / "source.mp4"
        result = temp / "edited.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=30:duration=3",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(source)
        ], check=True)
        key = "smoke"
        JOBS[key] = {"id": key, "status": "queued", "stage": "queued", "progress": 0}
        segments = [
            {"start": 0, "end": 1, "speed": 1, "at": 0,
             "transform": {"x": 64, "y": 36, "width": 128, "height": 72, "rotation": 0}},
            {"start": 1, "end": 2, "speed": 1, "at": 1.5,
             "transform": {"x": 70, "y": 36, "width": 100, "height": 60, "rotation": 12}},
        ]
        process_edit(key, source, result, segments, "off", "original", "original", False)
        if JOBS[key]["status"] != "done":
            raise AssertionError(JOBS[key].get("error", JOBS[key]))
        check = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1", str(result)
        ], capture_output=True, text=True, check=True)
        duration = float(check.stdout.strip())
        assert 2.3 <= duration <= 2.8, duration
        print("SMOKE PASS: exported video with trim, gap, audio and canvas transform", duration)


if __name__ == "__main__":
    main()
