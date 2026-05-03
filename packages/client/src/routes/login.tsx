import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Result from "@effect-atom/atom/Result";
import { createRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { useState } from "react";

import { type LockedSession, sessionAtom, SessionState } from "../session.js";
import { Route as rootRoute } from "./__root.js";
import { loginAtom, unlockAtom } from "./login.state.js";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: ({ context }) => {
    const session = context.registry.get(sessionAtom);
    if (session._tag === "Unlocked") throw redirect({ to: "/" });
  },
  component: LoginPage,
});

// --- Component ---

function LoginPage() {
  const session = useAtomValue(sessionAtom);
  if (session._tag === "Locked") return <UnlockForm session={session} />;
  return <LoginForm />;
}

// --- Login form ---

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const navigate = useNavigate();
  const submit = useAtomSet(loginAtom, { mode: "promiseExit" });
  const result = useAtomValue(loginAtom);
  const setSession = useAtomSet(sessionAtom);

  const isWaiting = Result.isWaiting(result);
  const error = Result.isFailure(result)
    ? Option.getOrElse(Option.map(Cause.failureOption(result.cause), (e) => e.message), () => "Login failed.")
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const exit = await submit({ username, password, totpCode });
    if (exit._tag === "Success") {
      setSession(exit.value);
      void navigate({ to: "/" });
    }
  }

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold text-gray-900">Sign in to Dossier</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Username">
          <input
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Authenticator code">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
            className="input text-center tracking-widest"
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={isWaiting || totpCode.length !== 6} className="btn-primary">
          {isWaiting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        Don&apos;t have an account?{" "}
        <Link to="/register" className="font-medium text-blue-600 hover:text-blue-500">
          Create one
        </Link>
      </p>
    </>
  );
}

// --- Unlock form ---

function UnlockForm({ session }: { session: LockedSession }) {
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const submit = useAtomSet(unlockAtom, { mode: "promiseExit" });
  const result = useAtomValue(unlockAtom);
  const setSession = useAtomSet(sessionAtom);

  const isWaiting = Result.isWaiting(result);
  const error = Result.isFailure(result)
    ? Option.getOrElse(Option.map(Cause.failureOption(result.cause), (e) => e.message), () => "Incorrect password.")
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const exit = await submit({ password });
    if (exit._tag === "Success") {
      setSession(exit.value);
      void navigate({ to: "/" });
    }
  }

  return (
    <>
      <h1 className="mb-2 text-xl font-semibold text-gray-900">Welcome back, {session.username}</h1>
      <p className="mb-6 text-sm text-gray-500">Enter your password to unlock your vault.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={isWaiting} className="btn-primary">
          {isWaiting ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        Not {session.username}?{" "}
        <button
          type="button"
          onClick={() => setSession(SessionState.LoggedOut())}
          className="font-medium text-blue-600 hover:text-blue-500"
        >
          Sign out
        </button>
      </p>
    </>
  );
}

// --- Shared UI primitives ---

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}
