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
AUDIO = DATA / "audio"
for directory in (UPLOADS, OUTPUTS, AUDIO):
    directory.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 1024 * 1024 * 1024
ALLOWED_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
PROCESS_LOCK = threading.Lock()
app = FastAPI(title="Video Enhancer", version="1.0.0")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

import tiktok_integration
tiktok_integration.configure(JOBS, JOBS_LOCK, OUTPUTS)
app.include_router(tiktok_integration.router)


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



@app.get("/api/editor/preview/{job_id}")
def preview_result(job_id: str):
    """Stream a completed short render inline instead of starting a download."""
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise HTTPException(404, "Prévia não encontrada")
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or job.get("status") != "done":
            raise HTTPException(404, "Prévia ainda não disponível")
    path = OUTPUTS / f"{job_id}.mp4"
    if not path.is_file():
        raise HTTPException(404, "Arquivo de prévia não encontrado")
    return FileResponse(path, media_type="video/mp4", content_disposition_type="inline",
                        headers={"Cache-Control": "no-store"})


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
                 quality: str, resolution: str, fps: str, muted: bool,
                 composition: dict | None = None, extracted_audio: dict | None = None,
                 export_mode: str = "fast", platform_preset: str = "none",
                 motion_blur: str = "off", blur_amount: int = 70,
                 blur_mix: int = 70, blur_direction: str = "both",
                 blur_times: int = 2, blur_algorithm: str = "flow"):
    with PROCESS_LOCK:
        with JOBS_LOCK:
            JOBS[job_id].update(status="processing", stage="Renderizando edição")
        try:
            duration = max((c.get("at", 0) + (c["end"] - c["start"]) / c["speed"] for c in segments), default=0)
            separate_audio = bool(extracted_audio and not muted)
            has_audio = probe_audio(source) and not muted and not separate_audio
            import math
            meta = probe_video(source)
            comp_w = int(composition["width"]) if composition else int(meta["width"]) // 2 * 2
            comp_h = int(composition["height"]) if composition else int(meta["height"]) // 2 * 2
            rate = subprocess.run(
                [find_binary("ffprobe"), "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=avg_frame_rate", "-of", "default=nokey=1:noprint_wrappers=1", str(source)],
                capture_output=True, text=True, timeout=40)
            try:
                n, d = rate.stdout.strip().split("/")
                source_fps = max(1, min(60, float(n) / float(d)))
                base_fps = (min(source_fps, 60) if fps == "60" else
                            float(composition.get("fps", source_fps)) if composition else source_fps)
            except (ValueError, ZeroDivisionError):
                base_fps = float(composition.get("fps", 30)) if composition else 30.0
            graph = []
            # All clips are on a single video track in this release.
            # Insert black frames and optional silence for intentional gaps.
            rendered = []
            play_at = 0.0
            segments = sorted(segments, key=lambda c: c.get("at", 0))
            for i, c in enumerate(segments):
                at = c.get("at", play_at)
                gap = max(0.0, at - play_at)
                if gap >= 0.5 / base_fps:
                    vg = f"vg{i}"
                    graph.append(f"color=c=black:s={comp_w}x{comp_h}:r={base_fps:.4f}:d={gap:.6f},format=yuv420p[{vg}]")
                    if has_audio:
                        ag = f"ag{i}"
                        graph.append(f"anullsrc=r=44100:cl=stereo,atrim=duration={gap:.6f},asetpts=PTS-STARTPTS[{ag}]")
                        rendered.append((vg, ag))
                    else:
                        rendered.append((vg, None))
                play_at = at + (c["end"] - c["start"]) / c["speed"]

                start, end, speed = c["start"], c["end"], c["speed"]

                chain = (f"[0:v:0]trim=start={start:.5f}:end={end:.5f},"
                         f"setpts=(PTS-STARTPTS)/{speed:.5f},"
                         f"fps={base_fps:.4f},setsar=1")
                t = c.get("transform")
                identity = (
                    comp_w == int(meta["width"]) and comp_h == int(meta["height"]) and
                    (not t or
                    (abs(t["x"] - meta["width"] / 2) < 0.01
                     and abs(t["y"] - meta["height"] / 2) < 0.01
                     and abs(t["width"] - meta["width"]) < 0.01
                     and abs(t["height"] - meta["height"]) < 0.01
                     and abs(t["rotation"] % 360) < 0.00001)))
                
                if not identity:
                    if not t:
                        # Legacy clip with no transform: contain within the composition.
                        factor = min(comp_w / meta["width"], comp_h / meta["height"])
                        tw, th = meta["width"] * factor, meta["height"] * factor
                        t = {"width": tw, "height": th, "x": comp_w/2,
                             "y": comp_h/2, "rotation": 0}
                    w = max(2, int(round(t["width"] / 2) * 2))
                    h = max(2, int(round(t["height"] / 2) * 2))
                    angle = (t["rotation"] % 360) * math.pi / 180
                    chain += f",scale={w}:{h}:flags=lanczos,format=rgba"
                    if abs(angle) > 0.000001:
                        chain += (f",rotate={angle:.9f}:ow=rotw({angle:.9f}):"
                                  f"oh=roth({angle:.9f}):c=none")
                    graph.append(chain + f"[foreground{i}]")
                    graph.append(f"color=c=black:s={comp_w}x{comp_h}:r={base_fps:.4f}:d={(end-start)/speed:.6f}[background{i}]")
                    x = t["x"] - comp_w / 2
                    y = t["y"] - comp_h / 2
                    graph.append(f"[background{i}][foreground{i}]overlay=x=(W-w)/2+({x:.5f}):y=(H-h)/2+({y:.5f}):shortest=1:format=auto,format=yuv420p[v{i}]")
                else:
                    graph.append(chain + f",format=yuv420p[vraw{i}]")
                # Apply blur PER CLIP, never mix frames across a cut.
                from motion_blur import motion_blur_filters, optical_motion_blur_filters
                source_label = f"v{i}" if not identity else f"vraw{i}"
                if motion_blur == "off":
                    graph.append(f"[{source_label}]null[vready{i}]")
                else:
                    strength = {
                        "light": (28, 45, "backward", 1),
                        "medium": (55, 65, "backward", 2),
                        "strong": (88, 90, "both", 4),
                    }
                    amt, mix, direction, times = strength.get(
                        motion_blur, (blur_amount, blur_mix, blur_direction, blur_times)
                    )
                    if blur_algorithm == "flow":
                        graph.extend(optical_motion_blur_filters(
                            source_label, f"vready{i}", i, base_fps,
                            (end-start)/speed, amt, mix, direction, times
                        ))
                    else:
                        graph.extend(motion_blur_filters(
                            source_label, f"vready{i}", i, base_fps,
                            amt, mix, direction, times
                        ))
                if has_audio:
                    graph.append(
                        f"[0:a:0]atrim=start={start:.5f}:end={end:.5f},"
                        f"asetpts=PTS-STARTPTS,atempo={speed:.5f},"
                        f"aresample=async=1:first_pts=0[a{i}]")
                rendered.append((f"vready{i}", f"a{i}" if has_audio else None))
            if has_audio:
                inputs = "".join(f"[{v}][{a}]" for v, a in rendered)
                graph.append(f"{inputs}concat=n={len(rendered)}:v=1:a=1[vcat][aout]")
            else:
                inputs = "".join(f"[{v}]" for v, _ in rendered)
                graph.append(f"{inputs}concat=n={len(rendered)}:v=1:a=0[vcat]")
            # Fast mode avoids expensive motion-estimated frame interpolation and
            # prioritizes low CPU / RAM consumption. The quality mode keeps it.
            effect_fps = "original" if export_mode == "fast" else fps
            enhancements = make_filters(quality, "original" if composition else resolution, effect_fps)
            if export_mode == "fast" and fps == "60":
                enhancements.append("fps=60")
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
            if separate_audio:
                # Audio is a distinct media track with an independent timeline start.
                audio_path = AUDIO / (extracted_audio["id"] + ".mp3")
                if not audio_path.is_file():
                    raise RuntimeError("Áudio extraído ausente. Extraia novamente antes de exportar.")
                offset = float(extracted_audio["at"])
                volume = float(extracted_audio["volume"])
                # Add input, then mix a delayed/trimmed audio track to the video end.
                # Zero-based input #1 refers to the extracted audio, not the source.
                cmd += ["-i", str(audio_path)]
                audio_graph = (f"[1:a:0]atrim=duration={max(0.,duration-offset):.6f},"
                               f"asetpts=PTS-STARTPTS,volume={volume:.4f},"
                               f"adelay={int(round(offset*1000))}:all=1,"
                               f"apad=whole_dur={duration:.6f},"
                               f"atrim=duration={duration:.6f}[external_audio]")
                # Extend the existing filtergraph to produce one synchronized output.
                graph.append(audio_graph)
                cmd = [find_binary("ffmpeg"), "-hide_banner", "-nostdin", "-y",
                       "-i", str(source), "-i", str(audio_path),
                       "-filter_complex", ";".join(graph), "-map", video_map,
                       "-map", "[external_audio]"]
            codec_preset = "veryfast" if platform_preset == "tiktok_hq" else ("ultrafast" if export_mode == "fast" else "veryfast")
            codec_crf = "19" if platform_preset == "tiktok_hq" else ("21" if export_mode == "fast" else "19")
            cmd += ["-c:v", "libx264", "-preset", codec_preset, "-crf", codec_crf,
                    "-threads", "2" if export_mode == "fast" else "0", "-pix_fmt", "yuv420p"]
            if platform_preset == "tiktok_hq":
                # High-quality capped CRF, suitable for upload without huge files.
                limit = "16M" if fps == "60" else "10M"
                buffer = "32M" if fps == "60" else "20M"
                cmd += ["-profile:v", "high", "-maxrate", limit, "-bufsize", buffer,
                        "-g", "120" if fps == "60" else "60"]
            if has_audio or separate_audio:
                cmd += ["-c:a", "aac", "-b:a", "192k" if platform_preset == "tiktok_hq" else "192k"]
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
                        fps: str = Form("original"), mute: bool = Form(False),
                        composition: str = Form("null"), extracted_audio: str = Form("null"),
                        export_mode: str = Form("fast"), platform_preset: str = Form("none"),
                        motion_blur: str = Form("off"),
                        blur_amount: int = Form(70), blur_mix: int = Form(70),
                        blur_direction: str = Form("both"),
                        blur_times: int = Form(2), blur_algorithm: str = Form("flow")):
    import math
    if blur_algorithm not in {"flow", "blend"}:
        raise HTTPException(400, "Algoritmo de Motion Blur inválido")
    if motion_blur not in {"off", "light", "medium", "strong", "custom"}:
        raise HTTPException(400, "Intensidade de Motion Blur inválida")
    if not (0 <= blur_amount <= 100 and 0 <= blur_mix <= 100 and
            blur_direction in {"both", "backward", "forward"} and
            blur_times in {1, 2, 4, 6}):
        raise HTTPException(400, "Controles do Motion Blur inválidos")
    if platform_preset not in {"none", "tiktok_hq"}:
        raise HTTPException(400, "Preset de exportação inválido")
    if export_mode not in {"fast", "quality"}:
        raise HTTPException(400, "Modo de exportação inválido")
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
        comp = json.loads(composition)
        if comp is not None:
            if not isinstance(comp, dict):
                raise ValueError("Composição inválida")
            cw, ch = int(comp["width"]), int(comp["height"])
            if not (64 <= cw <= 4096 and 64 <= ch <= 4096 and cw % 2 == 0 and ch % 2 == 0):
                raise ValueError("Composição deve ter dimensões pares de 64 a 4096")
            cfps = int(comp.get("fps", 30))
            if cfps not in (24, 25, 30, 60):
                raise ValueError("FPS de composição inválido")
            comp = {"width": cw, "height": ch, "fps": cfps}
        audio_setting = json.loads(extracted_audio)
        if audio_setting is not None:
            if not isinstance(audio_setting, dict) or not isinstance(audio_setting.get("id"), str):
                raise ValueError("Faixa de áudio inválida")
            aid = audio_setting["id"]
            if len(aid) != 32 or not all(ch in "0123456789abcdef" for ch in aid):
                raise ValueError("ID de áudio inválido")
            audio_at, audio_volume = float(audio_setting.get("at", 0)), float(audio_setting.get("volume", 1))
            if not (0 <= audio_at <= 24*3600 and 0 <= audio_volume <= 2):
                raise ValueError("Posição ou volume de áudio inválido")
            audio_setting = {"id": aid, "at": audio_at, "volume": audio_volume}
        segments = json.loads(clips)
        if not isinstance(segments, list) or not 1 <= len(segments) <= 100:
            raise ValueError("Use entre 1 e 100 trechos")
        for seg in segments:
            if not isinstance(seg, dict):
                raise ValueError("Trecho inválido")
            start, end, speed = (float(seg[k]) for k in ("start", "end", "speed"))
            if not all(map(math.isfinite, (start, end, speed))) or start < 0 or end - start < 0.08 or speed not in (0.5, 1, 1.5, 2):
                raise ValueError("Tempos ou velocidade inválidos")
            at = float(seg.get("at", 0))
            if not math.isfinite(at) or at < 0 or at > 24 * 3600:
                raise ValueError("Posição de clipe inválida")
            seg.update(start=start, end=end, speed=speed, at=at)
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
        ordered = sorted(segments, key=lambda c: c["at"])
        for left, right in zip(ordered, ordered[1:]):
            if left["at"] + (left["end"]-left["start"])/left["speed"] > right["at"] + 1/30:
                raise HTTPException(400, "Clipes sobrepostos na mesma faixa")
        if max((c["at"] + (c["end"]-c["start"])/c["speed"] for c in segments), default=0) > 24*3600:
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
                     args=(job_id, source, destination, segments, quality, resolution, fps, mute, comp, audio_setting, export_mode, platform_preset, motion_blur, blur_amount, blur_mix, blur_direction, blur_times, blur_algorithm),
                     daemon=True).start()
    return {"id": job_id}




@app.post("/api/editor/import-audio")
async def import_project_mp3(file: UploadFile = File(...)):
    """Import an independent MP3 music track into this local editing project."""
    ext = Path(file.filename or "").suffix.lower()
    if ext != ".mp3":
        raise HTTPException(400, "Selecione um arquivo MP3 (.mp3)")
    try:
        find_binary("ffprobe")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    asset_id = uuid.uuid4().hex
    destination = AUDIO / (asset_id + ".mp3")
    received = 0
    try:
        with destination.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                received += len(chunk)
                if received > 256 * 1024 * 1024:
                    raise HTTPException(413, "MP3 muito grande (máximo de 256 MB)")
                out.write(chunk)
        if not received or not await asyncio.to_thread(probe_audio, destination):
            raise HTTPException(400, "Não foi possível ler o áudio desse MP3")
        return {"id": asset_id, "url": f"/api/editor/audio/{asset_id}",
                "name": (file.filename or "Música.mp3"), "size": received,
                "kind": "imported_mp3"}
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.post("/api/editor/extract-audio")
async def extract_project_audio(file: UploadFile = File(...)):
    """Extract audio to a project-local asset. Nothing is downloaded to the browser."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "Formato de vídeo inválido")
    try:
        ffmpeg = find_binary("ffmpeg")
        find_binary("ffprobe")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    asset_id = uuid.uuid4().hex
    input_path = UPLOADS / (asset_id + ext)
    audio_path = AUDIO / (asset_id + ".mp3")
    written = 0
    try:
        with input_path.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_BYTES:
                    raise HTTPException(413, "Arquivo ultrapassa 1 GB")
                out.write(chunk)
        if not written or not await asyncio.to_thread(probe_audio, input_path):
            raise HTTPException(400, "O vídeo não possui faixa de áudio")
        def encode():
            return subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                 "-i", str(input_path), "-map", "0:a:0", "-vn", "-c:a", "libmp3lame",
                 "-b:a", "160k", str(audio_path)],
                capture_output=True, text=True, timeout=1800)
        result = await asyncio.to_thread(encode)
        if result.returncode or not audio_path.is_file():
            raise HTTPException(500, "Erro extraindo áudio: " + result.stderr[-600:])
        return {"id": asset_id, "url": f"/api/editor/audio/{asset_id}",
                "size": audio_path.stat().st_size, "name": (file.filename or "video") + " • áudio"}
    except Exception:
        audio_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
        input_path.unlink(missing_ok=True)


@app.get("/api/editor/audio/{asset_id}")
def get_project_audio(asset_id: str):
    if len(asset_id) != 32 or not all(ch in "0123456789abcdef" for ch in asset_id):
        raise HTTPException(404, "Faixa não encontrada")
    path = AUDIO / (asset_id + ".mp3")
    if not path.is_file():
        raise HTTPException(404, "Áudio não encontrado (extraia novamente)")
    return FileResponse(path, media_type="audio/mpeg")


@app.post("/api/editor/audio/{asset_id}/beats")
async def detect_project_audio_beats(asset_id: str):
    from beat_detection import detect_beats
    if len(asset_id) != 32 or not all(ch in "0123456789abcdef" for ch in asset_id):
        raise HTTPException(404, "Faixa inválida")
    path = AUDIO / (asset_id + ".mp3")
    if not path.is_file():
        raise HTTPException(404, "Faixa não encontrada")
    return await asyncio.to_thread(detect_beats, path, find_binary("ffmpeg"))


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
