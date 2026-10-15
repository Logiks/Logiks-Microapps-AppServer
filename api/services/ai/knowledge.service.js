"use strict";
//REST surface for AICore's knowledge bases (sys_ai_knowledge) - the
//Vector-Gateway servers that back RAG. Thin wrapper: the logic lives in
//KNOWLEDGE (api/controllers/knowledge.js) and AICORE.ingestKnowledge.
//
//Admin only. A knowledge base holds a server URL and a bearer key that the
//AppServer then sends requests to, and its documents are tenant content, so
//this is a management surface rather than something every user calls. Every
//call is scoped to the caller's own tenant (ctx.meta.user.guid); a tenant id
//in the request body only picks the tenant *on the gateway*.

function requireAdmin(ctx) {
	if (!ctx.meta.user || (ctx.meta.user.roles || []).indexOf("admin") < 0) {
		throw new Error("Admin access only");
	}
	return ctx.meta.user.guid;
}

module.exports = {
	name: "knowledge",

	actions: {

		list: {
			rest: { method: "GET", fullPath: "/ai/knowledge" },
			async handler(ctx) {
				return await KNOWLEDGE.list(requireAdmin(ctx));
			}
		},

		get: {
			rest: { method: "GET", fullPath: "/ai/knowledge/:knowledgeCode" },
			async handler(ctx) {
				const base = await KNOWLEDGE.get(requireAdmin(ctx), ctx.params.knowledgeCode);
				if (!base) throw new Error(`Knowledge base '${ctx.params.knowledgeCode}' not found`);
				return base;
			}
		},

		//body: { title, serverUrl, authorizationKey?, dbId, tenantId?, namespace, params? }
		//Leaving authorizationKey out keeps the stored key.
		upsert: {
			rest: { method: "POST", fullPath: "/ai/knowledge/:knowledgeCode" },
			async handler(ctx) {
				return await KNOWLEDGE.upsert(requireAdmin(ctx), ctx.params.knowledgeCode, _.omit(ctx.params, ["knowledgeCode"]), ctx);
			}
		},

		remove: {
			rest: { method: "DELETE", fullPath: "/ai/knowledge/:knowledgeCode" },
			async handler(ctx) {
				await KNOWLEDGE.remove(requireAdmin(ctx), ctx.params.knowledgeCode, ctx);
				return { status: "removed" };
			}
		},

		//Debug search against one base. Unlike a chat turn, a gateway failure is returned as an error.
		search: {
			rest: { method: "POST", fullPath: "/ai/knowledge/:knowledgeCode/search" },
			params: { query: "string" },
			async handler(ctx) {
				const guid = requireAdmin(ctx);
				const { knowledgeCode, query, limit, rerank, filter } = ctx.params;
				if (!await KNOWLEDGE.get(guid, knowledgeCode)) throw new Error(`Knowledge base '${knowledgeCode}' not found`);

				const results = await KNOWLEDGE.search(guid, query, false, { scopes: [knowledgeCode] }, { strict: true, rerank, filter }, limit || 5);
				return { results };
			}
		},

		//body: { docId, text, payload?, replace? }
		ingest: {
			rest: { method: "POST", fullPath: "/ai/knowledge/:knowledgeCode/documents" },
			params: { docId: [{ type: "string" }, { type: "number" }], text: "string" },
			async handler(ctx) {
				const { knowledgeCode, docId, text, payload, replace, chunkSize, chunkOverlap } = ctx.params;
				return await KNOWLEDGE.ingest(requireAdmin(ctx), knowledgeCode, docId, text, payload || {}, { replace, chunkSize, chunkOverlap });
			}
		},

		//body: { documents: [{ docId, text, payload? }] }
		ingestBatch: {
			rest: { method: "POST", fullPath: "/ai/knowledge/:knowledgeCode/documents/batch" },
			params: { documents: { type: "array", min: 1 } },
			async handler(ctx) {
				const { knowledgeCode, documents, chunkSize, chunkOverlap } = ctx.params;
				return await KNOWLEDGE.ingestBatch(requireAdmin(ctx), knowledgeCode, documents, { chunkSize, chunkOverlap });
			}
		},

		//body: { file, docId?, payload?, replace? } - file is a files_tbl id, a path_uri or an http(s) URL.
		//The text is extracted by the tooling server, so this can take a while for a large document.
		ingestFile: {
			rest: { method: "POST", fullPath: "/ai/knowledge/:knowledgeCode/documents/file" },
			params: { file: [{ type: "string" }, { type: "number" }] },
			async handler(ctx) {
				requireAdmin(ctx);
				const { knowledgeCode, file, docId, payload, replace, chunkSize, chunkOverlap } = ctx.params;
				return await AICORE.ingestKnowledge(knowledgeCode, file, ctx, { docId, payload, replace, chunkSize, chunkOverlap });
			}
		},

		//query: limit, cursor - pass nextCursor back to continue
		listDocuments: {
			rest: { method: "GET", fullPath: "/ai/knowledge/:knowledgeCode/documents" },
			async handler(ctx) {
				const { knowledgeCode, limit, cursor } = ctx.params;
				return await KNOWLEDGE.listDocuments(requireAdmin(ctx), knowledgeCode, { limit: limit ? Number(limit) : undefined, cursor });
			}
		},

		getDocument: {
			rest: { method: "GET", fullPath: "/ai/knowledge/:knowledgeCode/documents/:docId" },
			async handler(ctx) {
				const { knowledgeCode, docId, limit, cursor } = ctx.params;
				const document = await KNOWLEDGE.getDocument(requireAdmin(ctx), knowledgeCode, docId, { limit: limit ? Number(limit) : undefined, cursor });
				if (document.found === false) throw new Error(`Document '${docId}' not found`);
				return document;
			}
		},

		//body: { docIds: [...] }
		removeDocuments: {
			rest: { method: "POST", fullPath: "/ai/knowledge/:knowledgeCode/documents/delete" },
			params: { docIds: { type: "array", min: 1 } },
			async handler(ctx) {
				return await KNOWLEDGE.removeDocuments(requireAdmin(ctx), ctx.params.knowledgeCode, ctx.params.docIds);
			}
		},

		//Refreshes the base's data_index from the gateway's own count
		sync: {
			rest: { method: "POST", fullPath: "/ai/knowledge/:knowledgeCode/sync" },
			async handler(ctx) {
				return await KNOWLEDGE.sync(requireAdmin(ctx), ctx.params.knowledgeCode);
			}
		},

		health: {
			rest: { method: "GET", fullPath: "/ai/knowledge/:knowledgeCode/health" },
			async handler(ctx) {
				return await KNOWLEDGE.health(requireAdmin(ctx), ctx.params.knowledgeCode);
			}
		},

		//The tooling server (document extraction) behind ingestFile
		toolingHealth: {
			rest: { method: "GET", fullPath: "/ai/tooling/health" },
			async handler(ctx) {
				return await TOOLING.health(requireAdmin(ctx));
			}
		}
	}
};
