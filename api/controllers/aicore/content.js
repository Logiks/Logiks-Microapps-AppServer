//Normalizes the content/attachment/fileId union every AICore "basic"
//function (summerize, extract, describe, ...) accepts into a single part an
//engine adapter can place straight into a message: either a text part or an
//image part. No PDF/office-doc text extraction is wired in yet, so a file
//that isn't plain text or an image fails loudly instead of silently
//producing garbage.
//
// Accepts:
//   - a plain string                   -> text
//   - a number, or { fileId }/{attachment} -> resolved via FILES.getFileById (needs ctx.meta.user.guid)
//   - { text }                         -> text, passed through
//   - { mimeType, data }               -> already-resolved buffer/base64, classified by mimeType
//
// Returns: { type: "text", text } | { type: "image", mimeType, data (base64) }

const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/csv"];

async function resolveContent(input, ctx) {
    if (input == null) throw new Error("AICore: no content/attachment provided");

    if (typeof input === "string") return { type: "text", text: input };
    if (typeof input === "number") return await resolveFile(input, ctx);

    if (typeof input === "object") {
        if (input.text != null) return { type: "text", text: String(input.text) };
        if (input.mimeType && input.data != null) return classifyBuffer(input.mimeType, input.data);
        if (input.fileId != null) return await resolveFile(input.fileId, ctx);
        if (input.attachment != null) return await resolveFile(input.attachment, ctx);
    }

    throw new Error("AICore: unrecognized content shape - pass a string, { fileId }, { attachment }, { text }, or { mimeType, data }");
}

async function resolveFile(fileId, ctx) {
    const guid = ctx?.meta?.user?.guid;
    if (!guid) throw new Error("AICore: resolving a fileId/attachment requires ctx.meta.user.guid");

    const file = await FILES.getFileById(guid, fileId, "buffer", false);
    if (!file) throw new Error(`AICore: file '${fileId}' not found`);

    return classifyBuffer(file.mime, file.buffer, file.filename);
}

function classifyBuffer(mimeType, data, filename) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "base64");
    const mime = mimeType || "";

    if (TEXT_MIME_PREFIXES.some(p => mime.startsWith(p))) {
        return { type: "text", text: buffer.toString("utf8") };
    }

    if (mime.startsWith("image/")) {
        return { type: "image", mimeType: mime, data: buffer.toString("base64") };
    }

    throw new Error(`AICore: unsupported content type '${mime}'${filename ? ` for '${filename}'` : ""} - only plain text and images are supported today`);
}

module.exports = { resolveContent };
