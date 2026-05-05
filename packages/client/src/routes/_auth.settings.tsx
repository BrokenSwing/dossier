import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { sessionAtom, SessionState } from "../session.js";
import { Route as authRoute } from "./_auth.js";
import {
  changePasswordAtom,
  initialChangePasswordForm,
  isChangePasswordFormValid,
  setConfirmPassword,
  setNewPassword,
  setOldPassword,
} from "./_auth.settings.state.js";

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
    </div>
  );
}

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
      // Server invalidated all sessions — log out immediately
      setSession(SessionState.LoggedOut());
      void navigate({ to: "/login" });
    } else {
      const cause = exit.cause;
      if (cause._tag === "Fail") {
        const err = cause.error as { message?: string; _tag?: string };
        if (err._tag === "InvalidCredentialsError") {
          setError("Current password is incorrect.");
        } else {
          setError(err.message ?? "Password change failed. Please try again.");
        }
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
          <label htmlFor="old-password" className="mb-1 block text-sm font-medium text-gray-700">
            Current password
          </label>
          <input
            id="old-password"
            type="password"
            autoComplete="current-password"
            value={form.oldPassword}
            onChange={(e) => setForm(setOldPassword(form, e.target.value))}
            className="input w-full"
            required
          />
        </div>
        <div>
          <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(e) => setForm(setNewPassword(form, e.target.value))}
            className="input w-full"
            required
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-gray-700">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setForm(setConfirmPassword(form, e.target.value))}
            className={`input w-full ${passwordMismatch ? "border-red-400 focus:ring-red-400" : ""}`}
            required
          />
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
