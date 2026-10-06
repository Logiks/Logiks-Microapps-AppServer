"use strict";

// MCP: the built-in query tools read any table of any configured database, so they are admin-only, both for
// listing and for calling. Plugin tools are not affected by that rule.

global.LogiksError = require("./helpers/fakes").LogiksError;

const REGISTRY = require("../../api/controllers/mcp/registry");

const asUser = (user) => ({ meta: { user } });
const admin = asUser({ userId: "a", roles: ["admin"], privilege: "user" });
const root = asUser({ userId: "r", roles: [], privilege: "root" });
const regular = asUser({ userId: "u", roles: ["staff"], privilege: "staff" });

const SYSTEM_TOOLS = ["query_schema", "query_index", "query_results", "query_analyse"];

beforeAll(() => {
	REGISTRY.registerSystemTools();
	REGISTRY.registerTool({ name: "crm__lookup", description: "plugin tool" }, async (args) => ({ ok: args }), "crm");
	// stands in for a real system tool so callTool can succeed without a database
	REGISTRY.registerTool({ name: "system_probe", description: "probe" }, async () => "ran", "system");
});

describe("tool listing", () => {
	test.each([["admin role", admin], ["root privilege", root]])("%s sees the system tools", (_, ctx) => {
		const names = REGISTRY.listTools(ctx).map(t => t.name);
		SYSTEM_TOOLS.forEach(n => expect(names).toContain(n));
	});

	test("a regular user does not see system tools, but still sees plugin tools", () => {
		const names = REGISTRY.listTools(regular).map(t => t.name);
		SYSTEM_TOOLS.forEach(n => expect(names).not.toContain(n));
		expect(names).toContain("crm__lookup");
	});

	test("no user at all sees no system tools", () => {
		expect(REGISTRY.listTools().map(t => t.name)).not.toContain("query_results");
		expect(REGISTRY.listTools({ meta: {} }).map(t => t.name)).not.toContain("query_results");
	});
});

describe("tool calls", () => {
	test("a regular user cannot call a system tool, even by name", async () => {
		await expect(REGISTRY.callTool("system_probe", {}, regular)).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(REGISTRY.callTool("query_results", { table: "lgks_users" }, regular)).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("an anonymous caller cannot either", async () => {
		await expect(REGISTRY.callTool("system_probe", {}, undefined)).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("an admin can", async () => {
		await expect(REGISTRY.callTool("system_probe", {}, admin)).resolves.toBe("ran");
	});

	test("plugin tools are callable by a regular user", async () => {
		await expect(REGISTRY.callTool("crm__lookup", { q: 1 }, regular)).resolves.toEqual({ ok: { q: 1 } });
	});

	test("an unknown tool is reported as such", async () => {
		await expect(REGISTRY.callTool("nope", {}, admin)).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });
	});
});

describe("config can widen who may use system tools", () => {
	test("mcp.system_tool_privileges", async () => {
		global.CONFIG.mcp = { system_tool_privileges: ["analyst"] };
		try {
			const analyst = asUser({ userId: "x", roles: [], privilege: "analyst" });
			await expect(REGISTRY.callTool("system_probe", {}, analyst)).resolves.toBe("ran");
			await expect(REGISTRY.callTool("system_probe", {}, regular)).rejects.toMatchObject({ code: "FORBIDDEN" });
		} finally {
			delete global.CONFIG.mcp;
		}
	});
});
