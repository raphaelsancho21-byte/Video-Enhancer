"""Frame-safe, streamable temporal motion blur filtergraph builder.

A lightweight approximation of editor-style blur using FFmpeg. This is not
optical flow and does not claim equivalence with CapCut's private algorithm.

Forward direction uses timestamps, never the memory-intensive reverse filter.
"""
from __future__ import annotations


def motion_blur_filters(source_label: str, result_label: str, clip_index: int,
                        fps: float, amount: int, blend: int, direction: str,
                        times: int) -> list[str]:
    if not (0 <= amount <= 100 and 0 <= blend <= 100 and
            direction in {"both", "backward", "forward"} and
            times in {1, 2, 4, 6} and 1 <= fps <= 120):
        raise ValueError("Configuração de borrão inválida")
    if amount == 0 or blend == 0:
        return [f"[{source_label}]null[{result_label}]"]

    # Times increases the effective window, avoiding multiple heavy passes.
    # Bound worst-case to 16 buffered frames for low-RAM devices.
    frames = max(2, min(16, 2 + round((amount / 100) * (2 + 2 * times))))
    alpha = blend / 100
    tail_seconds = (frames - 1) / fps
    prefix = f"mb{clip_index}"
    filters: list[str] = []

    if direction == "both":
        filters.append(f"[{source_label}]split=3[{prefix}original][{prefix}past][{prefix}future]")
    else:
        branch = "past" if direction == "backward" else "future"
        filters.append(f"[{source_label}]split=2[{prefix}original][{prefix}{branch}]")

    if direction in ("both", "backward"):
        filters.append(f"[{prefix}past]tmix=frames={frames}:weights=1[{prefix}backmix]")
    if direction in ("both", "forward"):
        filters.append(
            f"[{prefix}future]tmix=frames={frames}:weights=1,"
            f"setpts=PTS-{frames - 1}/({fps:.9f}*TB),"
            f"tpad=stop_mode=clone:stop_duration={tail_seconds:.9f}"
            f"[{prefix}aheadmix]"
        )
    if direction == "both":
        filters.append(
            f"[{prefix}backmix][{prefix}aheadmix]"
            f"blend=all_expr='(A+B)/2'[{prefix}blurred]"
        )
    else:
        tag = "backmix" if direction == "backward" else "aheadmix"
        filters.append(f"[{prefix}{tag}]null[{prefix}blurred]")
    filters.append(
        f"[{prefix}original][{prefix}blurred]"
        f"blend=all_expr='A*{1-alpha:.4f}+B*{alpha:.4f}',"
        f"format=yuv420p[{result_label}]"
    )
    return filters


def optical_motion_blur_filters(source_label: str, result_label: str,
                                clip_index: int, fps: float, duration: float,
                                amount: int, blend: int, direction: str,
                                times: int) -> list[str]:
    """Motion-compensated subframe accumulation, not simple source-frame ghosting.

    FFmpeg minterpolate estimates block motion between original frames. We
    sample interpolated positions at 2x–4x fps, integrate short exposures,
    shift the exposure window to set direction, then restore the project's FPS.
    Memory is bounded by a small window (no reverse or full clip caching).

    This remains a block-motion approximation, not a copy of CapCut's
    proprietary pixel/optical-flow shader.
    """
    if not (1 <= fps <= 120 and duration > 0 and
            0 <= amount <= 100 and 0 <= blend <= 100 and
            direction in {"both", "backward", "forward"} and
            times in {1, 2, 4, 6}):
        raise ValueError("Parâmetros de Motion Blur inválidos")
    if amount == 0 or blend == 0:
        return [f"[{source_label}]null[{result_label}]"]

    # 6x is a quality setting, not six decoding/rendering passes.
    samples = {1: 2, 2: 3, 4: 4, 6: 4}[times]
    high_fps = fps * samples
    # Short exposure: avoid duplicating entire source frames as strong ghosting.
    window = max(2, min(samples, round(2 + (samples - 2) * amount / 100)))
    mix = blend / 100
    before = {"backward": 0, "both": (window - 1) / 2,
              "forward": window - 1}[direction]
    shift = before / high_fps
    tag = f"flow{clip_index}"
    # FPS normalization on both branches keeps exact pairing for blend.
    # Avoid reverse (would buffer the full 1080p video in RAM).
    return [
        f"[{source_label}]split=2[{tag}original][{tag}interpolate]",
        (f"[{tag}interpolate]"
         f"minterpolate=fps={high_fps:.6f}:mi_mode=mci:mc_mode=obmc:me_mode=bidir,"
         f"tmix=frames={window}:weights=" + " ".join(["1"] * window) +
         f",setpts=PTS-{shift:.9f}/TB,"
         f"tpad=stop_mode=clone:stop_duration={(window/high_fps):.9f},"
         f"fps=fps={fps:.6f}:start_time=0,"
         f"trim=duration={duration:.6f},setpts=PTS-STARTPTS[{tag}trail]"),
        (f"[{tag}original]fps=fps={fps:.6f}:start_time=0,"
         f"trim=duration={duration:.6f},setpts=PTS-STARTPTS[{tag}clean]"),
        (f"[{tag}clean][{tag}trail]"
         f"blend=all_expr='A*{1-mix:.5f}+B*{mix:.5f}',"
         f"format=yuv420p[{result_label}]"),
    ]
