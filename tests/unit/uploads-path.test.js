"use strict";

// UPLOADS.getTargetPath: a client-supplied path must resolve inside the upload root.

const path = require("path");

global.CONFIG = { ...global.CONFIG, storage: { ...(global.CONFIG.storage || {}), base_path: "uploads" } };
const UPLOADS = require("../../api/controllers/uploads");

const root = path.resolve(UPLOADS.baseUploadFolder());

describe("UPLOADS.getTargetPath", () => {
	test("normal relative paths resolve under the root", () => {
		expect(UPLOADS.getTargetPath("tenant/2026/a.png")).toBe(path.join(root, "tenant/2026/a.png"));
	});

	test("the encrypted suffix is appended", () => {
		expect(UPLOADS.getTargetPath("a.png", true)).toBe(path.join(root, "a.png.enc"));
	});

	test("dot segments that stay inside the root are fine", () => {
		expect(UPLOADS.getTargetPath("a/../b.png")).toBe(path.join(root, "b.png"));
	});

	test.each([
		"../config.json",
		"../../etc/passwd",
		"a/../../secret",
		"/etc/passwd",
		"..",
		"a/../../" + path.basename(root) + "-sibling/x"
	])("rejects %s", (p) => {
		expect(() => UPLOADS.getTargetPath(p)).toThrow(/Invalid file path/);
	});

	test("a sibling directory that merely shares the root's name as a prefix is outside it", () => {
		expect(() => UPLOADS.getTargetPath("../" + path.basename(root) + "2/x")).toThrow(/Invalid file path/);
	});
});
