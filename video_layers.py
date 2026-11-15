"""Server-side storage and validation for lightweight video overlay layers."""
from __future__ import annotations

import json
import math
import uuid
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/editor/layers", tags=["Editor Layers"])
DIRECTORY: Path | None = None
PROBE = None
ALLOWED = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
MAX_LAYER_BYTES = 350 * 1024 * 1024


def configure(directory: Path, video_probe):
    global DIRECTORY, PROBE
    DIRECTORY, PROBE = directory, video_probe
    DIRECTORY.mkdir(parents=True, exist_ok=True)


def resolve_layer(asset_id: str) -> Path:
    if len(asset_id) != 32 or any(c not in "0123456789abcdef" for c in asset_id):
        raise ValueError("ID de camada inválido")
    if DIRECTORY is None:
        raise ValueError("Armazenamento indisponível")
    candidates = [DIRECTORY / (asset_id + suffix) for suffix in sorted(ALLOWED)]
    path = next((p for p in candidates if p.is_file()), None)
    if path is None:
        raise ValueError("Vídeo da camada não encontrado. Importe novamente.")
    return path


@router.post("/upload")
async def upload_layer(file: UploadFile = File(...)):
    if DIRECTORY is None or PROBE is None:
        raise HTTPException(503, "Camadas indisponíveis")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(400, "Formato de camada incompatível")
    asset_id = uuid.uuid4().hex
    path = DIRECTORY / (asset_id + ext)
    size = 0
    try:
        with path.open("wb") as stream:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_LAYER_BYTES:
                    raise HTTPException(413, "Camada acima de 350 MB")
                stream.write(chunk)
        if size == 0:
            raise HTTPException(400, "Arquivo vazio")
        import asyncio
        info = await asyncio.to_thread(PROBE, path)
        return {"id": asset_id, "name": Path(file.filename or "Sobreposição").name[:100],
                "duration": info["duration"], "width": info["width"],
                "height": info["height"], "url": f"/api/editor/layers/media/{asset_id}"}
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.get("/media/{asset_id}")
def layer_media(asset_id: str):
    try:
        path = resolve_layer(asset_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    types = {".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
             ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo"}
    return FileResponse(path, media_type=types[path.suffix.lower()],
                        content_disposition_type="inline", headers={"Cache-Control":"private, max-age=60"})


def validate_layers(payload):
    if not isinstance(payload, list) or len(payload) > 4:
        raise ValueError("Máximo de quatro camadas de vídeo")
    normalized = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("Camada inválida")
        asset_id = item.get("id")
        path = resolve_layer(asset_id)
        values = {}
        for field in ("at", "start", "end", "x", "y", "scale", "opacity"):
            values[field] = float(item[field])
        if not all(math.isfinite(v) for v in values.values()):
            raise ValueError("Camada com números inválidos")
        if not (0 <= values["at"] <= 86400 and 0 <= values["start"] < values["end"]
                and 0 <= values["x"] <= 1 and 0 <= values["y"] <= 1
                and 0.1 <= values["scale"] <= 1 and 0 <= values["opacity"] <= 1):
            raise ValueError("Tempo, posição ou opacidade inválidos")
        if values["end"] - values["start"] < .08:
            raise ValueError("Camada curta demais")
        info = PROBE(path)
        if values["end"] > info["duration"] + .1:
            raise ValueError("Camada ultrapassa duração da mídia")
        normalized.append({**values, "id": asset_id,
                           "width": info["width"], "height": info["height"],
                           "path": path, "hidden": bool(item.get("hidden", False))})
    return normalized
