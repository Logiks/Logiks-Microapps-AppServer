"use strict";

// UPLOADS.sanitizeFileName / getDestinyPath: client-supplied names must not reach disk or files_tbl as-is.

const path = require("path");

global.CONFIG = { ...global.CONFIG, storage: { ...(global.CONFIG.storage || {}), base_path: "uploads" } };
const UPLOADS = require("../../api/controllers/uploads");

describe("UPLOADS.sanitizeFileName", () => {
	test("replaces commas and special characters", () => {
		expect(UPLOADS.sanitizeFileName("my file, (final) #1.pdf")).toBe("my_file_final_1.pdf");
	});
	test("strips directory parts, posix and windows", () => {
		expect(UPLOADS.sanitizeFileName("../../etc/passwd")).toBe("passwd");
		expect(UPLOADS.sanitizeFileName("C:\\tmp\\evil.txt")).toBe("evil.txt");
	});
	test("removes leading dots and null bytes", () => {
		expect(UPLOADS.sanitizeFileName(".htaccess")).toBe("htaccess");
		expect(UPLOADS.sanitizeFileName("a\0b.txt")).toBe("a_b.txt");
	});
	test("neutralises double extensions", () => {
		expect(UPLOADS.sanitizeFileName("shell.php.jpg")).toBe("shell_php.jpg");
	});
	test("keeps the extension when truncating a long name", () => {
		const out = UPLOADS.sanitizeFileName("a".repeat(400) + ".pdf");
		expect(out.endsWith(".pdf")).toBe(true);
		expect(out.length).toBeLessThanOrEqual(105);
	});
	test("falls back for empty results and bad input", () => {
		expect(UPLOADS.sanitizeFileName("...")).toBe("unnamed_file");
		expect(UPLOADS.sanitizeFileName(",,,.txt")).toBe("unnamed_file.txt");
		expect(UPLOADS.sanitizeFileName(undefined)).toBe("unnamed_file");
	});
	test("strips accents and reserved names, and is idempotent", () => {
		expect(UPLOADS.sanitizeFileName("résumé.PDF")).toBe("resume.pdf");
		expect(UPLOADS.sanitizeFileName("CON.txt")).toBe("_CON.txt");
		const once = UPLOADS.sanitizeFileName("ab12_my file,1.txt");
		expect(UPLOADS.sanitizeFileName(once)).toBe(once);
	});
});

describe("UPLOADS.isBlockedExtension", () => {
	test("blocks executables and html, allows documents", () => {
		expect(UPLOADS.isBlockedExtension("x.php")).toBe(true);
		expect(UPLOADS.isBlockedExtension("x.HTML")).toBe(true);
		expect(UPLOADS.isBlockedExtension("x.pdf")).toBe(false);
		expect(UPLOADS.isBlockedExtension("noext")).toBe(false);
	});
});

describe("UPLOADS.getDestinyPath", () => {
	const root = path.resolve(UPLOADS.tempUploadFolder());
	test("traversal in folder and relative path stays inside the root", async () => {
		for (const [folder, rel] of [["../../x", "a.txt"], ["....//....//x", "....//b/c.txt"], ["a\\..\\..\\x", "..\\..\\c.txt"]]) {
			const dir = await UPLOADS.getDestinyPath(folder, rel, true);
			expect(dir.startsWith(root + path.sep)).toBe(true);
			expect(dir).not.toContain("..");
		}
	});
	test("empty folder falls back to default", async () => {
		const dir = await UPLOADS.getDestinyPath("", "", true);
		expect(dir).toContain(path.join(root, "default"));
	});
});
