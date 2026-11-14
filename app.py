from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
OUTPUTS = DATA / "outputs"
for directory in (UPLOADS, OUTPUTS):
    directory.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 1024 * 1024 * 1024
ALLOWED_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
PROCESS_LOCK = threading.Lock()
app = FastAPI(title="Video Enhancer", version="1.0.0")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def find_binary(name: str) -> str:
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f"{name} não foi encontrado. Instale o FFmpeg e adicione ao PATH.")
    return found


def probe_video(path: Path) -> dict:
    args = [find_binary("ffprobe"), "-v", "error", "-show_entries",
            "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", str(path)]
    completed = subprocess.run(args, capture_output=True, text=True, timeout=40)
    if completed.returncode:
        raise ValueError("Vídeo inválido ou incompatível com FFmpeg.")
    info = json.loads(completed.stdout)
    stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if not stream:
        raise ValueError("O arquivo não contém uma faixa de vídeo.")
    duration = float(info.get("format", {}).get("duration") or 0)
    if not 0 < duration < 24 * 60 * 60:
        raise ValueError("Duração inválida ou não suportada.")
    return {"duration": duration, "width": stream.get("width"), "height": stream.get("height")}


def make_filters(quality: str, resolution: str, fps: str) -> list[str]:
    filters = []
    if quality == "balanced":
        filters += ["hqdn3d=1.5:1.5:3:3", "unsharp=5:5:0.55:3:3:0.0"]
    elif quality == "strong":
        filters += ["hqdn3d=3:2.5:5:4", "eq=contrast=1.025:saturation=1.06", "unsharp=5:5:0.8:3:3:0.1"]
    if resolution != "original":
        height = int(resolution)
        # Preserve proportions and avoid forcing landscape/portrait video into a fixed width.
        filters.append(f"scale=-2:{height}:flags=lanczos")
        filters.append("setsar=1")
    if fps == "60":
        filters.append("minterpolate=fps=60:mi_mode=mci:mc_mode=obmc:me_mode=bidir:vsbmc=1")
    return filters


def process(job_id: str, source: Path, destination: Path, quality: str, resolution: str, fps: str):
    with PROCESS_LOCK:
        with JOBS_LOCK:
            job = JOBS[job_id]
            job["status"] = "processing"
            job["stage"] = "Processando vídeo"
        try:
            meta = probe_video(source)
            filters = make_filters(quality, resolution, fps)
            cmd = [find_binary("ffmpeg"), "-hide_banner", "-nostdin", "-y", "-i", str(source)]
            if filters:
                cmd += ["-vf", ",".join(filters)]
            cmd += ["-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast",
                    "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(destination)]
            with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, bufsize=1) as proc:
                # Drain stderr concurrently to avoid a full pipe blocking FFmpeg.
                stderr_lines: list[str] = []
                def read_stderr():
                    for line in proc.stderr:
                        stderr_lines.append(line[-400:])
                        if len(stderr_lines) > 50:
                            del stderr_lines[:25]
                reader = threading.Thread(target=read_stderr, daemon=True)
                reader.start()
                for line in proc.stdout:
                    key, _, val = line.strip().partition("=")
                    if key in ("out_time_us", "out_time_ms"):
                        try:
                            pct = min(99, max(0, round(float(val) / 1_000_000 / meta["duration"] * 100)))
                            with JOBS_LOCK:
                                JOBS[job_id]["progress"] = pct
                        except (ValueError, ZeroDivisionError):
                            pass
                code = proc.wait()
                reader.join(timeout=1)
                if code != 0:
                    raise RuntimeError("O FFmpeg falhou: " + "".join(stderr_lines)[-900:])
            with JOBS_LOCK:
                JOBS[job_id].update(status="done", stage="Concluído", progress=100,
                                    download=f"/api/jobs/{job_id}/download")
        except Exception as exc:
            destination.unlink(missing_ok=True)
            with JOBS_LOCK:
                JOBS[job_id].update(status="error", stage="Falha no processamento",
                                    error=str(exc)[:1000])
        finally:
            source.unlink(missing_ok=True)


@app.get("/")
def homepage():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": bool(shutil.which("ffmpeg")),
            "ffprobe": bool(shutil.which("ffprobe"))}


@app.post("/api/jobs", status_code=202)
async def create_job(file: UploadFile = File(...), quality: str = Form("balanced"),
                     resolution: str = Form("original"), fps: str = Form("original")):
    if quality not in {"off", "balanced", "strong"}:
        raise HTTPException(400, "Modo de melhoria inválido")
    if resolution not in {"original", "720", "1080", "2160"}:
        raise HTTPException(400, "Resolução inválida")
    if fps not in {"original", "60"}:
        raise HTTPException(400, "FPS inválido")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "Formato não suportado")
    try:
        find_binary("ffmpeg")
        find_binary("ffprobe")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc

    job_id = uuid.uuid4().hex
    source = UPLOADS / f"{job_id}{ext}"
    dest = OUTPUTS / f"{job_id}.mp4"
    count = 0
    try:
        with source.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                count += len(chunk)
                if count > MAX_BYTES:
                    raise HTTPException(413, "Limite de 1 GB por vídeo")
                output.write(chunk)
        if count == 0:
            raise HTTPException(400, "Arquivo vazio")
        # Validate before queuing, so errors are surfaced immediately.
        await asyncio.to_thread(probe_video, source)
    except Exception as exc:
        source.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(400, str(exc)) from exc
    finally:
        await file.close()

    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "status": "queued", "stage": "Na fila",
                        "progress": 0, "error": None, "download": None, "created": time.time()}
    threading.Thread(target=process, args=(job_id, source, dest, quality, resolution, fps),
                     daemon=True).start()
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def status(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "Tarefa não encontrada")
        return dict(job)


@app.get("/api/jobs/{job_id}/download")
def download(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or job["status"] != "done":
            raise HTTPException(404, "Resultado indisponível")
    path = OUTPUTS / f"{job_id}.mp4"
    if not path.is_file():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(path, media_type="video/mp4", filename="video-enhanced.mp4")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
