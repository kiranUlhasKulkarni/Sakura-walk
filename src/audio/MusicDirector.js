import { AUDIO } from '../config.js';
import { Html5Track } from './Html5Track.js';
import { YouTubeTrack, youtubeIdFromUrl } from './YouTubeTrack.js';

/**
 * One music phase. Prefers the YouTube stream, falls back to the local file,
 * and owns a gain the director fades (structure from fireworks' AudioDirector).
 */
class Channel {
  constructor(name, cfg, director) {
    Object.assign(this, { name, cfg, director });
    this.track = null;
    this.gain = 0;
    this.target = 0;
    this.rate = 1; // gain units / s
    this.pauseAtZero = false;
    this.wantPlay = false;
  }

  /** Try the links in order (the first one YouTube will embed wins), then the local file. */
  async init(from = 0) {
    const c = this.cfg;
    const urls = [c.url].flat();
    for (let i = from; i < urls.length; i++) {
      const videoId = youtubeIdFromUrl(urls[i]);
      if (!videoId) continue;
      try {
        // embedding can also be refused after the player is ready (error 101/150 on first play/cue):
        // then move on to the next link
        const yt = new YouTubeTrack({ videoId, loop: c.loop, loopFrom: c.start, loopEnd: c.loopEnd, onFail: () => this.track === yt && this.init(i + 1) });
        this.track = yt;
        await yt.ready;
        if (yt.failed) throw new Error('not embeddable');
        this.apply();
        if (this.wantPlay) yt.play();
        return;
      } catch (err) {
        console.warn(`[audio] ${this.name}: ${videoId} unavailable (${err.message}) → next source`);
        this.track?.destroy?.();
        this.track = null;
      }
    }
    await this.useLocal();
  }

  async useLocal() {
    if (this.track?.kind === 'html5') return;
    this.track?.destroy?.();
    this.track = null;
    if (!this.cfg.localSrc) return;
    const t = new Html5Track({ src: this.cfg.localSrc, loop: this.cfg.loop, loopFrom: this.cfg.start, loopEnd: this.cfg.loopEnd });
    try {
      await t.ready;
    } catch (err) {
      console.warn(`[audio] ${this.name}: no playable source (${err.message}) — running silently`);
      return;
    }
    this.track = t;
    t.seek(this.cfg.start);
    this.apply();
    if (this.wantPlay) t.play();
  }

  play({ fromStart = false } = {}) {
    this.wantPlay = true;
    this.pauseAtZero = false;
    if (!this.track) return;
    if (fromStart) this.track.seek(this.cfg.start);
    this.track.play();
  }

  fadeTo(target, seconds, pauseAtZero = false) {
    this.target = target;
    this.rate = 1 / Math.max(0.01, seconds);
    this.pauseAtZero = pauseAtZero;
    if (pauseAtZero) this.wantPlay = false;
  }

  apply() {
    this.track?.setVolume(this.gain * this.cfg.volume * this.director.duck * (this.director.muted ? 0 : 1));
  }

  tick(dt) {
    if (this.gain !== this.target) {
      const s = this.rate * dt;
      this.gain = this.gain < this.target ? Math.min(this.target, this.gain + s) : Math.max(this.target, this.gain - s);
    }
    this.apply();
    if (this.gain === 0 && this.pauseAtZero) {
      this.pauseAtZero = false;
      this.track?.pause();
    }
  }
}

/**
 * Four-phase soundtrack (identical in the cinematic and interactive modes):
 *   startPhase1() — inside the "Begin" click (autoplay policy): Spring Snow fades in
 *                   and loops, however long the walk, the catch, the picnic or the scarf take.
 *                   The other players are primed in the same click, so they can start later
 *                   without a gesture.
 *   toPhase2()    — the instant night falls: Bruno Mars' "Marry You" from the top, through the
 *                   fireworks and the group dance.
 *   toPhase3()    — the YES / NO question appears: Nezuko's Theme, looping while he decides
 *                   and through every NO (the beat-up).
 *   toPhase4()    — YES: Tanjiro's Theme, seeked to exactly 2:21, for the climax and THE END.
 *   duckTo(k)     — dips everything (the hush before the question).
 */
export class MusicDirector {
  constructor() {
    this.phase1 = new Channel('phase1', AUDIO.phase1, this);
    this.phase2 = new Channel('phase2', AUDIO.phase2, this);
    this.phase3 = new Channel('phase3', AUDIO.phase3, this);
    this.phase4 = new Channel('phase4', AUDIO.phase4, this);
    this.channels = [this.phase1, this.phase2, this.phase3, this.phase4];
    this.muted = false;
    this.duck = 1;
    this.duckTarget = 1;
    this.active = null;
    this.initPromise = null;
    this.timer = null;
  }

  /** Create every player early (silent) so they're buffered by the time they're needed. */
  init() {
    this.initPromise ??= Promise.all(this.channels.map((c) => c.init()));
    return this.initPromise;
  }

  /** Resolves once the players are ready (or have given up), or after `ms` — whichever is first. */
  ready(ms = 8000) {
    return Promise.race([this.init(), new Promise((r) => setTimeout(r, ms))]);
  }

  /**
   * Safety net for strict autoplay policies: if the music we want isn't
   * actually playing, (re)start it from inside any later user gesture.
   */
  nudge() {
    for (const ch of this.channels) if (ch.wantPlay && ch.track && !ch.track.isPlaying) ch.track.play();
  }

  /** Call synchronously inside a user gesture. */
  startPhase1() {
    this.init();
    const p = this.phase1;
    p.gain = 0;
    p.fadeTo(1, AUDIO.phase1.fadeIn);
    p.play({ fromStart: true });
    // unlock the later themes now, inside this click, each cued at its own start point
    for (const c of [this.phase2, this.phase3, this.phase4]) c.track?.prime?.(c.cfg.start);
    this.active = 'phase1';
    if (!this.timer) {
      let last = performance.now();
      // ticks on a timer, not rAF, so fades keep running in a background tab
      this.timer = setInterval(() => {
        const now = performance.now();
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        this.duck += Math.sign(this.duckTarget - this.duck) * Math.min(Math.abs(this.duckTarget - this.duck), dt * 0.8);
        for (const c of this.channels) c.tick(dt);
      }, 40);
    }
  }

  /** Crossfade from whatever is playing to `name`, starting it at its cue point. */
  crossTo(name, fade = AUDIO.crossfade) {
    if (this.active === name) return;
    const next = this[name];
    next.gain = 0;
    next.fadeTo(1, next.cfg.fadeIn);
    next.play({ fromStart: true }); // seeks to cfg.start: 0:00, or 2:21 for Tanjiro's Theme
    for (const c of this.channels) if (c !== next) c.fadeTo(0, fade, true);
    this.active = name;
  }

  toPhase2() {
    this.crossTo('phase2');
  }

  toPhase3() {
    this.duckTo(1);
    this.crossTo('phase3', 1.0);
  }

  toPhase4() {
    this.duckTo(1);
    this.crossTo('phase4', 0.7);
  }

  duckTo(k) {
    this.duckTarget = k;
  }

  setMuted(m) {
    this.muted = m;
  }

  dispose() {
    clearInterval(this.timer);
    for (const c of this.channels) c.track?.destroy();
  }
}
