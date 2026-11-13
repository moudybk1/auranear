'use client';

// Button, Badge, TextField, Card and Alert are ports of aura-brand-kit/components/bundle.js:
// same class names, same behaviour. Segmented, Dialog, Delta and Skeleton follow
// docs/FRONTEND_SPEC.md §6 and use the same tokens.

import { ArrowDownRight, ArrowUpRight, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { DEMO } from '../lib/config';
import { useAura } from '../lib/store';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

type Tone = 'info' | 'success' | 'warning' | 'danger';

/** Status icons with the kit's geometry (20px, 1.75 stroke, round caps). */
export function StatusIcon({ tone, size = 20 }: { tone: Tone; size?: number }) {
  const paths = {
    info: ['M12 16v-4', 'M12 8h.01'],
    success: ['M8.5 12.5l2.5 2.5 4.5-5'],
    warning: ['M12 9v4', 'M12 17h.01'],
    danger: ['M15 9l-6 6', 'M9 9l6 6'],
  }[tone];
  return (
    <svg
      className="aura-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {tone === 'warning' ? (
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      ) : (
        <circle cx={12} cy={12} r={9.5} />
      )}
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('aura-btn', `aura-btn--${variant}`, `aura-btn--${size}`, loading && 'is-loading', className)}
    >
      {loading && <span className="aura-spinner" aria-hidden />}
      <span>{children}</span>
    </button>
  );
}

export function Badge({
  tone = 'neutral', dot, className, children,
}: { tone?: 'neutral' | 'aura' | 'success' | 'warning' | 'info'; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cx('aura-badge', `aura-badge--${tone}`, className)}>
      {dot && <span className="aura-badge__dot" aria-hidden />}
      {children}
    </span>
  );
}

export function Alert({ tone = 'info', title, className, children }: { tone?: Tone; title?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cx('aura-alert', `aura-alert--${tone}`, className)}>
      <StatusIcon tone={tone} />
      <div className="aura-alert__content">
        {title && <p className="aura-alert__title">{title}</p>}
        {children && <div className="aura-alert__body">{children}</div>}
      </div>
    </div>
  );
}

export function Card({ title, footer, glow, className, children }: { title?: React.ReactNode; footer?: React.ReactNode; glow?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section className={cx('aura-card', glow && 'aura-card--glow', className)}>
      {title && <h2 className="aura-card__title">{title}</h2>}
      <div className="aura-card__body">{children}</div>
      {footer && <div className="aura-card__footer">{footer}</div>}
    </section>
  );
}

type Option<V extends string> = { value: V; label: React.ReactNode; tone?: string };

/** Tab list with roving focus: left and right arrows move and select. */
export function Segmented<V extends string>({
  value, onChange, options, label, className, itemClassName = 'seg__item',
}: { value: V; onChange: (v: V) => void; options: Option<V>[]; label: string; className?: string; itemClassName?: string }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (options.findIndex((o) => o.value === value) + step + options.length) % options.length;
    onChange(options[next].value);
    (e.currentTarget.children[next] as HTMLElement).focus();
  };
  return (
    <div role="tablist" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value} type="button" role="tab" aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1} data-tone={o.tone} className={itemClassName}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Native <dialog>: focus is trapped and Esc closes without extra code. Content mounts only while open. */
export function Dialog({
  open, onClose, title, closeLabel, children,
}: { open: boolean; onClose: () => void; title: React.ReactNode; closeLabel: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // A wallet draws its signing step as a normal element in <body>. A modal dialog sits in the browser's top layer,
  // above it, and makes it inert. So the dialog steps aside while a live transaction waits for the wallet. Its
  // content stays mounted (the typed amount survives) and it comes back if the transaction fails.
  const { pending } = useAura();
  const show = open && !(pending && !DEMO);
  const steppedAside = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (show && !el.open) {
      el.showModal();
      el.querySelector('input')?.focus(); // showModal lands on the close button otherwise
    }
    if (!show && el.open) {
      steppedAside.current = open; // the close event that follows is not the user closing the dialog
      el.close();
    }
  }, [show, open]);
  return (
    <dialog
      ref={ref} className="dlg" aria-labelledby={titleId}
      onClose={() => {
        if (steppedAside.current) steppedAside.current = false;
        else onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="dlg__inner">
          <div className="dlg__head">
            <h2 id={titleId} className="dlg__title">{title}</h2>
            <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}>
              <X size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** A signed value: arrow plus colour class. The caller supplies text that already carries its sign. */
export function Delta({ sign, children }: { sign: number; children: React.ReactNode }) {
  const Icon = sign > 0 ? ArrowUpRight : sign < 0 ? ArrowDownRight : null;
  return (
    <span className={cx('delta num', sign > 0 ? 'up' : sign < 0 ? 'down' : 'flat')}>
      {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden />}
      {children}
    </span>
  );
}

export const Skeleton = ({ width }: { width?: number }) => <span className="skel" style={{ width }} aria-hidden />;

export function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

/** Current time in seconds, refreshed every second. For "updated 12s ago" labels. */
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export const Unit = ({ children = 'USDC' }: { children?: React.ReactNode }) => <span className="unit">{children}</span>;
