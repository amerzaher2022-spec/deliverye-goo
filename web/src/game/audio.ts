// Game sound, synthesised with the Web Audio API (no sound files): the engine (pitch and load follow
// revs and throttle; a scooter's single cylinder, a car's four), tyre squeal when sliding, brakes,
// impacts (a knock for a small bump, a crunch and glass for a crash), rain on the street, and horns of
// the traffic around. Starts on the first touch or key press (browsers block sound before that).

export type EngineKind = 'scooter' | 'car' | 'bicycle';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private eng: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private rainNode: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private tyre: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wind: { gain: GainNode } | null = null;
  private kind: EngineKind = 'scooter';
  private _muted = false;
  private volume = 0.8;

  constructor() {
    const start = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', start, { passive: true });
    window.addEventListener('keydown', start);
    this.unbind = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    try {
      this._muted = localStorage.getItem('dg.mute') === '1';
    } catch {
      /* ignore */
    }
  }

  private unbind: () => void;

  get muted() {
    return this._muted;
  }

  setMuted(m: boolean) {
    this._muted = m;
    try {
      localStorage.setItem('dg.mute', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  private ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    // two seconds of white noise, shared by rain, tyres, wind and impacts
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.rainNode = this.loopNoise('lowpass', 3200, 0.6);
    this.tyre = this.loopNoise('bandpass', 1900, 7);
    this.wind = this.loopNoise('lowpass', 500, 0.5);
    this.buildEngine();
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    return { gain, filter };
  }

  private buildEngine() {
    const ctx = this.ctx!;
    if (this.eng) {
      for (const o of this.eng.osc) o.stop();
      this.eng.gain.disconnect();
      this.eng = null;
    }
    if (this.kind === 'bicycle') return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(this.master!);
    // fundamental (firing rate) plus a rough upper harmonic
    const osc = [ctx.createOscillator(), ctx.createOscillator()];
    osc[0]!.type = 'sawtooth';
    osc[1]!.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    osc[0]!.connect(filter);
    osc[1]!.connect(g2).connect(filter);
    for (const o of osc) o.start();
    this.eng = { osc, gain, filter };
  }

  setVehicle(kind: EngineKind) {
    if (kind === this.kind) return;
    this.kind = kind;
    if (this.ctx) this.buildEngine();
  }

  /**
   * Called every frame. `rpm` 0..1 (idle..redline), `throttle` 0..1, `running` false when the engine is
   * off (after a crash), `slip` 0..1 tyre slide, `speed` m/s for wind, `rain` 0..1.
   */
  update(s: { rpm: number; throttle: number; running: boolean; slip: number; speed: number; rain: number }) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (this.eng) {
      const car = this.kind === 'car';
      // firing frequency: a scooter idles near 1500 rpm (single cylinder), a car near 800 rpm (four)
      const rpm = car ? 800 + s.rpm * 5200 : 1500 + s.rpm * 7000;
      const fire = car ? (rpm / 60) * 2 : rpm / 60 / 2;
      this.eng.osc[0]!.frequency.setTargetAtTime(fire, t, 0.04);
      this.eng.osc[1]!.frequency.setTargetAtTime(fire * 2.01, t, 0.04);
      this.eng.filter.frequency.setTargetAtTime(300 + s.rpm * 1400 + s.throttle * 900, t, 0.05);
      const level = s.running ? (car ? 0.06 : 0.075) * (0.45 + 0.4 * s.throttle + 0.25 * s.rpm) : 0;
      this.eng.gain.gain.setTargetAtTime(level, t, s.running ? 0.05 : 0.25);
    }
    this.tyre?.gain.gain.setTargetAtTime(Math.min(1, s.slip) * 0.16, t, 0.05);
    this.wind?.gain.gain.setTargetAtTime(Math.min(0.12, (s.speed / 25) ** 2 * 0.12), t, 0.2);
    if (this.rainNode) {
      this.rainNode.gain.gain.setTargetAtTime(s.rain * 0.13, t, 0.4);
      this.rainNode.filter.frequency.setTargetAtTime(2200 + s.rain * 2200, t, 0.4);
    }
  }

  /** A short noise burst through a filter, shaped by an envelope. */
  private burst(freq: number, q: number, dur: number, level: number, type: BiquadFilterType = 'bandpass', delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private thump(freq: number, dur: number, level: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** An impact: `severity` 0..1 (a kerb tap to a hard crash). */
  impact(severity: number) {
    const s = Math.max(0.05, Math.min(1, severity));
    this.thump(110 - s * 50, 0.15 + s * 0.35, 0.25 + s * 0.5);
    this.burst(900 + s * 600, 0.8, 0.08 + s * 0.4, 0.15 + s * 0.6, 'bandpass');
    if (s > 0.55) {
      // metal and breaking glass
      this.burst(3500, 3, 0.5, 0.25, 'bandpass', 0.03);
      this.burst(6500, 5, 0.6, 0.18, 'highpass', 0.06);
    }
  }

  /** Brake squeak at the start of hard braking. */
  brake(strength: number) {
    this.burst(2600, 9, 0.25 + strength * 0.3, 0.05 + strength * 0.06);
  }

  /** The starter turning the engine over, then catching. */
  starter() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    for (let i = 0; i < 4; i++) this.burst(220, 2, 0.09, 0.2, 'lowpass', i * 0.11);
  }

  /** A horn at `distance` metres (traffic) or the player's own (distance 0). */
  horn(distance = 0, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const level = 0.12 / (1 + distance / 12);
    if (level < 0.004) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.02);
    const dur = 0.25 + Math.random() * 0.35;
    g.gain.setValueAtTime(level, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800 / (1 + distance / 60);
    f.connect(g).connect(this.master!);
    for (const hz of [415 * pitch, 523 * pitch]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  dispose() {
    this.unbind();
    void this.ctx?.close();
    this.ctx = null;
  }
}
