/*
 * Bulk import helpers: read CSV / XLSX files and write the XLSX template.
 * No external dependencies: XLSX files are zip archives, which are handled with
 * the browser's built-in DecompressionStream.
 */

// ---------------------------------------------------------------- columns

export const IMPORT_COLUMNS = [
    { key: "url", width: 34, required: true,
        help: "Website address, e.g. https://example.com. https:// is added if you leave it out. www.example.com and example.com count as different sites." },
    { key: "name", width: 26,
        help: "Name shown in Uptime Kuma and in alerts, so the team knows which site it is. Empty = the domain name." },
    { key: "description", width: 34,
        help: "Who owns it, what it is, e.g. \"Client portal - owner: Infra team\". Shown on the monitor page." },
    { key: "notifications", width: 28,
        help: "Where alerts go. Pick a name from the dropdown (the list is on the Notifications sheet). Several: separate with commas. \"none\" = no alerts. Empty = the defaults chosen on the import page." },
    { key: "interval", width: 10,
        help: "Seconds between checks, 20 to 86400. Recommended 60. Empty = the default on the import page." },
    { key: "retries", width: 9,
        help: "Failed checks in a row before a Down alert, 0 to 10. Recommended 2 (avoids false alarms). Empty = the default on the import page." },
    { key: "ssl_alert", width: 11,
        help: "yes / no. Warn before the SSL certificate expires (days: Settings > Notifications > TLS Certificate Expiry). Empty = the default on the import page." },
    { key: "domain_alert", width: 13,
        help: "yes / no. Warn before the domain registration expires (days: Settings > Notifications > Domain Expiry). Empty = the default on the import page." },
];

const HEADER_ALIASES = {
    url: [ "url", "domain", "website", "site", "address", "link", "host" ],
    name: [ "name", "friendly name", "friendly_name", "monitor", "monitor name", "title" ],
    description: [ "description", "notes", "note", "comment", "owner" ],
    notifications: [ "notifications", "notification", "alert to", "alerts to", "send alerts to" ],
    interval: [ "interval", "check interval", "interval (seconds)", "seconds" ],
    retries: [ "retries", "retry", "max retries" ],
    ssl_alert: [ "ssl_alert", "ssl alert", "ssl expiry alert", "certificate alert", "cert alert" ],
    domain_alert: [ "domain_alert", "domain alert", "domain expiry alert" ],
};

export const MAX_ROWS = 2000;

// ---------------------------------------------------------------- CSV

/**
 * Parse CSV text (comma or semicolon separated, quoted fields allowed).
 * @param {string} text CSV content
 * @returns {string[][]} rows of cells
 */
export function parseCsv(text) {
    text = text.replace(/^\uFEFF/, "");
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === "\"" && text[i + 1] === "\"") {
                field += "\"";
                i++;
            } else if (c === "\"") {
                inQuotes = false;
            } else {
                field += c;
            }
        } else if (c === "\"") {
            inQuotes = true;
        } else if (c === delim) {
            row.push(field);
            field = "";
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") {
                i++;
            }
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += c;
        }
    }
    if (field !== "" || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

// ---------------------------------------------------------------- ZIP (read)

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/**
 * Read all entries of a zip archive.
 * @param {ArrayBuffer} buffer zip file content
 * @returns {Promise<Map<string, Uint8Array>>} file name -> uncompressed bytes
 */
async function unzip(buffer) {
    const b = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
        if (u32(b, i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error("This is not a valid .xlsx file");
    }
    const count = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const files = new Map();
    for (let n = 0; n < count; n++) {
        if (u32(b, p) !== 0x02014b50) {
            throw new Error("This .xlsx file is damaged");
        }
        const method = u16(b, p + 10);
        const compSize = u32(b, p + 20);
        const nameLen = u16(b, p + 28);
        const extraLen = u16(b, p + 30);
        const commentLen = u16(b, p + 32);
        const local = u32(b, p + 42);
        const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;

        const dataStart = local + 30 + u16(b, local + 26) + u16(b, local + 28);
        const data = b.subarray(dataStart, dataStart + compSize);
        if (method === 0) {
            files.set(name, data);
        } else if (method === 8) {
            const stream = new Blob([ data ]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
            files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
        }
    }
    return files;
}

// ---------------------------------------------------------------- XLSX (read)

const decodeXml = (s) => s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");

/**
 * Text of all <t> elements (handles rich text runs; ignores phonetic hints).
 * @param {string} xml cell or shared-string XML
 * @returns {string} decoded text
 */
const textOf = (xml) => {
    let out = "";
    const clean = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
    for (const m of clean.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) {
        out += m[1];
    }
    return decodeXml(out);
};

const colIndex = (ref) => {
    let n = 0;
    for (const ch of ref.replace(/\d+$/, "").toUpperCase()) {
        n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n - 1;
};

/**
 * Read the first worksheet of an .xlsx file.
 * @param {ArrayBuffer} buffer file content
 * @returns {Promise<string[][]>} rows of cells
 */
export async function parseXlsx(buffer) {
    const files = await unzip(buffer);
    const text = (name) => (files.has(name) ? new TextDecoder().decode(files.get(name)) : null);

    // Find the first sheet via the workbook relationships.
    const workbook = text("xl/workbook.xml");
    const rels = text("xl/_rels/workbook.xml.rels");
    if (!workbook || !rels) {
        throw new Error("This is not a valid .xlsx file");
    }
    const firstSheet = workbook.match(/<(?:\w+:)?sheet\b[^>]*?\br:id="([^"]+)"/);
    let sheetPath = "xl/worksheets/sheet1.xml";
    if (firstSheet) {
        const rel = [ ...rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g) ]
            .map((m) => m[0])
            .find((tag) => tag.includes(`Id="${firstSheet[1]}"`));
        const target = rel && rel.match(/Target="([^"]+)"/);
        if (target) {
            sheetPath = target[1].startsWith("/") ? target[1].slice(1) : `xl/${target[1]}`;
        }
    }
    const sheet = text(sheetPath);
    if (!sheet) {
        throw new Error("Could not find the first sheet in this .xlsx file");
    }

    const shared = [];
    const sst = text("xl/sharedStrings.xml");
    if (sst) {
        for (const m of sst.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)) {
            shared.push(textOf(m[1]));
        }
    }

    const rows = [];
    for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
        const rowNum = rm[1].match(/\br="(\d+)"/);
        const cells = [];
        let next = 0;
        for (const cm of (rm[2] || "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
            const attrs = cm[1];
            const body = cm[2] || "";
            const ref = attrs.match(/\br="([A-Z]+\d+)"/);
            const idx = ref ? colIndex(ref[1]) : next;
            next = idx + 1;
            const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
            const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
            let value = "";
            if (type === "s" && v) {
                value = shared[parseInt(v[1], 10)] ?? "";
            } else if (type === "inlineStr") {
                value = textOf(body);
            } else if (type === "b" && v) {
                value = v[1] === "1" ? "yes" : "no";
            } else if (v) {
                value = decodeXml(v[1]);
            }
            cells[idx] = value;
        }
        const r = rowNum ? parseInt(rowNum[1], 10) - 1 : rows.length;
        rows[r] = Array.from(cells, (c) => c ?? "");
    }
    return Array.from(rows, (r) => r ?? []);
}

// ---------------------------------------------------------------- records + validation

/**
 * Turn raw rows (first row = header) into records keyed by column.
 * A file without a recognisable header is read as a plain list of URLs in column A.
 * @param {string[][]} rows rows of cells
 * @returns {object[]} records with the source row number
 */
export function rowsToRecords(rows) {
    const numbered = rows.map((r, i) => ({ cells: r, row: i + 1 }))
        .filter(({ cells }) => cells.some((v) => String(v ?? "").trim() !== ""));
    if (!numbered.length) {
        return [];
    }
    const header = numbered[0].cells.map((h) => String(h ?? "").trim().toLowerCase());
    const col = {};
    for (const [ key, aliases ] of Object.entries(HEADER_ALIASES)) {
        const idx = header.findIndex((h) => aliases.includes(h));
        if (idx >= 0) {
            col[key] = idx;
        }
    }
    let body = numbered.slice(1);
    if (col.url === undefined) {
        col.url = 0;
        body = numbered;
    }
    return body.map(({ cells, row }) => {
        const rec = { row };
        for (const key of Object.keys(HEADER_ALIASES)) {
            rec[key] = col[key] === undefined ? "" : String(cells[col[key]] ?? "").trim();
        }
        return rec;
    });
}

/**
 * Parse yes/no cells. Empty -> null (use default), unknown -> undefined (invalid).
 * @param {string} v cell value
 * @returns {boolean|null|undefined} parsed value
 */
function yesNo(v) {
    const s = String(v).trim().toLowerCase();
    if (s === "") {
        return null;
    }
    if ([ "yes", "y", "true", "1", "on" ].includes(s)) {
        return true;
    }
    if ([ "no", "n", "false", "0", "off" ].includes(s)) {
        return false;
    }
    return undefined;
}

export const normalizeUrl = (u) => String(u || "").trim().replace(/\/+$/, "").toLowerCase();

/**
 * Validate records against the current monitors and notifications.
 * @param {object[]} records from rowsToRecords
 * @param {object} ctx context
 * @param {Set<string>} ctx.existingUrls normalized URLs of existing monitors
 * @param {{id: number, name: string}[]} ctx.notifications notifications from Uptime Kuma
 * @param {{interval: number, retries: number}} ctx.defaults values for empty cells
 * @returns {object[]} records with status: new | exists | duplicate | invalid, and problems[]
 */
export function validateRecords(records, { existingUrls, notifications, defaults }) {
    const byName = new Map(notifications.map((n) => [ n.name.trim().toLowerCase(), n.id ]));
    const seen = new Set();
    return records.map((r) => {
        const out = { ...r, problems: [] };

        let url = r.url.replace(/\s+/g, "");
        if (!url) {
            return { ...out, status: "invalid", problems: [ "No URL" ] };
        }
        if (!/^https?:\/\//i.test(url)) {
            url = `https://${url}`;
        }
        try {
            const u = new URL(url);
            const host = u.hostname;
            if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
                throw new Error();
            }
            out.url = u.href.replace(/\/+$/, "");
            out.name = r.name || host;
        } catch {
            return { ...out, status: "invalid", problems: [ "Not a valid web address" ] };
        }

        out.interval = r.interval === "" ? defaults.interval : Number(r.interval);
        if (!Number.isInteger(out.interval) || out.interval < 20 || out.interval > 86400) {
            out.problems.push("Interval must be a whole number of seconds from 20 to 86400");
        }
        out.retries = r.retries === "" ? defaults.retries : Number(r.retries);
        if (!Number.isInteger(out.retries) || out.retries < 0 || out.retries > 10) {
            out.problems.push("Retries must be 0 to 10");
        }

        out.notificationIds = null; // null = use the page defaults
        if (r.notifications) {
            const names = r.notifications.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
            if (names.length === 1 && names[0].toLowerCase() === "none") {
                out.notificationIds = [];
            } else {
                const unknown = names.filter((n) => !byName.has(n.toLowerCase()));
                if (unknown.length) {
                    out.problems.push(`Unknown notification: ${unknown.join(", ")} (see the Notifications sheet)`);
                } else {
                    out.notificationIds = names.map((n) => byName.get(n.toLowerCase()));
                }
            }
        }

        out.sslAlert = yesNo(r.ssl_alert);
        if (out.sslAlert === undefined) {
            out.problems.push("ssl_alert must be yes or no");
        }
        out.domainAlert = yesNo(r.domain_alert);
        if (out.domainAlert === undefined) {
            out.problems.push("domain_alert must be yes or no");
        }

        const key = normalizeUrl(out.url);
        if (out.problems.length) {
            out.status = "invalid";
        } else if (existingUrls.has(key)) {
            out.status = "exists";
        } else if (seen.has(key)) {
            out.status = "duplicate";
        } else {
            out.status = "new";
        }
        seen.add(key);
        return out;
    });
}

// ---------------------------------------------------------------- XLSX (write)

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[n] = c >>> 0;
    }
    return t;
})();

const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
};

/**
 * Build an uncompressed zip archive.
 * @param {{name: string, content: string}[]} entries files
 * @returns {Uint8Array} zip bytes
 */
function zip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
        const name = enc.encode(e.name);
        const data = enc.encode(e.content);
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // UTF-8 names
        local.setUint16(8, 0, true); // stored
        local.setUint16(12, 33, true); // date 1980-01-01
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        parts.push(new Uint8Array(local.buffer), name, data);

        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true);
        cd.setUint16(4, 20, true);
        cd.setUint16(6, 20, true);
        cd.setUint16(8, 0x0800, true);
        cd.setUint16(14, 33, true);
        cd.setUint32(16, crc, true);
        cd.setUint32(20, data.length, true);
        cd.setUint32(24, data.length, true);
        cd.setUint16(28, name.length, true);
        cd.setUint32(42, offset, true);
        central.push(new Uint8Array(cd.buffer), name);
        offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = [ ...parts, ...central, new Uint8Array(end.buffer) ];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let p = 0;
    for (const a of all) {
        out.set(a, p);
        p += a.length;
    }
    return out;
}

const escXml = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const colLetter = (i) => {
    let s = "";
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) {
        s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    }
    return s;
};

// Style ids in STYLES below.
const S = { normal: 0, headRequired: 1, headOptional: 2, bold: 3, muted: 4, wrap: 5 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF6E7781"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1A7F37"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF57606A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * One worksheet's XML.
 * @param {object} sheet sheet definition
 * @param {Array<Array<string|number|{v: (string|number), s: number}>>} sheet.rows cell values (or value + style id)
 * @param {number[]} sheet.widths column widths
 * @param {boolean} sheet.freeze freeze the header row
 * @param {string} sheet.validations <dataValidations> XML
 * @param {boolean} sheet.selected whether this is the active tab
 * @returns {string} worksheet XML
 */
function sheetXml({ rows, widths = [], freeze = false, validations = "", selected = false }) {
    const pane = freeze ? "<pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/>" : "";
    const cols = widths.length
        ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
        : "";
    const data = rows.map((row, r) => {
        const cells = row.map((cell, c) => {
            if (cell === null || cell === undefined || cell === "") {
                return "";
            }
            const { v, s = 0 } = typeof cell === "object" ? cell : { v: cell };
            const ref = `${colLetter(c)}${r + 1}`;
            const style = s ? ` s="${s}"` : "";
            if (typeof v === "number") {
                return `<c r="${ref}"${style}><v>${v}</v></c>`;
            }
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
        }).join("");
        return `<row r="${r + 1}">${cells}</row>`;
    }).join("");
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
        + `<sheetViews><sheetView workbookViewId="0"${selected ? " tabSelected=\"1\"" : ""}>${pane}</sheetView></sheetViews>`
        + `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData>${validations}`
        + "<pageMargins left=\"0.7\" right=\"0.7\" top=\"0.75\" bottom=\"0.75\" header=\"0.3\" footer=\"0.3\"/>"
        + "</worksheet>";
}

/**
 * Build a workbook from sheets.
 * @param {{name: string}[]} sheets sheet definitions (see sheetXml)
 * @returns {Uint8Array} .xlsx bytes
 */
function buildWorkbook(sheets) {
    const ct = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
        + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
        + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
        + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
        + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>"
        + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
        + "</Types>";
    const rootRels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
        + "</Relationships>";
    const workbook = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
        + `<sheets>${sheets.map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>`
        + "</workbook>";
    const wbRels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
        + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + "</Relationships>";
    return zip([
        { name: "[Content_Types].xml", content: ct },
        { name: "_rels/.rels", content: rootRels },
        { name: "xl/workbook.xml", content: workbook },
        { name: "xl/_rels/workbook.xml.rels", content: wbRels },
        { name: "xl/styles.xml", content: STYLES },
        ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml({ ...s, selected: i === 0 }) })),
    ]);
}

/**
 * The import template: "Domains" (to fill), "Notifications" (from Uptime Kuma), "How to fill".
 * @param {object} opts options
 * @param {{name: string, isDefault: boolean}[]} opts.notifications notifications from Uptime Kuma
 * @param {string} opts.source address of this Uptime Kuma, noted in the file
 * @returns {Uint8Array} .xlsx bytes
 */
export function buildTemplate({ notifications = [], source = "" }) {
    const last = MAX_ROWS + 1;
    const header = IMPORT_COLUMNS.map((c) => ({ v: c.key, s: c.required ? S.headRequired : S.headOptional }));
    const def = notifications.find((n) => n.isDefault) || notifications[0];
    const example = [ "https://example.com", "Example - main website", "Delete this example row", def ? def.name : "", 60, 2, "yes", "no" ]
        .map((v) => ({ v, s: S.muted }));

    const notifRows = notifications.length ? notifications.length + 1 : 1; // + "none"
    const validations = "<dataValidations count=\"4\">"
        + `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="D2:D${last}"><formula1>Notifications!$A$2:$A$${notifRows + 1}</formula1></dataValidation>`
        + `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="yes or no" error="Choose yes or no, or leave it empty." sqref="G2:H${last}"><formula1>"yes,no"</formula1></dataValidation>`
        + `<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Interval" error="Enter seconds from 20 to 86400, or leave it empty." sqref="E2:E${last}"><formula1>20</formula1><formula2>86400</formula2></dataValidation>`
        + `<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Retries" error="Enter 0 to 10, or leave it empty." sqref="F2:F${last}"><formula1>0</formula1><formula2>10</formula2></dataValidation>`
        + "</dataValidations>";

    const notifSheet = [[ { v: "notification name", s: S.bold }, { v: "default?", s: S.bold }, "" ]];
    if (notifications.length) {
        notifications.forEach((n) => notifSheet.push([ n.name, n.isDefault ? "yes" : "", "" ]));
        notifSheet.push([ "none", "", "Use \"none\" to add a site without any alerts" ]);
    } else {
        notifSheet.push([ "(none set up yet)", "", "Set one up in Uptime Kuma: Settings > Notifications > Setup Notification, then download the template again." ]);
    }
    notifSheet.push([]);
    notifSheet.push([ "", "", { v: `Taken from ${source} on ${new Date().toISOString().slice(0, 10)}.`, s: S.muted } ]);

    const help = [[ { v: "column", s: S.bold }, { v: "required?", s: S.bold }, { v: "what to put", s: S.bold } ]];
    IMPORT_COLUMNS.forEach((c) => help.push([ c.key, c.required ? "Yes" : "No", { v: c.help, s: S.wrap } ]));
    help.push([]);
    [
        "Each row = one website. Uptime Kuma checks that it is up AND watches its SSL certificate, so one row covers both.",
        "Only the url column is required (green header). Leave a cell empty to use the default.",
        "Fill only the Domains sheet. Do not rename the columns. Delete the grey example row.",
        "Sites that are already in Uptime Kuma are skipped, so you can re-upload the same file after adding new rows.",
        `Save as .xlsx and upload it on the Import page. Up to ${MAX_ROWS} rows per file.`,
    ].forEach((t) => help.push([ "", "", { v: t, s: S.wrap } ]));

    return buildWorkbook([
        { name: "Domains", rows: [ header, example ], widths: IMPORT_COLUMNS.map((c) => c.width), freeze: true, validations },
        { name: "Notifications", rows: notifSheet, widths: [ 34, 10, 70 ] },
        { name: "How to fill", rows: help, widths: [ 15, 10, 100 ] },
    ]);
}

/**
 * Monitor object for the "add" socket call, using the same defaults as the Add New Monitor page.
 * @param {object} r validated record
 * @param {object} opts { notificationIds: number[], sslAlert: boolean, domainAlert: boolean }
 * @returns {object} monitor
 */
export function toMonitor(r, opts) {
    const ids = r.notificationIds ?? opts.notificationIds ?? [];
    return {
        type: "http",
        name: r.name,
        description: r.description || null,
        parent: null,
        url: r.url,
        method: "GET",
        interval: r.interval,
        retryInterval: r.interval,
        resendInterval: 0,
        maxretries: r.retries,
        timeout: Math.max(1, Math.round(r.interval * 0.8)),
        notificationIDList: Object.fromEntries(ids.map((id) => [ id, true ])),
        ignoreTls: false,
        upsideDown: false,
        expiryNotification: r.sslAlert ?? !!opts.sslAlert,
        domainExpiryNotification: r.domainAlert ?? !!opts.domainAlert,
        maxredirects: 10,
        accepted_statuscodes: [ "200-299" ],
        saveResponse: false,
        saveErrorResponse: true,
        responseMaxLength: 1024,
        httpBodyEncoding: "json",
        kafkaProducerBrokers: [],
        kafkaProducerSaslOptions: { mechanism: "None" },
        rabbitmqNodes: [],
        conditions: [],
        active: true,
    };
}
