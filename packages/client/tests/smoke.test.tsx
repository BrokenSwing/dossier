import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("test pipeline", () => {
  it("runs unit assertions", () => {
    expect(1 + 1).toBe(2);
  });

  it("renders React components", () => {
    render(<p>hello dossier</p>);
    expect(screen.getByText("hello dossier")).toBeInTheDocument();
  });

  it("has access to Web Crypto API", () => {
    expect(typeof crypto.subtle).toBe("object");
  });
});
