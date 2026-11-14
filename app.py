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



@app.get("/editor")
def editor_page():
    return FileResponse(ROOT / "static" / "editor.html")


def probe_audio(path: Path) -> bool:
    result = subprocess.run(
        [find_binary("ffprobe"), "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=40)
    return result.returncode == 0 and bool(result.stdout.strip())


def process_edit(job_id: str, source: Path, destination: Path, segments: list[dict],
                 quality: str, resolution: str, fps: str, muted: bool):
    with PROCESS_LOCK:
        with JOBS_LOCK:
            JOBS[job_id].update(status="processing", stage="Renderizando edição")
        try:
            duration = sum((c["end"] - c["start"]) / c["speed"] for c in segments)
            has_audio = probe_audio(source) and not muted
            import math
            meta = probe_video(source)
            comp_w = int(meta["width"]) // 2 * 2
            comp_h = int(meta["height"]) // 2 * 2
            rate = subprocess.run(
                [find_binary("ffprobe"), "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=avg_frame_rate", "-of", "default=nokey=1:noprint_wrappers=1", str(source)],
                capture_output=True, text=True, timeout=40)
            try:
                n, d = rate.stdout.strip().split("/")
                base_fps = max(1, min(60, float(n) / float(d)))
            except (ValueError, ZeroDivisionError):
                base_fps = 30.0
            graph = []
            for i, c in enumerate(segments):
                start, end, speed = c["start"], c["end"], c["speed"]

                chain = (f"[0:v:0]trim=start={start:.5f}:end={end:.5f},"
                         f"setpts=(PTS-STARTPTS)/{speed:.5f},"
                         f"fps={base_fps:.4f},setsar=1")
                t = c.get("transform")
                if t:
                    w = max(2, int(round(t["width"] / 2) * 2))
                    h = max(2, int(round(t["height"] / 2) * 2))
                    angle = t["rotation"] * math.pi / 180
                    # Frame center is t.x/t.y in composition pixels. Rotation happens around
                    # the scaled video's center; overlay positions the rotated bounds.
                    chain += (f",scale={w}:{h}:flags=lanczos,format=rgba,"
                              f"rotate={angle:.9f}:ow=rotw({angle:.9f}):oh=roth({angle:.9f}):c=none[foreground{i}]")
                    graph.append(chain)
                    graph.append(f"color=c=black:s={comp_w}x{comp_h}:r={base_fps:.4f}:d={(end-start)/speed:.6f}[background{i}]")
                    x = t["x"] - comp_w / 2
                    y = t["y"] - comp_h / 2
                    graph.append(f"[background{i}][foreground{i}]overlay=x=(W-w)/2+({x:.5f}):y=(H-h)/2+({y:.5f}):shortest=1:format=auto,format=yuv420p[v{i}]")
                else:
                    graph.append(chain + f",format=yuv420p[v{i}]")
                if has_audio:
                    graph.append(
                        f"[0:a:0]atrim=start={start:.5f}:end={end:.5f},"
                        f"asetpts=PTS-STARTPTS,atempo={speed:.5f},"
                        f"aresample=async=1:first_pts=0[a{i}]")
            if has_audio:
                inputs = "".join(f"[v{i}][a{i}]" for i in range(len(segments)))
                graph.append(f"{inputs}concat=n={len(segments)}:v=1:a=1[vcat][aout]")
            else:
                inputs = "".join(f"[v{i}]" for i in range(len(segments)))
                graph.append(f"{inputs}concat=n={len(segments)}:v=1:a=0[vcat]")
            enhancements = make_filters(quality, resolution, fps)
            if enhancements:
                graph.append("[vcat]" + ",".join(enhancements) + "[vout]")
                video_map = "[vout]"
            else:
                video_map = "[vcat]"
            cmd = [find_binary("ffmpeg"), "-hide_banner", "-nostdin", "-y",
                   "-i", str(source), "-filter_complex", ";".join(graph),
                   "-map", video_map]
            if has_audio:
                cmd += ["-map", "[aout]"]
            cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
                    "-pix_fmt", "yuv420p"]
            if has_audio:
                cmd += ["-c:a", "aac", "-b:a", "192k"]
            cmd += ["-movflags", "+faststart", "-progress", "pipe:1", "-nostats",
                    str(destination)]
            with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, bufsize=1) as proc:
                errors = []
                def drain():
                    for line in proc.stderr:
                        errors.append(line[-400:])
                        if len(errors) > 70:
                            del errors[:30]
                reader = threading.Thread(target=drain, daemon=True)
                reader.start()
                for line in proc.stdout:
                    key, _, val = line.strip().partition("=")
                    if key in ("out_time_us", "out_time_ms"):
                        try:
                            percent = min(99, max(0, round(float(val) / 1_000_000 / duration * 100)))
                            with JOBS_LOCK:
                                JOBS[job_id]["progress"] = percent
                        except (ValueError, ZeroDivisionError):
                            pass
                code = proc.wait()
                reader.join(timeout=1)
                if code:
                    raise RuntimeError("FFmpeg: " + "".join(errors)[-1000:])
            with JOBS_LOCK:
                JOBS[job_id].update(status="done", stage="Concluído", progress=100,
                                    download=f"/api/jobs/{job_id}/download")
        except Exception as exc:
            destination.unlink(missing_ok=True)
            with JOBS_LOCK:
                JOBS[job_id].update(status="error", stage="Erro na exportação", error=str(exc)[:1000])
        finally:
            source.unlink(missing_ok=True)


@app.post("/api/editor/export", status_code=202)
async def editor_export(file: UploadFile = File(...), clips: str = Form(...),
                        quality: str = Form("balanced"), resolution: str = Form("1080"),
                        fps: str = Form("original"), mute: bool = Form(False)):
    import math
    if quality not in {"off", "balanced", "strong"} or resolution not in {"original", "720", "1080", "2160"} or fps not in {"original", "60"}:
        raise HTTPException(400, "Configuração inválida")
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXT:
        raise HTTPException(400, "Formato de vídeo inválido")
    try:
        find_binary("ffmpeg")
        find_binary("ffprobe")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    try:
        segments = json.loads(clips)
        if not isinstance(segments, list) or not 1 <= len(segments) <= 100:
            raise ValueError("Use entre 1 e 100 trechos")
        for seg in segments:
            if not isinstance(seg, dict):
                raise ValueError("Trecho inválido")
            start, end, speed = (float(seg[k]) for k in ("start", "end", "speed"))
            if not all(map(math.isfinite, (start, end, speed))) or start < 0 or end - start < 0.08 or speed not in (0.5, 1, 1.5, 2):
                raise ValueError("Tempos ou velocidade inválidos")
            seg.update(start=start, end=end, speed=speed)
            transform = seg.get("transform")
            if transform is not None:
                if not isinstance(transform, dict):
                    raise ValueError("Transformação inválida")
                vals = {k: float(transform[k]) for k in ("x", "y", "width", "height", "rotation")}
                if not all(map(math.isfinite, vals.values())) or not 2 <= vals["width"] <= 16000 or not 2 <= vals["height"] <= 16000 or not -36000 <= vals["x"] <= 36000 or not -36000 <= vals["y"] <= 36000 or abs(vals["rotation"]) > 36000:
                    raise ValueError("Dimensões ou posição fora do limite")
                seg["transform"] = vals
    except (ValueError, KeyError, TypeError, OverflowError) as exc:
        raise HTTPException(400, f"Timeline inválida: {exc}") from exc

    job_id = uuid.uuid4().hex
    source = UPLOADS / f"{job_id}{extension}"
    destination = OUTPUTS / f"{job_id}.mp4"
    size = 0
    try:
        with source.open("wb") as dest:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Arquivo acima de 1 GB")
                dest.write(chunk)
        if not size:
            raise HTTPException(400, "Arquivo vazio")
        meta = await asyncio.to_thread(probe_video, source)
        if any(c["end"] > meta["duration"] + 0.1 for c in segments):
            raise HTTPException(400, "Trecho ultrapassa a duração do vídeo")
        if sum((c["end"]-c["start"])/c["speed"] for c in segments) > 24*3600:
            raise HTTPException(400, "Edição longa demais")
    except Exception as exc:
        source.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(400, str(exc)) from exc
    finally:
        await file.close()
    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "status": "queued", "stage": "Aguardando exportação",
                        "progress": 0, "error": None, "download": None, "created": time.time()}
    threading.Thread(target=process_edit,
                     args=(job_id, source, destination, segments, quality, resolution, fps, mute),
                     daemon=True).start()
    return {"id": job_id}



@app.post("/api/editor/beats")
async def analyze_beats(file: UploadFile = File(...)):
    """Opt-in beat analysis: streamed upload, FFmpeg child, bounded memory."""
    from beat_detection import detect_beats
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT | {".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"}:
        raise HTTPException(400, "Formato de áudio ou vídeo inválido")
    try:
        ffmpeg = find_binary("ffmpeg")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    path = UPLOADS / (uuid.uuid4().hex + ext)
    size = 0
    try:
        with path.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Arquivo acima de 1 GB")
                out.write(chunk)
        if not size:
            raise HTTPException(400, "Arquivo vazio")
        return await asyncio.to_thread(detect_beats, path, ffmpeg)
    finally:
        await file.close()
        path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
