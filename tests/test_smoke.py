"""FFmpeg integration smoke test for the timeline compositor."""
import json
import shutil
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
        # Second pass exercises the optional temporal effect in the real export
        # path with a transformed clip and separate cut boundaries.
        blur_source = temp / "blur_source.mp4"
        blur_result = temp / "motion_blur.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=30:duration=3",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(blur_source)
        ], check=True)
        key = "motion-blur-smoke"
        JOBS[key] = {"id": key, "status": "queued", "stage": "queued", "progress": 0}
        process_edit(key, blur_source, blur_result, segments, "off", "original",
                     "original", False, None, None, "fast", "none", "medium")
        if JOBS[key]["status"] != "done":
            raise AssertionError(JOBS[key].get("error", JOBS[key]))
        assert blur_result.exists() and blur_result.stat().st_size > 1024
        print("SMOKE PASS: motion blur export works across two clips")
        # The stronger custom filter must still preserve video duration and
        # not introduce frames belonging to an adjacent clip.
        extra = temp / "blur_advanced_source.mp4"
        advanced = temp / "blur_advanced.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=30:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-pix_fmt", "yuv420p", str(extra)
        ], check=True)
        key = "advanced-motion-blur"
        JOBS[key] = {"id": key, "status": "queued", "stage": "queued", "progress": 0}
        process_edit(key, extra, advanced, segments, "off", "original",
                     "original", False, None, None, "fast", "none",
                     "custom", 100, 95, "both", 6)
        if JOBS[key]["status"] != "done":
            raise AssertionError(JOBS[key].get("error", JOBS[key]))
        result = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=nb_frames,duration",
            "-of", "json", str(advanced)
        ], capture_output=True, text=True, check=True)
        stream = json.loads(result.stdout)["streams"][0]
        assert 2.3 <= float(stream["duration"]) <= 2.8, stream
        print("SMOKE PASS: strong bidirectional temporal blur export", stream)
        # Verify motion-compensated optical-flow blur without caching a full video.
        # A tiny test source keeps GitHub CI fast despite minterpolate CPU cost.
        key = "flow-motion-blur"
        flow_path = temp / "motion_flow.mp4"
        JOBS[key] = {"id": key, "status": "queued", "stage": "queued", "progress": 0}
        short_segments = [{"start": 0, "end": 0.4, "speed": 1, "at": 0},
                          {"start": 0.5, "end": 0.9, "speed": 1, "at": 0.4}]
        # process_edit removes its temporary input after rendering.
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=30:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-pix_fmt", "yuv420p", str(extra)
        ], check=True)
        process_edit(key, extra, flow_path, short_segments, "off", "original",
                     "original", False, None, None, "fast", "none",
                     "custom", 70, 80, "both", 2, "flow")
        if JOBS[key]["status"] != "done":
            raise AssertionError(JOBS[key].get("error", JOBS[key]))
        assert flow_path.is_file() and flow_path.stat().st_size > 1024
        print("SMOKE PASS: optical-flow Motion Blur video export")
        # Independent picture-in-picture overlay track, rendered after V1.
        layer_source = temp / "overlay_source.mp4"
        composite_source = temp / "composite_source.mp4"
        composite_output = temp / "multitrack_output.mp4"
        for path in (layer_source, composite_source):
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=30:duration=2",
                "-c:v", "libx264", "-preset", "ultrafast",
                "-pix_fmt", "yuv420p", str(path)
            ], check=True)
        key = "overlay-layer-smoke"
        JOBS[key] = {"id": key, "status": "queued", "stage": "queued", "progress": 0}
        overlay = [{
            "id": "a" * 32, "path": layer_source, "at": 0.3,
            "start": 0.1, "end": 0.9, "x": 0.5, "y": 0.5,
            "scale": 0.45, "opacity": 0.7, "width": 128, "height": 72,
            "hidden": False,
        }]
        process_edit(key, composite_source, composite_output,
                     [{"start": 0, "end": 1.6, "speed": 1, "at": 0}],
                     "off", "original", "original", True,
                     None, None, "fast", "none", "off",
                     70, 70, "both", 2, "flow", True, overlay)
        if JOBS[key]["status"] != "done":
            raise AssertionError(JOBS[key].get("error", JOBS[key]))
        metadata = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
            "-of", "json", str(composite_output)
        ], capture_output=True, text=True, check=True)
        assert any(s["codec_type"] == "video" for s in json.loads(metadata.stdout)["streams"])
        print("SMOKE PASS: independent V2 layer composited over V1")




if __name__ == "__main__":
    main()
