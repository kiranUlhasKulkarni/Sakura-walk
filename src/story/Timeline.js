/**
 * The story's state machine. Acts are plain objects:
 *   { name, enter(ctx) → Promise|void, update(dt, t, ctx), exit(ctx) }
 * When an act's enter() promise resolves (its scripted beats are done) the
 * timeline advances automatically; `goto(name)` jumps (debug / interaction
 * branches like the YES / NO choice). Every act gets its own disposables bag
 * (ctx.bag) emptied on exit, so props, lights and listeners an act created
 * are freed when the scene moves on.
 */
export class Timeline {
  constructor(ctx) {
    this.ctx = ctx;
    this.acts = [];
    this.index = -1;
    this.current = null;
    this.t = 0;
    this.token = 0;
    this.onChange = null;
  }

  add(act) {
    this.acts.push(act);
    return this;
  }

  start(name) {
    return this.goto(name ?? this.acts[0].name);
  }

  async goto(name) {
    const i = this.acts.findIndex((a) => a.name === name);
    if (i < 0) throw new Error(`[timeline] no act "${name}"`);
    this.exitCurrent();
    this.index = i;
    this.current = this.acts[i];
    this.t = 0;
    const token = ++this.token;
    const bag = (this.ctx.bag = []);
    this.onChange?.(this.current.name, i);
    await this.current.enter?.(this.ctx);
    // advance only if nothing else (a goto) happened meanwhile. In the interactive mode a scene
    // the player triggered hands control back (to the free-roam act) instead of rolling on.
    if (token === this.token && !this.current.hold) {
      // (an act can name its own successor: Act IV always leads into Act V)
      const next = this.current.next ?? (this.ctx.interactive && this.current.name !== 'free' && this.acts.some((a) => a.name === 'free') ? 'free' : this.acts[i + 1]?.name);
      if (next) this.goto(next);
    }
    return bag;
  }

  exitCurrent() {
    if (!this.current) return;
    this.current.exit?.(this.ctx);
    for (const d of this.ctx.bag ?? []) (typeof d === 'function' ? d() : d?.dispose?.());
    this.ctx.bag = [];
  }

  next() {
    if (this.acts[this.index + 1]) this.goto(this.acts[this.index + 1].name);
  }

  update(dt) {
    this.t += dt;
    this.current?.update?.(dt, this.t, this.ctx);
  }

  /** After the cast is posed this frame (props that ride on hands etc.). */
  lateUpdate(dt) {
    this.current?.late?.(dt, this.t, this.ctx);
  }
}

/** Await helper for scripted beats (runs on the render clock, so it respects pauses). */
export function wait(ctx, seconds) {
  return new Promise((resolve) => ctx.clock.after(seconds, resolve));
}
