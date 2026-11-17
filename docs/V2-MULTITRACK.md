# Video Enhancer V2 — Multitrack Engine (experimental)

This branch explores a new timeline architecture without replacing the existing Video Enhancer editor.

## Reference and licensing

The ReaCut project (https://github.com/Xiangyu-CAS/rea-capcut), licensed under MIT, informed **the architectural decision** to separate project model, timeline, editor interaction, and media export. The V2 files in this branch are independently implemented. **No ReaCut source files, icons, bundled binaries, or assets were copied**. Before ever copying upstream files, preserve their MIT copyright notices and check third-party licenses separately.

## What works

- Browser prototype at `http://127.0.0.1:8000/static/v2/editor.html`
- Independent track model with video, audio and overlay tracks
- Import local video/audio metadata; add media to tracks, move, split, delete, lock/mute and undo/redo
- Frame-based clip positions; overlap permitted between tracks, rejected within the same track
- Ripple insert and ripple trim operations
- Drag clips using pointer events (mouse + touch); JSON save/load, with files kept local
- Node tests: `node --test tests/test_v2_timeline.cjs`

## Not yet part of V2

- **The prototype preview is of a selected source clip, not a multicamera composited preview.**
- **Multitrack FFmpeg export is not implemented** in this branch; the current V1 editor/export remains available at `/editor`.
- Projects store metadata only. After reopening JSON, video/audio media must be reimported.
- Keyframe curves, transitions, subtitles, image layers, high-performance virtualization and reliable Android APK builds are not in this iteration.
- This is exploratory work. Run tests and exercise the browser before merging into `main`.

## Progression plan

1. Extract a stable track/clip/media schema and test collision, ripple and frame arithmetic (this branch).
2. Attach the V1 preview and editor to the same model without regressions.
3. Implement FFmpeg multitrack composition (video overlays and independent audio mixing) and compare with preview.
4. Add keyframes and effects as separate modules.
5. Profile CPU, memory and GPU use on Windows and Android targets.

## Test

```bash
node --test tests/test_v2_timeline.cjs
python -m compileall -q app.py
```

Main Video Enhancer code in this repository is not replaced; use the existing editor until V2 rendering and export are validated.
