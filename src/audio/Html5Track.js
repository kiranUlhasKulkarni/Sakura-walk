/**
 * Local-file fallback track (public/audio/*.mp3), adapted from
 * fireworks/src/audio/Html5Track.js, with the same hard loop window as the
 * YouTube track.
 */
export class Html5Track {
  kind = 'html5';

  constructor({ src, loop = false, loopFrom = 0, loopEnd = null, onEnded }) {
    const el = new Audio();
    el.preload = 'auto';
    el.loop = loop && loopEnd == null;
    el.playsInline = true;
    el.src = src;
    el.volume = 0;
    this.el = el;
    this.loop = loop;
    this.loopFrom = loopFrom;
    this.loopEnd = loopEnd;
    this.shouldPlay = false;
    el.addEventListener('timeupdate', () => {
      if (this.loopEnd != null && el.currentTime >= this.loopEnd) el.currentTime = this.loopFrom;
    });
    el.addEventListener('ended', () => {
      if (this.loop) {
        el.currentTime = this.loopFrom;
        el.play().catch(() => {});
        return;
      }
      this.shouldPlay = false;
      onEnded?.();
    });
    this.ready = new Promise((resolve, reject) => {
      el.addEventListener('canplay', () => resolve(this), { once: true });
      el.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
      el.load();
    });
  }

  /** Unlock inside a gesture: a muted play + pause, so a later play() is allowed. */
  prime(at = 0) {
    if (this.shouldPlay) return;
    const el = this.el;
    const v = el.volume;
    el.muted = true;
    el.play()?.then(() => {
      if (!this.shouldPlay) el.pause();
      el.muted = false;
      el.volume = v;
      this.seek(at);
    }).catch(() => (el.muted = false));
  }

  play() {
    this.shouldPlay = true;
    this.el.play()?.catch(() => {});
  }

  pause() {
    this.shouldPlay = false;
    this.el.pause();
  }

  seek(s) {
    try {
      this.el.currentTime = s;
    } catch {
      /* not seekable yet */
    }
  }

  get currentTime() {
    return this.el.currentTime;
  }

  setVolume(v) {
    this.el.volume = Math.min(1, Math.max(0, v));
  }

  get isPlaying() {
    return !this.el.paused;
  }

  destroy() {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }
}
