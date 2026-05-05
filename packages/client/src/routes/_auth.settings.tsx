import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import React, { useState } from "react";

import { sessionAtom, SessionState, type UnlockedSession } from "../session.js";
import { Route as authRoute } from "./_auth.js";
import {
  changePasswordAtom,
  initialChangePasswordForm,
  isChangePasswordFormValid,
  setConfirmPassword,
  setNewPassword,
  setOldPassword,
} from "./_auth.settings.state.js";
import { rotateKeyAtom, type KeyRotationProgress } from "./_auth.settings.keyrotation.js";

export const Route = createRoute({
  getParentRoute: () => authRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and security preferences.</p>
      </div>
      <div className="flex flex-col gap-4">
        <ChangePasswordSection />
        <KeyRotationSection />
      </div>
    </div>
  );
}

function SettingsCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xs ring-1 ring-border">
      <h2 className="mb-1 text-base font-semibold text-foreground">{title}</h2>
      <p className="mb-5 text-sm text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}

// --- Change password ---

function ChangePasswordSection() {
  const [form, setForm] = useState(initialChangePasswordForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const changePassword = useAtomSet(changePasswordAtom, { mode: "promiseExit" });
  const setSession = useAtomSet(sessionAtom);
  const navigate = useNavigate();

  const passwordMismatch = form.newPassword.length > 0 && form.confirmPassword.length > 0 && form.newPassword !== form.confirmPassword;
  const valid = isChangePasswordFormValid(form);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    const exit = await changePassword(form);
    setLoading(false);
    if (exit._tag === "Success") {
      setSuccess(true);
      setSession(SessionState.LoggedOut());
      void navigate({ to: "/login" });
    } else {
      const cause = exit.cause;
      if (cause._tag === "Fail") {
        const err = cause.error as { message?: string; _tag?: string };
        setError(err._tag === "InvalidCredentialsError" ? "Current password is incorrect." : (err.message ?? "Password change failed."));
      } else {
        setError("Password change failed. Please try again.");
      }
    }
  }

  return (
    <SettingsCard title="Change password" description="Update your master password. All existing sessions will be invalidated.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Current password</span>
          <input id="old-password" type="password" autoComplete="current-password" value={form.oldPassword}
            onChange={(e) => setForm(setOldPassword(form, e.target.value))} className="input" required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">New password</span>
          <input id="new-password" type="password" autoComplete="new-password" value={form.newPassword}
            onChange={(e) => setForm(setNewPassword(form, e.target.value))} className="input" required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Confirm new password</span>
          <input id="confirm-password" type="password" autoComplete="new-password" value={form.confirmPassword}
            onChange={(e) => setForm(setConfirmPassword(form, e.target.value))}
            className={`input ${passwordMismatch ? "border-destructive focus-visible:ring-destructive/30" : ""}`} required />
          {passwordMismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-primary">Password changed. Redirecting to login…</p>}
        <div>
          <button type="submit" disabled={!valid || loading} className="btn-primary">
            {loading ? "Changing password…" : "Change password"}
          </button>
        </div>
      </form>
    </SettingsCard>
  );
}

// --- Key rotation ---

type RotationPhase = "idle" | "confirm" | "enter-password" | "rotating" | "done";

function KeyRotationSection() {
  const [phase, setPhase] = useState<RotationPhase>("idle");
  const [password, setPassword] = useState("");
  const [progress, setProgress] = useState<KeyRotationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rotateKey = useAtomSet(rotateKeyAtom, { mode: "promiseExit" });
  const setSession = useAtomSet(sessionAtom);
  const session = useAtomValue(sessionAtom) as UnlockedSession;

  async function handleRotate(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setPhase("rotating");
    setProgress(null);
    setError(null);
    const exit = await rotateKey({ password, onProgress: setProgress });
    if (exit._tag === "Success") {
      setSession(exit.value);
      setPhase("done");
      setPassword("");
    } else {
      const cause = exit.cause;
      if (cause._tag === "Fail") {
        const err = cause.error as { message?: string; _tag?: string };
        setError(err.message ?? "Key rotation failed.");
      } else {
        setError("Key rotation failed. Please try again.");
      }
      setPhase("enter-password");
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const phaseLabel: Record<KeyRotationProgress["phase"], string> = {
    "re-encrypting": "Re-encrypting documents…",
    uploading: "Uploading re-encrypted documents…",
    finalizing: "Finalizing…",
  };

  return (
    <SettingsCard
      title="Rotate encryption key"
      description="Generates a new data encryption key and re-encrypts all your documents. This operation cannot be interrupted once started."
    >
      {phase === "idle" && (
        <button type="button" onClick={() => setPhase("confirm")} className="btn-outline">
          Rotate key…
        </button>
      )}

      {phase === "confirm" && (
        <div className="rounded-lg border border-border bg-muted/60 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">
            Are you sure? This will re-encrypt every document you own. The process may take several minutes.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPhase("enter-password")} className="btn-primary">
              Continue
            </button>
            <button type="button" onClick={() => setPhase("idle")} className="btn-outline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "enter-password" && (
        <form onSubmit={handleRotate} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Enter your current password to authorise key rotation for <strong className="text-foreground">{session.username}</strong>.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Password</span>
            <input
              id="rotation-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              required
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={!password} className="btn-primary">
              Start rotation
            </button>
            <button type="button" onClick={() => { setPhase("idle"); setPassword(""); setError(null); }} className="btn-outline">
              Cancel
            </button>
          </div>
        </form>
      )}

      {phase === "rotating" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground">
            {progress ? phaseLabel[progress.phase] : "Starting…"}
            {progress && progress.total > 0 && (
              <span className="ml-2 text-muted-foreground">
                {progress.processed}/{progress.total}
              </span>
            )}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress?.phase === "finalizing" ? 100 : pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">Do not close this page.</p>
        </div>
      )}

      {phase === "done" && (
        <div className="rounded-lg border border-border bg-secondary/40 p-4">
          <p className="text-sm font-medium text-foreground">Key rotation complete. All documents have been re-encrypted.</p>
          <button type="button" onClick={() => setPhase("idle")} className="mt-3 btn-outline">
            Done
          </button>
        </div>
      )}
    </SettingsCard>
  );
}
