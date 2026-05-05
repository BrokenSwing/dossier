import { describe, expect, it } from "vitest";

import {
  initialChangePasswordForm,
  isChangePasswordFormValid,
  setConfirmPassword,
  setNewPassword,
  setOldPassword,
  type ChangePasswordForm,
} from "../../src/routes/_auth.settings.state.js";

const base: ChangePasswordForm = {
  oldPassword: "oldpass",
  newPassword: "newpass",
  confirmPassword: "newpass",
};

describe("setOldPassword", () => {
  it("updates oldPassword", () => {
    expect(setOldPassword(base, "changed").oldPassword).toBe("changed");
  });

  it("preserves other fields", () => {
    const r = setOldPassword(base, "x");
    expect(r.newPassword).toBe(base.newPassword);
    expect(r.confirmPassword).toBe(base.confirmPassword);
  });
});

describe("setNewPassword", () => {
  it("updates newPassword", () => {
    expect(setNewPassword(base, "updated").newPassword).toBe("updated");
  });

  it("preserves other fields", () => {
    const r = setNewPassword(base, "x");
    expect(r.oldPassword).toBe(base.oldPassword);
    expect(r.confirmPassword).toBe(base.confirmPassword);
  });
});

describe("setConfirmPassword", () => {
  it("updates confirmPassword", () => {
    expect(setConfirmPassword(base, "confirmed").confirmPassword).toBe("confirmed");
  });

  it("preserves other fields", () => {
    const r = setConfirmPassword(base, "x");
    expect(r.oldPassword).toBe(base.oldPassword);
    expect(r.newPassword).toBe(base.newPassword);
  });
});

describe("isChangePasswordFormValid", () => {
  it("returns true when all fields match and non-empty", () => {
    expect(isChangePasswordFormValid(base)).toBe(true);
  });

  it("returns false when oldPassword is empty", () => {
    expect(isChangePasswordFormValid({ ...base, oldPassword: "" })).toBe(false);
  });

  it("returns false when newPassword is empty", () => {
    expect(isChangePasswordFormValid({ ...base, newPassword: "" })).toBe(false);
  });

  it("returns false when confirmPassword is empty", () => {
    expect(isChangePasswordFormValid({ ...base, confirmPassword: "" })).toBe(false);
  });

  it("returns false when newPassword and confirmPassword do not match", () => {
    expect(isChangePasswordFormValid({ ...base, confirmPassword: "different" })).toBe(false);
  });

  it("returns false on initial empty form", () => {
    expect(isChangePasswordFormValid(initialChangePasswordForm)).toBe(false);
  });
});
