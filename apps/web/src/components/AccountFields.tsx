import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled = false,
  policy = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
  policy?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <div className="account-password-control">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          required
          minLength={policy ? 12 : 1}
          maxLength={256}
          aria-describedby={policy ? `${id}-policy` : undefined}
        />
        <button
          type="button"
          className="account-password-reveal"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((previous) => !previous)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {policy && (
        <p className="account-field-hint" id={`${id}-policy`}>
          Use 12–128 characters. Spaces are allowed; control characters are not.
        </p>
      )}
    </div>
  );
}

export function passwordProblem(password: string): string | null {
  const characters = [...password];
  if (characters.length < 12 || characters.length > 128)
    return "Use a password between 12 and 128 characters.";
  if (/[\u0000-\u001f\u007f]/.test(password))
    return "Your password cannot contain control characters.";
  if (
    characters.some((character) => {
      const code = character.codePointAt(0)!;
      return code >= 0xd800 && code <= 0xdfff;
    })
  )
    return "Use valid Unicode characters in your password.";
  if (new TextEncoder().encode(password).length > 512)
    return "This password is too long when encoded. Use fewer characters.";
  return null;
}
