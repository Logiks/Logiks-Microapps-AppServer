"use strict";

// AICore basics (summerize, extract, classify, translate, generate, moderate, describe, ocr, embed): each builds the
// right prompt for the engine, resolves its input, and parses the model's reply defensively. A fake engine stands in
// for the provider, so nothing here touches the network.

const { fakeCache } = require("./helpers/fakes");

global._CACHE = fakeCache();
global._ = require("lodash");
global.UNIQUEID = { generate: () => "uid" };
global.FILES = { getFileById: jest.fn() };

const BASICS = require("../../api/controllers/aicore/basics");

const PNG = Buffer.from("fakepng");
const ctx = { meta: { user: { userId: "u1", guid: "g1" } } };

let reply;
const sendMessage = jest.fn(async () => ({ message: reply, toolCalls: [] }));
const embed = jest.fn(async (input) => [[1, 2, 3]]);
const lastCall = () => {
	const [, messages, tools, , params] = sendMessage.mock.calls[sendMessage.mock.calls.length - 1];
	return { system: messages[0].content, user: messages[1].content, tools, params };
};

beforeEach(() => {
	sendMessage.mockClear();
	FILES.getFileById.mockReset();
	jest.spyOn(console, "error").mockImplementation(() => {});
	BASICS.configure([{ key: "fake", instance: { sendMessage, embed } }], { retry: { maxAttempts: 1 } });
});
afterEach(() => jest.restoreAllMocks());

describe("summerize", () => {
	test("returns the model's text as { summary } and sends no tools", async () => {
		reply = "Short version.";
		expect(await BASICS.summerize("A very long text", ctx)).toEqual({ summary: "Short version." });
		expect(lastCall().tools).toEqual([]);
	});

	test("a single item and an array of items are both accepted, in order", async () => {
		reply = "s";
		await BASICS.summerize(["one", { text: "two" }], ctx);
		const parts = lastCall().user;
		expect(parts[0].text).toMatch(/Summarize/);
		expect(parts.slice(1)).toEqual([{ type: "text", text: "one" }, { type: "text", text: "two" }]);
	});

	test("a fileId is loaded for the caller's tenant and its text is summarised", async () => {
		FILES.getFileById.mockResolvedValue({ mime: "text/plain", buffer: Buffer.from("file body"), filename: "a.txt" });
		reply = "s";
		await BASICS.summerize({ fileId: 7 }, ctx);
		expect(FILES.getFileById).toHaveBeenCalledWith("g1", 7, "buffer", false);
		expect(lastCall().user[1]).toEqual({ type: "text", text: "file body" });
	});

	test("a fileId without a tenant is refused before any engine call", async () => {
		await expect(BASICS.summerize({ fileId: 7 }, { meta: { user: {} } })).rejects.toThrow(/guid/);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	test("an unsupported file type (PDF) fails loudly instead of summarising garbage", async () => {
		FILES.getFileById.mockResolvedValue({ mime: "application/pdf", buffer: PNG, filename: "a.pdf" });
		await expect(BASICS.summerize({ fileId: 1 }, ctx)).rejects.toThrow(/unsupported content type/);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	test("empty input is rejected", async () => {
		await expect(BASICS.summerize(null, ctx)).rejects.toThrow(/no content/);
	});

	test("an engine failure surfaces to the caller", async () => {
		sendMessage.mockRejectedValueOnce(Object.assign(new Error("HTTP 400"), { status: 400 }));
		await expect(BASICS.summerize("x", ctx)).rejects.toThrow(/400/);
	});
});

describe("extract", () => {
	const template = { name: "", total: 0, note: "keep" };

	test("fills matched keys, keeps unmatched ones, ignores extra keys", async () => {
		reply = JSON.stringify({ name: "Acme", total: 42, surprise: "x" });
		const out = await BASICS.extract("Invoice from Acme, 42", template, ctx);
		expect(out).toEqual({ name: "Acme", total: 42, note: "keep" });
		expect(template).toEqual({ name: "", total: 0, note: "keep" }); // caller's template is not mutated
		expect(lastCall().user[0].text).toMatch(/name, total, note/);
	});

	test("tolerates a ```json fenced reply", async () => {
		reply = "```json\n{\"name\":\"Acme\"}\n```";
		expect((await BASICS.extract("x", template, ctx)).name).toBe("Acme");
	});

	test("a null for a missing field overwrites the default, as documented", async () => {
		reply = '{"total": null}';
		expect((await BASICS.extract("x", template, ctx)).total).toBeNull();
	});

	test("an unparseable reply returns the template unchanged", async () => {
		reply = "Sorry, I can't do that.";
		expect(await BASICS.extract("x", template, ctx)).toEqual(template);
	});
});

describe("classify", () => {
	test("returns category and reason, and lists the categories in the prompt", async () => {
		reply = '{"category":"billing","reason":"mentions invoice"}';
		expect(await BASICS.classify("Where is my invoice?", ["billing", "support"], ctx)).toEqual({ category: "billing", reason: "mentions invoice" });
		expect(lastCall().user[0].text).toMatch(/billing, support/);
	});

	test("an unparseable reply gives nulls rather than throwing", async () => {
		reply = "no idea";
		expect(await BASICS.classify("x", ["a"], ctx)).toEqual({ category: null, reason: null });
	});
});

describe("translate", () => {
	test("puts the target language in the system prompt and returns { text }", async () => {
		reply = "Hola";
		expect(await BASICS.translate("Hello", "Spanish", ctx)).toEqual({ text: "Hola" });
		expect(lastCall().system).toMatch(/Spanish/);
		expect(lastCall().user).toBe("Hello");
	});

	test("images are rejected", async () => {
		await expect(BASICS.translate({ mimeType: "image/png", data: PNG }, "French", ctx)).rejects.toThrow(/only text/);
	});
});

describe("generate", () => {
	test("uses the default system prompt, or the caller's, and forwards params", async () => {
		reply = "draft";
		expect(await BASICS.generate("Write a haiku", {}, ctx)).toEqual({ text: "draft" });
		expect(lastCall().system).toMatch(/helpful writing assistant/);

		await BASICS.generate("Write", { systemPrompt: "Be terse", temperature: 0.2 }, ctx);
		expect(lastCall().system).toBe("Be terse");
		expect(lastCall().params.temperature).toBe(0.2);
	});
});

describe("moderate", () => {
	test("returns the parsed verdict", async () => {
		reply = '{"flagged":true,"categories":["harassment"],"reason":"abusive"}';
		expect(await BASICS.moderate("you idiot", ctx)).toEqual({ flagged: true, categories: ["harassment"], reason: "abusive" });
	});

	test("an unparseable reply is reported as not flagged, with the reason saying so", async () => {
		reply = "???";
		expect(await BASICS.moderate("x", ctx)).toEqual({ flagged: false, categories: [], reason: "unparseable response" });
	});
});

describe("describe and ocr", () => {
	const image = { mimeType: "image/png", data: PNG };

	test("describe sends the image as base64 and returns { description }", async () => {
		reply = "A cat";
		expect(await BASICS.describe(image, ctx)).toEqual({ description: "A cat" });
		expect(lastCall().user[1]).toEqual({ type: "image", mimeType: "image/png", data: PNG.toString("base64") });
	});

	test("ocr returns { text }", async () => {
		reply = "STOP";
		expect(await BASICS.ocr(image, ctx)).toEqual({ text: "STOP" });
	});

	test.each(["describe", "ocr"])("%s refuses non-image input", async (fn) => {
		await expect(BASICS[fn]("just text", ctx)).rejects.toThrow(/must resolve to an image/);
	});
});

describe("embed", () => {
	test("skips engines without embeddings and uses the first that has them", async () => {
		const noEmbed = { key: "claude", instance: { embed: async () => { throw new Error("not supported"); } } };
		BASICS.configure([noEmbed, { key: "openai", instance: { embed } }], {});
		expect(await BASICS.embed("hi", ctx)).toEqual({ vectors: [[1, 2, 3]], engineKey: "openai" });
	});

	test("fails with the last error when no engine supports it", async () => {
		BASICS.configure([{ key: "claude", instance: { embed: async () => { throw new Error("not supported"); } } }], {});
		await expect(BASICS.embed("hi", ctx)).rejects.toThrow(/not supported/);
	});
});

describe("engine fallback", () => {
	test("a basic call falls through to the next engine when the first is down", async () => {
		const down = { key: "claude", instance: { sendMessage: jest.fn(async () => { throw Object.assign(new Error("HTTP 503"), { status: 503 }); }) } };
		reply = "from backup";
		BASICS.configure([down, { key: "openai", instance: { sendMessage } }], { retry: { maxAttempts: 1 } });
		expect(await BASICS.summerize("x", ctx)).toEqual({ summary: "from backup" });
	});
});
