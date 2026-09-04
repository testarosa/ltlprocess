import assert from "node:assert/strict";
import { isValidUsZipCode } from "./locations.js";

assert.equal(isValidUsZipCode("00601"), true);
assert.equal(isValidUsZipCode("90210"), true);
assert.equal(isValidUsZipCode("9021"), false);
assert.equal(isValidUsZipCode("90210-1234"), false);
assert.equal(isValidUsZipCode("ABCDE"), false);

console.log("Location ZIP validation tests passed.");
