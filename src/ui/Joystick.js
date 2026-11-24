/**
 * An on-screen thumbstick for phones and tablets (coarse pointers): drag the
 * knob to walk / run in the interactive mode. It speaks the same language as
 * the keyboard — it presses and releases W / A / S / D (KeyboardEvents on
 * window) — so the controller, the catch game and everything else that
 * listens for WASD work on touch screens unchanged. One finger elsewhere on
 * the screen still drags the camera round.
 */
const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };

export class Joystick {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'stick';
    this.el.innerHTML = '<span class="stick__knob"></span>';
    document.body.appendChild(this.el);
    this.knob = this.el.firstChild;
    this.held = new Set();
    this.id = null;
    const R = 46;
    const press = (code, on) => {
      if (on === this.held.has(code)) return;
      if (on) this.held.add(code);
      else this.held.delete(code);
      dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code.slice(3).toLowerCase() }));
    };
    const move = (e) => {
      const r = this.el.getBoundingClientRect();
      let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(x, y);
      if (l > R) {
        x *= R / l;
        y *= R / l;
      }
      this.knob.style.transform = `translate(${x}px, ${y}px)`;
      const k = 0.38 * R;
      press(KEYS.up, y < -k);
      press(KEYS.down, y > k);
      press(KEYS.left, x < -k);
      press(KEYS.right, x > k);
    };
    const end = (e) => {
      if (e.pointerId !== this.id) return;
      this.id = null;
      this.knob.style.transform = '';
      for (const c of [...this.held]) press(c, false);
    };
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.id = e.pointerId;
      this.el.setPointerCapture?.(e.pointerId);
      move(e);
    });
    this.el.addEventListener('pointermove', (e) => e.pointerId === this.id && move(e));
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  /** Shown only on touch screens, and only while the player is in control. */
  show(on) {
    this.el.classList.toggle('stick--on', on);
    if (!on) for (const c of [...this.held]) dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    if (!on) this.held.clear();
  }
}

export const isTouch = () => matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
