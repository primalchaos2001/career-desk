import { type ReactNode, useEffect, useId, useRef } from "react";

/** Small form and layout pieces shared by Career Desk screens. */

export function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`cd-button ${secondary ? "secondary" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  value,
  onChange,
  area = false,
  required = false,
  type = "text",
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  area?: boolean;
  required?: boolean;
  type?: string;
  hint?: string;
  placeholder?: string;
}) {
  const fieldId = useId();
  return (
    <label htmlFor={fieldId} className={`cd-field ${area ? "wide" : ""}`}>
      <span>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </span>
      {area ? (
        <textarea
          id={fieldId}
          aria-label={label}
          rows={5}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          maxLength={100_000}
        />
      ) : (
        <input
          id={fieldId}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          type={type}
          placeholder={placeholder}
          min={type === "number" ? 0 : undefined}
          step={type === "number" ? "any" : undefined}
          maxLength={2_000}
        />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="cd-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Empty({
  icon = "◎",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="cd-empty">
      <span className="cd-empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="cd-modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="cd-modal-head">
        <h2>{title}</h2>
        <button type="button" onClick={close} aria-label="Close dialog">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Chip({ children, tone = "" }: { children: ReactNode; tone?: string }) {
  return <span className={`cd-chip ${tone}`}>{children}</span>;
}
