import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Result from "@effect-atom/atom/Result";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Route as rootRoute } from "./__root.js";
import { confirmTotpAtom, registerAtom } from "./register.state.js";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: RegisterPage,
});

type Step = { readonly _tag: "Credentials" } | { readonly _tag: "Totp"; readonly username: string; readonly totpUri: string };

function RegisterPage() {
  const [step, setStep] = useState<Step>({ _tag: "Credentials" });
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-8 shadow-lg ring-1 ring-border">
        {step._tag === "Credentials" ? (
          <CredentialsStep onSuccess={(username, totpUri) => setStep({ _tag: "Totp", username, totpUri })} />
        ) : (
          <TotpStep username={step.username} totpUri={step.totpUri} />
        )}
      </div>
    </div>
  );
}

function CredentialsStep({ onSuccess }: { onSuccess: (username: string, totpUri: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const submit = useAtomSet(registerAtom, { mode: "promiseExit" });
  const result = useAtomValue(registerAtom);

  const isWaiting = Result.isWaiting(result);
  const error = Result.isFailure(result)
    ? Option.getOrElse(Option.map(Cause.failureOption(result.cause), (e) => e.message), () => "Registration failed.")
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return;
    const exit = await submit({ username, password });
    if (exit._tag === "Success") {
      onSuccess(exit.value.username, exit.value.totpUri);
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Create account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Set up your encrypted document vault.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Username">
          <input type="text" autoComplete="username" required value={username}
            onChange={(e) => setUsername(e.target.value)} className="input" />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="new-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} className="input" />
        </Field>
        <Field label="Confirm password">
          <input type="password" autoComplete="new-password" required value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className="input" />
          {password && confirm && password !== confirm && (
            <p className="mt-1 text-xs text-destructive">Passwords do not match.</p>
          )}
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={isWaiting || password !== confirm} className="btn-primary w-full">
          {isWaiting ? "Creating account…" : "Continue"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-primary hover:text-primary/80">Sign in</Link>
      </p>
    </>
  );
}

function TotpStep({ username, totpUri }: { username: string; totpUri: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const submit = useAtomSet(confirmTotpAtom, { mode: "promiseExit" });
  const result = useAtomValue(confirmTotpAtom);

  const isWaiting = Result.isWaiting(result);
  const error = Result.isFailure(result)
    ? Option.getOrElse(Option.map(Cause.failureOption(result.cause), (e) => e.message), () => "Invalid code.")
    : null;

  useEffect(() => {
    QRCode.toDataURL(totpUri, { width: 200 }).then(setQrDataUrl);
  }, [totpUri]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const exit = await submit({ payload: { username, totpCode: code } });
    if (exit._tag === "Success") void navigate({ to: "/login" });
  }

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-foreground">Set up authenticator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
        </p>
      </div>
      <div className="mb-5 flex justify-center rounded-lg bg-muted p-4">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="TOTP QR code" width={180} height={180} className="rounded" />
        ) : (
          <div className="h-[180px] w-[180px] animate-pulse rounded bg-border" />
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="6-digit code">
          <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required
            autoComplete="one-time-code" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="input text-center tracking-widest" />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={isWaiting || code.length !== 6} className="btn-primary w-full">
          {isWaiting ? "Verifying…" : "Confirm"}
        </button>
      </form>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
