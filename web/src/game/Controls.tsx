import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { DriveInput } from './vehicle';
import { useI18n } from '../i18n';
import { Icon } from '../icons';

/** A button that stays pressed while any pointer holds it (multi-touch safe). */
function HoldPad({
  className,
  onChange,
  children,
  label,
}: {
  className: string;
  onChange: (down: boolean) => void;
  children: React.ReactNode;
  label: string;
}) {
  const [on, setOn] = useState(false);
  const pointers = useRef(new Set<number>());
  const update = () => {
    const down = pointers.current.size > 0;
    setOn(down);
    onChange(down);
  };
  return (
    <button
      type="button"
      aria-label={label}
      className={`pad ${className} ${on ? 'on' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.add(e.pointerId);
        update();
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        update();
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        update();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

function Joystick({ input }: { input: DriveInput }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const move = (e: RPointerEvent) => {
    const el = ref.current;
    if (!el || active.current !== e.pointerId) return;
    const r = el.getBoundingClientRect();
    const max = r.width / 2 - 20;
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    setKnob({ x: dx, y: dy });
    const nx = dx / max;
    const ny = -dy / max;
    input.steer = Math.abs(nx) < 0.12 ? 0 : nx;
    input.throttle = ny > 0.15 ? Math.min(1, ny * 1.2) : 0;
    input.brake = ny < -0.25 ? Math.min(1, -ny * 1.2) : 0;
  };
  const release = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    input.steer = 0;
    input.throttle = 0;
    input.brake = 0;
  };
  return (
    <div
      ref={ref}
      className="joy"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        active.current = e.pointerId;
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

/** Turn-to-steer wheel (or handlebar): drag around the centre; it springs back when released. */
function SteerWheel({ input, car }: { input: DriveInput; car: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [turn, setTurn] = useState(0);
  const active = useRef<{ id: number; start: number; base: number } | null>(null);
  const MAX = 110;
  const angleOf = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const move = (e: RPointerEvent) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    let d = angleOf(e) - a.start;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    const t = Math.max(-MAX, Math.min(MAX, a.base + d));
    setTurn(t);
    input.steer = Math.abs(t) < 6 ? 0 : t / MAX;
  };
  const release = () => {
    active.current = null;
    setTurn(0);
    input.steer = 0;
  };
  return (
    <div
      ref={ref}
      className={`wheelpad ${active.current ? 'on' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        active.current = { id: e.pointerId, start: angleOf(e), base: turn };
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <svg viewBox="0 0 100 100" style={{ transform: `rotate(${turn}deg)`, transition: active.current ? 'none' : 'transform 0.18s ease-out' }}>
        {car ? (
          <g fill="none" stroke="rgba(243,239,232,0.92)" strokeLinecap="round">
            <circle cx="50" cy="50" r="38" strokeWidth="8" />
            <circle cx="50" cy="50" r="9" strokeWidth="6" />
            <path d="M12 52 H41 M59 52 H88 M50 59 V88" strokeWidth="7" />
          </g>
        ) : (
          <g fill="none" stroke="rgba(243,239,232,0.92)" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 46 Q20 38 34 48 L50 50 L66 48 Q80 38 92 46" strokeWidth="7" />
            <path d="M8 46 L4 54 M92 46 L96 54" strokeWidth="9" />
            <circle cx="50" cy="56" r="7" strokeWidth="5" />
          </g>
        )}
      </svg>
    </div>
  );
}

export type ControlMode = 'buttons' | 'joystick' | 'wheel';

export function TouchControls({ input, mode, car }: { input: DriveInput; mode: ControlMode; car: boolean }) {
  const { lang } = useI18n();
  const steer = useRef({ left: false, right: false });
  const applySteer = () => {
    input.steer = (steer.current.right ? 1 : 0) - (steer.current.left ? 1 : 0);
  };
  return (
    <>
      <div className="ctrl left" dir="ltr">
        {mode === 'joystick' ? (
          <Joystick input={input} />
        ) : mode === 'wheel' ? (
          <SteerWheel input={input} car={car} />
        ) : (
          <>
            <HoldPad
              className="steer"
              label={lang === 'ar' ? 'يسار' : 'Steer left'}
              onChange={(d) => {
                steer.current.left = d;
                applySteer();
              }}
            >
              <Icon name="chevronLeft" size={30} strokeWidth={2} />
            </HoldPad>
            <HoldPad
              className="steer"
              label={lang === 'ar' ? 'يمين' : 'Steer right'}
              onChange={(d) => {
                steer.current.right = d;
                applySteer();
              }}
            >
              <Icon name="chevronRight" size={30} strokeWidth={2} />
            </HoldPad>
          </>
        )}
      </div>
      <div className="ctrl right" dir="ltr">
        <HoldPad className="brake" label="brake" onChange={(d) => (input.brake = d ? 1 : 0)}>
          <span>
            <Icon name="minus" size={26} strokeWidth={2.4} />
            <span className="lbl">{lang === 'ar' ? 'فرامل' : 'BRAKE'}</span>
          </span>
        </HoldPad>
        <HoldPad className="gas" label="throttle" onChange={(d) => (input.throttle = d ? 1 : 0)}>
          <span>
            <Icon name="chevronUp" size={28} strokeWidth={2.2} />
            <Icon name="chevronUp" size={28} strokeWidth={2.2} style={{ marginTop: -16, opacity: 0.6 }} />
            <span className="lbl">{lang === 'ar' ? 'وقود' : 'GAS'}</span>
          </span>
        </HoldPad>
      </div>
    </>
  );
}
