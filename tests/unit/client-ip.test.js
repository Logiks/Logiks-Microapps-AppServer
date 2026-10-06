"use strict";

// MISC.getClientIP: X-Forwarded-For is only believed when the direct peer is a proxy, and is read from the right.

const MISC = require("../../api/helpers/misc");

const req = (headers, peer) => ({ headers, connection: { remoteAddress: peer }, socket: { remoteAddress: peer } });

describe("MISC.getClientIP", () => {
	let savedConfig;
	beforeEach(() => { savedConfig = { trust_proxy: global.CONFIG.trust_proxy, trust_proxy_hops: global.CONFIG.trust_proxy_hops }; });
	afterEach(() => {
		global.CONFIG.trust_proxy = savedConfig.trust_proxy;
		global.CONFIG.trust_proxy_hops = savedConfig.trust_proxy_hops;
	});

	test("a public client cannot choose its address with X-Forwarded-For", () => {
		expect(MISC.getClientIP(req({ "x-forwarded-for": "10.1.1.1, 9.9.9.9" }, "8.8.4.4"))).toBe("8.8.4.4");
	});

	test("behind a loopback proxy the address the proxy appended is used, not the client-supplied left side", () => {
		expect(MISC.getClientIP(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, "127.0.0.1"))).toBe("203.0.113.9");
	});

	test("private network proxies are trusted by default", () => {
		expect(MISC.getClientIP(req({ "x-forwarded-for": "203.0.113.9" }, "10.0.0.5"))).toBe("203.0.113.9");
		expect(MISC.getClientIP(req({ "x-forwarded-for": "203.0.113.9" }, "192.168.1.5"))).toBe("203.0.113.9");
		expect(MISC.getClientIP(req({ "x-forwarded-for": "203.0.113.9" }, "172.20.0.2"))).toBe("203.0.113.9");
	});

	test("trust_proxy_hops counts proxies from the right", () => {
		global.CONFIG.trust_proxy_hops = 2;
		expect(MISC.getClientIP(req({ "x-forwarded-for": "spoof, 203.0.113.9, 10.0.0.9" }, "127.0.0.1"))).toBe("203.0.113.9");
	});

	test("trust_proxy=false ignores the header even from a private peer", () => {
		global.CONFIG.trust_proxy = false;
		expect(MISC.getClientIP(req({ "x-forwarded-for": "203.0.113.9" }, "127.0.0.1"))).toBe("127.0.0.1");
	});

	test("trust_proxy=true honours the header from any peer", () => {
		global.CONFIG.trust_proxy = true;
		expect(MISC.getClientIP(req({ "x-forwarded-for": "203.0.113.9" }, "8.8.4.4"))).toBe("203.0.113.9");
	});

	test("IPv4-mapped IPv6 peers are normalised", () => {
		expect(MISC.getClientIP(req({}, "::ffff:5.5.5.5"))).toBe("5.5.5.5");
	});

	test("no header: the socket address", () => {
		expect(MISC.getClientIP(req({}, "8.8.4.4"))).toBe("8.8.4.4");
	});
});
