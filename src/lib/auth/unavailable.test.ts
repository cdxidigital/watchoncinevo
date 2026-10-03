import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_NOT_CONFIGURED_CODE,
  AUTH_NOT_CONFIGURED_MESSAGE,
  AuthNotConfiguredError,
  authDisabledForMissingSecret,
  authNotConfiguredResponse,
  isAuthNotConfiguredError,
} from "./unavailable.ts";

describe("authDisabledForMissingSecret", () => {
  it("disables auth in production when the secret is missing or blank", () => {
    assert.equal(authDisabledForMissingSecret("production", undefined), true);
    assert.equal(authDisabledForMissingSecret("production", ""), true);
    assert.equal(authDisabledForMissingSecret("production", "   "), true);
  });

  it("keeps auth on in production when a real secret is set", () => {
    assert.equal(authDisabledForMissingSecret("production", "injected-secret"), false);
  });

  it("does not disable auth outside production, even with no secret", () => {
    assert.equal(authDisabledForMissingSecret("development", undefined), false);
    assert.equal(authDisabledForMissingSecret("test", undefined), false);
    assert.equal(authDisabledForMissingSecret(undefined, undefined), false);
  });
});

describe("authNotConfiguredResponse", () => {
  it("returns 503 with the stable code and message", async () => {
    const response = authNotConfiguredResponse();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      code: AUTH_NOT_CONFIGURED_CODE,
      message: AUTH_NOT_CONFIGURED_MESSAGE,
    });
    assert.equal(
      AUTH_NOT_CONFIGURED_MESSAGE,
      "Sign-in is unavailable: authentication is not configured on this server.",
    );
  });

  it("recognises AuthNotConfiguredError across a rethrow boundary", () => {
    const error = new AuthNotConfiguredError();
    assert.equal(error.status, 503);
    assert.equal(error.code, AUTH_NOT_CONFIGURED_CODE);
    assert.equal(isAuthNotConfiguredError(error), true);
    const cloned = new Error(error.message);
    cloned.name = "AuthNotConfiguredError";
    assert.equal(isAuthNotConfiguredError(cloned), true);
    assert.equal(isAuthNotConfiguredError(new Error("nope")), false);
  });
});
