import { describe, expect, it } from "vitest";
import { classifyAddonErrorHint } from "./addon-iframe-manager";

describe("classifyAddonErrorHint", () => {
  it("classifies opaque-origin Web Storage failures as a storage hint", () => {
    const securityError =
      "SecurityError: Failed to read the 'localStorage' property from 'Window': " +
      "The document is sandboxed and lacks the 'allow-same-origin' flag.";
    expect(classifyAddonErrorHint(securityError)).toContain("storage API");

    expect(classifyAddonErrorHint("Uncaught SecurityError accessing sessionStorage")).toContain(
      "storage API",
    );
  });

  it("classifies unknown host API calls as a version-mismatch hint", () => {
    expect(classifyAddonErrorHint("Unknown addon host API method 'foo.bar'")).toContain(
      "Update the add-on",
    );
  });

  it("returns undefined for unrecognized or empty errors", () => {
    expect(classifyAddonErrorHint(undefined)).toBeUndefined();
    expect(classifyAddonErrorHint("")).toBeUndefined();
    expect(classifyAddonErrorHint("TypeError: cannot read property 'x' of null")).toBeUndefined();
  });
});
