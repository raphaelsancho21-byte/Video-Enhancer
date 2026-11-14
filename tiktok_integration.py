"""Local TikTok Login Kit Desktop + Content Posting API inbox upload.

No passwords or permanent tokens are stored. Access/refresh tokens live only
in server memory and disappear on restart. The upload requires an explicit click,
and the user completes publication inside TikTok. Configure approved scopes and
TikTok client credentials via environment variables.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/api/tiktok", tags=["TikTok"])
CLIENT_KEY = os.environ.get("TIKTOK_CLIENT_KEY", "").strip()
CLIENT_SECRET = os.environ.get("TIKTOK_CLIENT_SECRET", "").strip()
REDIRECT = "http://127.0.0.1:8000/api/tiktok/callback"
COOKIE = "ve_tiktok_session"
AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
POST_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
LOCK = threading.RLock()
PENDING: dict[str, dict] = {}
SESSIONS: dict[str, dict] = {}
UPLOADS: dict[str, dict] = {}
RENDER_JOBS = None
RENDER_LOCK = None
RENDER_OUTPUTS = None

def configure(jobs, lock, outputs):
    global RENDER_JOBS, RENDER_LOCK, RENDER_OUTPUTS
    RENDER_JOBS = jobs
    RENDER_LOCK = lock
    RENDER_OUTPUTS = outputs


def _session(req: Request) -> str:
    sid = req.cookies.get(COOKIE, "")
    if not sid or len(sid) != 64:
        raise HTTPException(401, "Conecte sua conta pelo botão TikTok.")
    return sid


def _token(sid: str) -> str:
    with LOCK:
        data = SESSIONS.get(sid)
    if not data:
        raise HTTPException(401, "Conta desconectada. Entre novamente.")
    if "video.upload" not in data.get("scope", ""):
        raise HTTPException(403, "O TikTok não autorizou video.upload. Confira as permissões do app.")
    if data["expires_at"] > time.time() + 60:
        return data["access_token"]
    if not data.get("refresh_token"):
        raise HTTPException(401, "Sessão expirada. Conecte novamente.")
    try:
        resp = httpx.post(TOKEN_URL, data={
            "client_key": CLIENT_KEY, "client_secret": CLIENT_SECRET,
            "grant_type": "refresh_token", "refresh_token": data["refresh_token"],
        }, timeout=30)
        resp.raise_for_status()
        fresh = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(503, "Não foi possível renovar a conexão TikTok.") from exc
    if not fresh.get("access_token"):
        raise HTTPException(401, "Autorização expirada. Conecte novamente.")
    with LOCK:
        SESSIONS[sid] = {
            **data, "access_token": fresh["access_token"],
            "refresh_token": fresh.get("refresh_token", data["refresh_token"]),
            "expires_at": time.time() + int(fresh.get("expires_in", 86400)),
        }
    return fresh["access_token"]


@router.get("/status")
def status(request: Request):
    sid = request.cookies.get(COOKIE)
    with LOCK:
        data = SESSIONS.get(sid) if sid else None
    return {
        "configured": bool(CLIENT_KEY and CLIENT_SECRET),
        "connected": bool(data),
        "scope": data.get("scope", "") if data else "",
        "open_id": data.get("open_id") if data else None,
        "mode": "inbox_draft",
    }


@router.get("/connect")
def connect(request: Request):
    if not CLIENT_KEY or not CLIENT_SECRET:
        raise HTTPException(503, "Configure TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET no servidor.")
    sid = request.cookies.get(COOKIE)
    if not sid or len(sid) != 64:
        sid = secrets.token_hex(32)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    challenge = hashlib.sha256(verifier.encode()).hexdigest()  # TikTok Desktop: HEX, not base64.
    with LOCK:
        PENDING[state] = {"session": sid, "verifier": verifier, "created": time.time()}
        for key in list(PENDING):
            if time.time() - PENDING[key]["created"] > 600:
                del PENDING[key]
    url = AUTH_URL + "?" + urlencode({
        "client_key": CLIENT_KEY,
        "response_type": "code",
        "scope": "user.info.basic,video.upload",
        "redirect_uri": REDIRECT,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(COOKIE, sid, httponly=True, samesite="lax", secure=False,
                        path="/", max_age=30 * 24 * 3600)
    return response


@router.get("/callback")
def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        return RedirectResponse("/editor?tiktok=denied", status_code=302)
    with LOCK:
        challenge = PENDING.pop(state, None)
    if (not challenge or not secrets.compare_digest(challenge["session"],
            request.cookies.get(COOKIE, "")) or
            time.time() - challenge["created"] > 600 or not code):
        raise HTTPException(400, "Resposta de autenticação inválida ou expirada.")
    try:
        response = httpx.post(TOKEN_URL, data={
            "client_key": CLIENT_KEY, "client_secret": CLIENT_SECRET,
            "grant_type": "authorization_code", "redirect_uri": REDIRECT,
            "code": code, "code_verifier": challenge["verifier"],
        }, timeout=30)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "O TikTok não concluiu a autorização.") from exc
    if not payload.get("access_token"):
        raise HTTPException(403, "O TikTok não concedeu acesso à conta.")
    with LOCK:
        SESSIONS[challenge["session"]] = {
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token"),
            "expires_at": time.time() + int(payload.get("expires_in", 86400)),
            "scope": payload.get("scope", ""),
            "open_id": payload.get("open_id", ""),
        }
    return RedirectResponse("/editor?tiktok=connected", status_code=302)


@router.post("/disconnect")
def disconnect(request: Request):
    sid = _session(request)
    with LOCK:
        SESSIONS.pop(sid, None)
    response = {"connected": False}
    return response


def _safe_upload_url(value: str):
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    if (parsed.scheme != "https" or not hostname or
        not (hostname == "tiktokapis.com" or hostname.endswith(".tiktokapis.com")) or
        parsed.username or parsed.password):
        raise RuntimeError("URL de envio não reconhecida como domínio do TikTok.")
    return value


def _worker(task_id: str, path: Path, token: str):
    try:
        size = path.stat().st_size
        if size <= 0 or size > 1024**3:
            raise RuntimeError("Vídeo inválido ou acima do limite de 1 GB do editor.")
        # TikTok's chunk count is floor(size / chunk_size); remainder goes
        # into the final chunk. Single chunk is required for files under 5 MB.
        chunk = size if size < 10_000_000 else 10_000_000
        count = max(1, size // chunk)
        with httpx.Client(timeout=120, follow_redirects=False) as client:
            response = client.post(POST_INIT_URL, headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }, json={"source_info": {
                "source": "FILE_UPLOAD", "video_size": size,
                "chunk_size": chunk, "total_chunk_count": count,
            }})
            response.raise_for_status()
            data = response.json()
            err = data.get("error", {})
            if err.get("code") != "ok":
                raise RuntimeError("TikTok: " + str(err.get("message") or err.get("code")))
            target = _safe_upload_url(data["data"]["upload_url"])
            publish_id = data["data"].get("publish_id", "")
            with path.open("rb") as f:
                pos = 0
                for i in range(count):
                    length = chunk if i < count - 1 else size - pos
                    chunk_data = f.read(length)
                    if len(chunk_data) != length:
                        raise RuntimeError("Falha na leitura do vídeo exportado.")
                    result = client.put(target, headers={
                        "Content-Type": "video/mp4",
                        "Content-Length": str(length),
                        "Content-Range": f"bytes {pos}-{pos+length-1}/{size}",
                    }, content=chunk_data)
                    if result.status_code not in (200, 201, 206):
                        raise RuntimeError("TikTok recusou uma parte do vídeo (HTTP " + str(result.status_code) + ")")
                    pos += length
                    with LOCK:
                        UPLOADS[task_id].update(progress=round(pos / size * 100), stage="Enviando ao TikTok")
            with LOCK:
                UPLOADS[task_id].update(status="done", progress=100,
                                        stage="Enviado. Conclua a publicação no TikTok.",
                                        publish_id=publish_id)
    except (OSError, httpx.HTTPError, ValueError, KeyError, RuntimeError) as exc:
        with LOCK:
            UPLOADS[task_id].update(status="error", error=str(exc)[:500],
                                    stage="Falha ao enviar")


@router.post("/share/{job_id}")
def share(job_id: str, request: Request):
    sid = _session(request)
    origin = request.headers.get("origin", "")
    if origin and origin not in {"http://127.0.0.1:8000", "http://localhost:8000"}:
        raise HTTPException(403, "Origem não autorizada")
    token = _token(sid)
    if RENDER_JOBS is None:
        raise HTTPException(503, "Serviço de exportação indisponível")
    with RENDER_LOCK:
        job = RENDER_JOBS.get(job_id)
        if not job or job.get("status") != "done":
            raise HTTPException(404, "Exporte primeiro o vídeo no editor.")
    path = RENDER_OUTPUTS / f"{job_id}.mp4"
    if not path.is_file():
        raise HTTPException(404, "Vídeo exportado não encontrado.")
    task_id = secrets.token_hex(16)
    with LOCK:
        UPLOADS[task_id] = {
            "status": "processing", "stage": "Preparando envio",
            "progress": 0, "owner": sid, "created": time.time(),
        }
    threading.Thread(target=_worker, args=(task_id, path, token), daemon=True).start()
    return {"id": task_id}


@router.get("/share/status/{task_id}")
def share_status(task_id: str, request: Request):
    sid = _session(request)
    with LOCK:
        job = UPLOADS.get(task_id)
        if not job or job["owner"] != sid:
            raise HTTPException(404, "Envio não encontrado")
        return {key: value for key, value in job.items()
                if key not in ("owner", "created")}
