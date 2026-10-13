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

export function TouchControls({ input, mode }: { input: DriveInput; mode: 'buttons' | 'joystick' }) {
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
