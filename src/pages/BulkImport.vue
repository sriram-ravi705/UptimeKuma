<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 class="mb-3">Import Monitors</h1>
            <p class="text-muted">
                Add many websites at once from an Excel or CSV file. Each row becomes an HTTP(s) monitor that alerts
                when the site goes down and, if enabled, before its SSL certificate or domain expires.
            </p>

            <!-- Step 1: defaults + template -->
            <div class="shadow-box big-padding mb-3">
                <h4 class="mb-3">1. Defaults for empty cells</h4>
                <div class="row g-3">
                    <div class="col-6 col-lg-3">
                        <label class="form-label" for="bi-interval">Check interval (seconds)</label>
                        <input id="bi-interval" v-model.number="defaults.interval" type="number" class="form-control" min="20" max="86400" />
                    </div>
                    <div class="col-6 col-lg-3">
                        <label class="form-label" for="bi-retries">Retries before alert</label>
                        <input id="bi-retries" v-model.number="defaults.retries" type="number" class="form-control" min="0" max="10" />
                    </div>
                    <div class="col-12 col-lg-3">
                        <div class="form-label">Alerts</div>
                        <div class="form-check">
                            <input id="bi-ssl" v-model="defaults.sslAlert" class="form-check-input" type="checkbox" />
                            <label class="form-check-label" for="bi-ssl">SSL certificate expiry</label>
                        </div>
                        <div class="form-check">
                            <input id="bi-domain" v-model="defaults.domainAlert" class="form-check-input" type="checkbox" />
                            <label class="form-check-label" for="bi-domain">Domain name expiry</label>
                        </div>
                    </div>
                    <div class="col-12 col-lg-3">
                        <div class="form-label">Notifications</div>
                        <div v-if="!$root.notificationList.length" class="text-warning small">
                            No notifications set up yet. Imported monitors won't send alerts.
                            <router-link to="/settings/notifications">Set one up</router-link>
                        </div>
                        <div v-for="n in $root.notificationList" :key="n.id" class="form-check">
                            <input :id="'bi-n' + n.id" v-model="defaults.notificationIds" class="form-check-input" type="checkbox" :value="n.id" />
                            <label class="form-check-label" :for="'bi-n' + n.id">
                                {{ n.name }}
                                <span v-if="n.isDefault" class="badge bg-primary ms-1">Default</span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="mt-3">
                    <button type="button" class="btn btn-normal" @click="downloadTemplate">
                        <font-awesome-icon icon="download" /> Download Excel template
                    </button>
                    <span class="text-muted small ms-2">Includes your notification names as a dropdown and a "How to fill" sheet.</span>
                </div>
            </div>

            <!-- Step 2: upload -->
            <div class="shadow-box big-padding mb-3">
                <h4 class="mb-3">2. Upload your file</h4>
                <div
                    class="drop-zone"
                    :class="{ over: dragOver }"
                    role="button"
                    tabindex="0"
                    @click="$refs.file.click()"
                    @keydown.enter.prevent="$refs.file.click()"
                    @keydown.space.prevent="$refs.file.click()"
                    @dragover.prevent="dragOver = true"
                    @dragleave.prevent="dragOver = false"
                    @drop.prevent="onDrop"
                >
                    <font-awesome-icon icon="upload" size="2x" class="mb-2" />
                    <div><strong>Drop a .xlsx or .csv file here</strong> or click to choose</div>
                    <div class="small text-muted">Only the <code>url</code> column is required.</div>
                </div>
                <input ref="file" type="file" accept=".xlsx,.csv,.txt" class="d-none" @change="onFileChosen" />
                <div v-if="fileError" class="alert alert-danger mt-3 mb-0">{{ fileError }}</div>
                <div v-else-if="fileName && rows.length" class="text-muted small mt-2">{{ fileName }}: {{ rows.length }} row(s) read.</div>
            </div>

            <!-- Step 3: preview -->
            <div v-if="rows.length && !results.length" class="shadow-box big-padding mb-3">
                <h4 class="mb-3">3. Check and import</h4>
                <div class="mb-3">
                    <span v-for="(n, s) in countBy(rows, 'status')" :key="s" class="badge me-2" :class="badgeClass(s)">{{ n }} {{ LABELS[s] }}</span>
                </div>
                <div class="table-responsive table-scroll">
                    <table class="table table-sm align-middle">
                        <thead>
                            <tr>
                                <th>Row</th><th>Status</th><th>Name</th><th>URL</th><th>Alerts to</th>
                                <th>Interval</th><th>Retries</th><th>SSL alert</th><th>Domain alert</th><th>Problem</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in rows" :key="r.row">
                                <td class="text-muted">{{ r.row }}</td>
                                <td><span class="badge" :class="badgeClass(r.status)">{{ LABELS[r.status] }}</span></td>
                                <td>{{ r.name }}</td>
                                <td>{{ r.url }}</td>
                                <td>{{ alertsTo(r) }}</td>
                                <td>{{ Number.isFinite(r.interval) ? r.interval + "s" : "–" }}</td>
                                <td>{{ Number.isFinite(r.retries) ? r.retries : "–" }}</td>
                                <td>{{ yesNo(r.sslAlert, defaults.sslAlert) }}</td>
                                <td>{{ yesNo(r.domainAlert, defaults.domainAlert) }}</td>
                                <td class="text-danger small">{{ r.problems.join("; ") }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <button type="button" class="btn btn-primary mt-2" :disabled="!newRows.length || importing" @click="runImport">
                    <template v-if="importing">Importing {{ progress }} / {{ newRows.length }}…</template>
                    <template v-else-if="newRows.length">Import {{ newRows.length }} monitor(s)</template>
                    <template v-else>Nothing new to import</template>
                </button>
                <span v-if="newRows.length < rows.length" class="text-muted small ms-2">Only rows marked New are imported.</span>
            </div>

            <!-- Step 4: results -->
            <div v-if="results.length" class="shadow-box big-padding mb-3">
                <h4 class="mb-3">Result</h4>
                <div class="mb-3">
                    <span v-for="(n, s) in countBy(results, 'result')" :key="s" class="badge me-2" :class="badgeClass(s)">{{ n }} {{ LABELS[s] }}</span>
                </div>
                <div class="table-responsive table-scroll">
                    <table class="table table-sm align-middle">
                        <thead><tr><th>Result</th><th>Name</th><th>URL</th><th>Message</th></tr></thead>
                        <tbody>
                            <tr v-for="r in results" :key="r.row">
                                <td><span class="badge" :class="badgeClass(r.result)">{{ LABELS[r.result] }}</span></td>
                                <td>
                                    <router-link v-if="r.id" :to="'/dashboard/' + r.id">{{ r.name }}</router-link>
                                    <template v-else>{{ r.name }}</template>
                                </td>
                                <td>{{ r.url }}</td>
                                <td class="small text-muted">{{ r.message }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <button type="button" class="btn btn-normal mt-2" @click="reset">Import another file</button>
            </div>
        </div>
    </transition>
</template>

<script>
import {
    MAX_ROWS, buildTemplate, normalizeUrl, parseCsv, parseXlsx, rowsToRecords, toMonitor, validateRecords,
} from "../util-bulk-import";

const LABELS = {
    new: "New",
    exists: "Already in Uptime Kuma",
    duplicate: "Duplicate in file",
    invalid: "Invalid",
    added: "Added",
    skipped: "Skipped",
    failed: "Failed",
};

export default {
    data() {
        return {
            LABELS,
            defaults: {
                interval: 60,
                retries: 2,
                sslAlert: true,
                domainAlert: false,
                notificationIds: [],
            },
            dragOver: false,
            fileName: "",
            fileError: "",
            records: [],
            rows: [],
            results: [],
            importing: false,
            progress: 0,
        };
    },
    computed: {
        newRows() {
            return this.rows.filter((r) => r.status === "new");
        },
        existingUrls() {
            return new Set(Object.values(this.$root.monitorList).map((m) => m.url && normalizeUrl(m.url)).filter(Boolean));
        },
    },
    watch: {
        // Re-check the preview when defaults change, so it always shows what will be imported.
        "defaults.interval"() {
            this.revalidate();
        },
        "defaults.retries"() {
            this.revalidate();
        },
        "$root.notificationList": {
            immediate: true,
            handler(list) {
                if (!this.defaults.notificationIds.length) {
                    this.defaults.notificationIds = list.filter((n) => n.isDefault).map((n) => n.id);
                }
            },
        },
    },
    methods: {
        countBy(list, key) {
            const out = {};
            list.forEach((r) => {
                out[r[key]] = (out[r[key]] || 0) + 1;
            });
            return out;
        },
        badgeClass(status) {
            return {
                new: "bg-primary",
                added: "bg-primary",
                exists: "bg-secondary",
                duplicate: "bg-secondary",
                skipped: "bg-secondary",
                invalid: "bg-danger",
                failed: "bg-danger",
            }[status];
        },
        notificationName(id) {
            const n = this.$root.notificationList.find((x) => x.id === id);
            return n ? n.name : `#${id}`;
        },
        alertsTo(r) {
            if (r.notificationIds === null || r.notificationIds === undefined) {
                const names = this.defaults.notificationIds.map(this.notificationName);
                return `${names.length ? names.join(", ") : "none"} (default)`;
            }
            return r.notificationIds.length ? r.notificationIds.map(this.notificationName).join(", ") : "none";
        },
        yesNo(value, fallback) {
            if (value === null || value === undefined) {
                return `${fallback ? "yes" : "no"} (default)`;
            }
            return value ? "yes" : "no";
        },

        downloadTemplate() {
            const bytes = buildTemplate({
                notifications: this.$root.notificationList.map((n) => ({ name: n.name, isDefault: !!n.isDefault })),
                source: location.origin,
            });
            const blob = new Blob([ bytes ], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "uptime-kuma-import.xlsx";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },

        onDrop(e) {
            this.dragOver = false;
            if (e.dataTransfer.files[0]) {
                this.readFile(e.dataTransfer.files[0]);
            }
        },
        onFileChosen(e) {
            if (e.target.files[0]) {
                this.readFile(e.target.files[0]);
            }
            e.target.value = "";
        },
        async readFile(file) {
            this.reset();
            this.fileName = file.name;
            try {
                let raw;
                if (/\.xlsx$/i.test(file.name)) {
                    raw = await parseXlsx(await file.arrayBuffer());
                } else if (/\.(csv|txt)$/i.test(file.name)) {
                    raw = parseCsv(await file.text());
                } else {
                    throw new Error("Please upload a .xlsx or .csv file. (Old .xls files: open in Excel and Save As .xlsx.)");
                }
                const records = rowsToRecords(raw);
                if (!records.length) {
                    throw new Error("The file has no rows.");
                }
                if (records.length > MAX_ROWS) {
                    throw new Error(`Too many rows (${records.length}). The limit is ${MAX_ROWS} per file. Split the file.`);
                }
                this.records = records;
                this.revalidate();
            } catch (err) {
                this.fileError = `Could not read ${file.name}: ${err.message}`;
            }
        },
        revalidate() {
            if (!this.records.length || this.results.length) {
                return;
            }
            this.rows = validateRecords(this.records, {
                existingUrls: this.existingUrls,
                notifications: this.$root.notificationList,
                defaults: { interval: this.defaults.interval, retries: this.defaults.retries },
            });
        },

        addMonitor(monitor) {
            return new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ ok: false, msg: "No answer from the server" }), 30000);
                this.$root.add(monitor, (res) => {
                    clearTimeout(timer);
                    resolve(res);
                });
            });
        },
        async runImport() {
            this.revalidate(); // pick up monitors added elsewhere since the preview
            const todo = this.newRows;
            const opts = {
                notificationIds: this.defaults.notificationIds,
                sslAlert: this.defaults.sslAlert,
                domainAlert: this.defaults.domainAlert,
            };
            this.importing = true;
            this.progress = 0;
            const results = this.rows.filter((r) => r.status !== "new").map((r) => ({
                ...r,
                result: "skipped",
                message: r.problems.length ? r.problems.join("; ") : LABELS[r.status],
            }));
            for (const r of todo) {
                const res = await this.addMonitor(toMonitor(r, opts));
                results.push(res.ok
                    ? { ...r, result: "added", id: res.monitorID }
                    : { ...r, result: "failed", message: res.msgi18n ? this.$t(res.msg) : res.msg });
                this.progress++;
            }
            results.sort((a, b) => a.row - b.row);
            this.results = results;
            this.importing = false;
            const added = results.filter((r) => r.result === "added").length;
            this.$root.toastSuccess(`Imported ${added} monitor(s)`);
        },
        reset() {
            this.fileName = "";
            this.fileError = "";
            this.records = [];
            this.rows = [];
            this.results = [];
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.drop-zone {
    border: 2px dashed $secondary-text;
    border-radius: 10px;
    padding: 28px;
    text-align: center;
    cursor: pointer;
    transition: background-color 0.15s;

    &.over,
    &:hover {
        border-color: $primary;
        background-color: rgba($primary, 0.08);
    }
}

.table-scroll {
    max-height: 480px;
    overflow-y: auto;
}

.dark {
    .table {
        color: $dark-font-color;
    }
}
</style>
