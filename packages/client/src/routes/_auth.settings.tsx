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
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
      <ChangePasswordSection />
      <hr className="border-gray-200" />
      <KeyRotationSection />
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
    <section className="max-w-md">
      <h2 className="mb-4 text-base font-semibold text-gray-900">Change password</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="old-password" className="mb-1 block text-sm font-medium text-gray-700">Current password</label>
          <input id="old-password" type="password" autoComplete="current-password" value={form.oldPassword}
            onChange={(e) => setForm(setOldPassword(form, e.target.value))} className="input w-full" required />
        </div>
        <div>
          <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" value={form.newPassword}
            onChange={(e) => setForm(setNewPassword(form, e.target.value))} className="input w-full" required />
        </div>
        <div>
          <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-gray-700">Confirm new password</label>
          <input id="confirm-password" type="password" autoComplete="new-password" value={form.confirmPassword}
            onChange={(e) => setForm(setConfirmPassword(form, e.target.value))}
            className={`input w-full ${passwordMismatch ? "border-red-400 focus:ring-red-400" : ""}`} required />
          {passwordMismatch && <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">Password changed. Redirecting to login…</p>}
        <div>
          <button type="submit" disabled={!valid || loading} className="btn btn-primary">
            {loading ? "Changing password…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
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
    <section className="max-w-md">
      <h2 className="mb-1 text-base font-semibold text-gray-900">Rotate encryption key</h2>
      <p className="mb-4 text-sm text-gray-500">
        Generates a new data encryption key and re-encrypts all your documents. This operation cannot be interrupted once started.
      </p>

      {phase === "idle" && (
        <button type="button" onClick={() => setPhase("confirm")} className="btn btn-secondary">
          Rotate key…
        </button>
      )}

      {phase === "confirm" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-3 text-sm font-medium text-amber-800">
            Are you sure? This will re-encrypt every document you own. The process may take several minutes.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPhase("enter-password")} className="btn btn-primary">
              Continue
            </button>
            <button type="button" onClick={() => setPhase("idle")} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "enter-password" && (
        <form onSubmit={handleRotate} className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Enter your current password to authorise key rotation for <strong>{session.username}</strong>.
          </p>
          <div>
            <label htmlFor="rotation-password" className="mb-1 block text-sm font-medium text-gray-700">Password</label>
            <input
              id="rotation-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={!password} className="btn btn-primary">
              Start rotation
            </button>
            <button type="button" onClick={() => { setPhase("idle"); setPassword(""); setError(null); }} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {phase === "rotating" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-700">
            {progress ? phaseLabel[progress.phase] : "Starting…"}
            {progress && progress.total > 0 && (
              <span className="ml-2 text-gray-400">
                {progress.processed}/{progress.total}
              </span>
            )}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progress?.phase === "finalizing" ? 100 : pct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">Do not close this page.</p>
        </div>
      )}

      {phase === "done" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">Key rotation complete. All documents have been re-encrypted.</p>
          <button type="button" onClick={() => setPhase("idle")} className="mt-3 btn btn-secondary">
            Done
          </button>
        </div>
      )}
    </section>
  );
}
