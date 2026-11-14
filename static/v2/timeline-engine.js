/**
 * Video Enhancer V2 - deterministic multitrack editing core.
 * Copyright (c) 2026 Video Enhancer contributors. MIT.
 *
 * Built independently using the separation of model / editor / renderer as an
 * architectural reference from ReaCut (Xiangyu-CAS/rea-capcut, MIT).
 * No upstream code or assets are copied.
 *
 * All edit times are integer frames. The presentation layer is never the
 * source of truth; each operation is validated before mutation.
 */
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.VE2Engine = exported;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const copy = o => JSON.parse(JSON.stringify(o));
  const integral = n => Number.isSafeInteger(n);
  const permittedKinds = new Set(['video', 'audio', 'overlay']);
  function assert(test, message) { if (!test) throw new Error(message); }
  function snapFrame(seconds, fps) {
    assert(Number.isFinite(seconds) && seconds >= 0, 'Tempo inválido');
    return Math.round(seconds * fps);
  }
  class Timeline {
    constructor(options = {}) {
      this.fps = options.fps || 30;
      assert([24, 25, 30, 60].includes(this.fps), 'FPS não suportado');
      this.tracks = [];
      this.media = {};
      this.history = [];
      this.future = [];
      this.maxHistory = 70;
      this.seq = 0;
    }
    next(prefix) { this.seq++; return prefix + '-' + this.seq; }
    saveCheckpoint() {
      this.history.push(this.snapshot());
      if (this.history.length > this.maxHistory) this.history.shift();
      this.future.length = 0;
    }
    snapshot() { return copy({ fps: this.fps, tracks: this.tracks, media: this.media, seq: this.seq }); }
    load(snapshot, remember = false) {
      const candidate = copy(snapshot);
      validate(candidate);
      if (remember) this.saveCheckpoint();
      this.fps = candidate.fps;
      this.tracks = candidate.tracks;
      this.media = candidate.media;
      this.seq = candidate.seq;
      return this.snapshot();
    }
    undo() {
      if (!this.history.length) return false;
      this.future.push(this.snapshot());
      this.load(this.history.pop());
      return true;
    }
    redo() {
      if (!this.future.length) return false;
      this.history.push(this.snapshot());
      this.load(this.future.pop());
      return true;
    }
    addMedia({ name, kind, duration, sourceId }) {
      assert(kind === 'video' || kind === 'audio', 'Tipo de mídia inválido');
      assert(typeof name === 'string' && name.length <= 256, 'Nome de arquivo inválido');
      assert(typeof sourceId === 'string' && sourceId.length, 'Identificador de mídia obrigatório');
      const frames = snapFrame(duration, this.fps);
      assert(frames > 0, 'Mídia vazia');
      this.saveCheckpoint();
      const id = this.next('media');
      this.media[id] = { id, name, kind, frames, sourceId };
      return id;
    }
    addTrack(kind = 'video', name = null) {
      assert(permittedKinds.has(kind), 'Tipo de faixa inválido');
      assert(this.tracks.length < 16, 'Limite de 16 faixas');
      this.saveCheckpoint();
      const id = this.next('track');
      this.tracks.push({ id, name: name || kind.toUpperCase() + ' ' + (this.tracks.length + 1), kind, locked: false, muted: false, clips: [] });
      return id;
    }
    track(trackId) {
      const found = this.tracks.find(t => t.id === trackId);
      assert(found, 'Faixa não encontrada');
      return found;
    }
    clip(clipId) {
      for (const track of this.tracks) {
        const found = track.clips.find(c => c.id === clipId);
        if (found) return { track, clip: found };
      }
      throw new Error('Clipe não encontrado');
    }
    sort(track) { track.clips.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)); }
    collisions(track, at, length, ignoreId = null) {
      return track.clips.filter(c => c.id !== ignoreId && at < c.at + c.length && at + length > c.at);
    }
    assertFits(track, at, length, ignoreId = null) {
      assert(integral(at) && at >= 0 && integral(length) && length >= 1, 'Quadros inválidos');
      assert(!track.locked, 'Faixa bloqueada');
      assert(!this.collisions(track, at, length, ignoreId).length, 'Colisão: existe outro clipe nessa faixa');
    }
    rippleRight(track, from, delta, exceptId) {
      if (delta <= 0) return;
      for (const c of track.clips) {
        if (c.id !== exceptId && c.at >= from) c.at += delta;
      }
      this.sort(track);
    }
    addClip(trackId, mediaId, at, opts = {}) {
      const t = this.track(trackId), m = this.media[mediaId];
      assert(m, 'Mídia inexistente');
      assert(t.kind === 'overlay' || t.kind === m.kind, 'Tipo de mídia incompatível com a faixa');
      const start = opts.inFrame ?? 0, end = opts.outFrame ?? m.frames;
      assert(integral(start) && integral(end) && start >= 0 && end <= m.frames && end > start, 'Corte inválido');
      const length = end - start;
      assert(integral(at) && at >= 0, 'Posição inválida');
      if (opts.ripple) {
        const colliding = this.collisions(t, at, length);
        assert(!colliding.some(c => c.at < at), 'Inserção no meio de clipe: divida-o antes');
      } else this.assertFits(t, at, length);
      this.saveCheckpoint();
      if (opts.ripple) this.rippleRight(t, at, length);
      const clip = { id: this.next('clip'), mediaId, at, length, inFrame: start, outFrame: end, gain: 1, transform: null };
      t.clips.push(clip);
      this.sort(t);
      return clip.id;
    }
    move(clipId, trackId, at, { ripple = false } = {}) {
      const { track: from, clip } = this.clip(clipId), to = this.track(trackId);
      assert(!from.locked && !to.locked, 'Faixa bloqueada');
      const m = this.media[clip.mediaId];
      assert(to.kind === 'overlay' || to.kind === m.kind, 'Faixa incompatível');
      assert(integral(at) && at >= 0, 'Posição inválida');
      if (!ripple) this.assertFits(to, at, clip.length, clipId);
      else {
        assert(!this.collisions(to, at, clip.length, clipId).some(c => c.at < at), 'Divida clipes antes de inserir no meio');
      }
      this.saveCheckpoint();
      if (ripple) this.rippleRight(to, at, clip.length, clipId);
      from.clips = from.clips.filter(c => c.id !== clipId);
      clip.at = at;
      to.clips.push(clip);
      this.sort(from); this.sort(to);
      return clip;
    }
    trim(clipId, newIn, newOut, { ripple = false } = {}) {
      const { track: t, clip } = this.clip(clipId);
      assert(!t.locked, 'Faixa bloqueada');
      const media = this.media[clip.mediaId];
      assert(integral(newIn) && integral(newOut) && newIn >= 0 && newOut > newIn && newOut <= media.frames, 'Corte inválido');
      const newLength = newOut - newIn;
      const oldEnd = clip.at + clip.length;
      const delta = newLength - clip.length;
      if (delta > 0 && ripple) {
        assert(!this.collisions(t, clip.at, newLength, clipId).some(c => c.at < oldEnd), 'Colisão com clipe existente');
      } else this.assertFits(t, clip.at, newLength, clipId);
      this.saveCheckpoint();
      if (delta > 0 && ripple) this.rippleRight(t, oldEnd, delta, clipId);
      clip.inFrame = newIn; clip.outFrame = newOut; clip.length = newLength;
      return clip;
    }
    split(clipId, at) {
      const { track: t, clip } = this.clip(clipId);
      assert(!t.locked, 'Faixa bloqueada');
      assert(integral(at) && at > clip.at && at < clip.at + clip.length, 'Divisão precisa estar dentro do clipe');
      this.saveCheckpoint();
      const oldOut = clip.outFrame;
      const relative = at - clip.at;
      const right = copy(clip);
      right.id = this.next('clip');
      right.at = at;
      right.inFrame = clip.inFrame + relative;
      right.outFrame = oldOut;
      right.length = clip.length - relative;
      clip.outFrame = right.inFrame;
      clip.length = relative;
      t.clips.push(right); this.sort(t);
      return right.id;
    }
    remove(clipId, { ripple = false } = {}) {
      const { track: t, clip } = this.clip(clipId);
      assert(!t.locked, 'Faixa bloqueada');
      this.saveCheckpoint();
      t.clips = t.clips.filter(c => c.id !== clipId);
      if (ripple) for (const c of t.clips) if (c.at >= clip.at + clip.length) c.at -= clip.length;
      this.sort(t);
    }
    setTrack(trackId, attrs) {
      const t = this.track(trackId);
      const patch = {};
      if (typeof attrs.locked === 'boolean') patch.locked = attrs.locked;
      if (typeof attrs.muted === 'boolean') patch.muted = attrs.muted;
      if (typeof attrs.name === 'string') patch.name = attrs.name.slice(0, 80);
      this.saveCheckpoint(); Object.assign(t, patch);
    }
    setTransform(clipId, transform) {
      const { track, clip } = this.clip(clipId);
      assert(!track.locked, 'Faixa bloqueada');
      const fields = ['x', 'y', 'width', 'height', 'rotation'];
      assert(transform === null || fields.every(f => Number.isFinite(transform[f])), 'Transformação inválida');
      this.saveCheckpoint();
      clip.transform = transform ? Object.fromEntries(fields.map(f => [f, transform[f]])) : null;
    }
    durationFrames() { return this.tracks.reduce((max,t)=>Math.max(max,...t.clips.map(c=>c.at+c.length),0),0); }
    toJSON() { return JSON.stringify({ format:'ve2-project',version:1,...this.snapshot() },null,2); }
    static fromJSON(text) {
      const payload=JSON.parse(text); assert(payload.format==='ve2-project'&&payload.version===1,'Formato de projeto inválido');
      const instance=new Timeline({fps:payload.fps});
      instance.load(payload);
      return instance;
    }
  }
  function validate(project) {
    assert(project && [24,25,30,60].includes(project.fps), 'FPS inválido');
    assert(Array.isArray(project.tracks) && project.tracks.length <= 16, 'Faixas inválidas');
    assert(project.media && typeof project.media === 'object', 'Mídia inválida');
    assert(integral(project.seq) && project.seq >= 0, 'Sequência inválida');
    const ids = new Set();
    for (const track of project.tracks) {
      assert(permittedKinds.has(track.kind), 'Tipo de faixa inválido');
      assert(typeof track.id === 'string' && !ids.has(track.id) && Array.isArray(track.clips), 'Faixa inválida');
      ids.add(track.id);
      const positions = [...track.clips].sort((a,b)=>a.at-b.at);
      for (const [i,c] of positions.entries()) {
        assert(typeof c.id==='string' && !ids.has(c.id) && typeof project.media[c.mediaId]==='object','Mídia/clipe inválido');
        ids.add(c.id);
        assert(integral(c.at)&&c.at>=0&&integral(c.length)&&c.length>0, 'Tempo inválido');
        assert(integral(c.inFrame)&&integral(c.outFrame)&&c.outFrame-c.inFrame===c.length&&c.outFrame<=project.media[c.mediaId].frames,'Corte inválido');
        assert(i===0||positions[i-1].at+positions[i-1].length<=c.at,'Sobreposição na mesma faixa');
      }
    }
    return true;
  }
  return { Timeline, snapFrame, validate };
});
