// NCR → UNIERP RPA 대시보드 클라이언트
"use strict";

const $ = (id) => document.getElementById(id);

function logLine(msg, cls) {
    const pane = $("logPane");
    const div = document.createElement("div");
    if (cls) div.className = cls;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    pane.appendChild(div);
    pane.scrollTop = pane.scrollHeight;
}

async function api(method, url, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    let data = null;
    try { data = await resp.json(); } catch (e) { /* no body */ }
    if (!resp.ok) {
        const err = (data && (data.error || data.message)) || resp.statusText;
        throw new Error(err);
    }
    return data;
}

function setResult(id, msg, ok) {
    const el = $(id);
    el.textContent = msg;
    el.className = "result " + (ok ? "ok" : "err");
}

// ── 큐 렌더링 ──
function renderQueue(queue) {
    const body = $("queueBody");
    $("queueCount").textContent = queue && queue.length ? `(${queue.length}건)` : "";
    if (!queue || queue.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="muted">조회된 보고 없음</td></tr>';
        return;
    }
    body.innerHTML = "";
    queue.forEach((q) => {
        const tr = document.createElement("tr");
        tr.dataset.index = q.index;
        tr.innerHTML =
            `<td>${q.index + 1}</td><td>${q.id}</td><td>${q.item_code || ""}</td>` +
            `<td class="qstatus">${q.status}</td><td class="qprogress">${q.progress}</td>`;
        body.appendChild(tr);
    });
}

function updateQueueRow(index, status, progress) {
    const tr = $("queueBody").querySelector(`tr[data-index="${index}"]`);
    if (!tr) return;
    const st = tr.querySelector(".qstatus");
    st.textContent = status;
    st.className = "qstatus status-" + status.replace(/\s/g, "");
    if (progress !== undefined) tr.querySelector(".qprogress").textContent = progress;
}

// ── WebSocket ──
function connectWS(path, onMessage) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}${path}`);
    ws.onmessage = (ev) => {
        try { onMessage(JSON.parse(ev.data)); } catch (e) { /* ignore */ }
    };
    ws.onclose = () => setTimeout(() => connectWS(path, onMessage), 2000);
    return ws;
}

function handleProgress(d) {
    if (d.type === "fetched") {
        renderQueue(d.queue);
        logLine(`PENDING 보고 ${d.count}건 조회됨`);
    } else if (d.type === "error") {
        logLine(`조회 오류: ${d.message}`, "err");
    }
}

function handleErp(d) {
    if (d.type === "log") {
        const cls = /오류|실패|⚠/.test(d.message) ? (/⚠/.test(d.message) ? "warn" : "err") : null;
        logLine(d.message, cls);
    } else if (d.type === "queue_update") {
        updateQueueRow(d.index, d.status, d.progress);
    } else if (d.type === "connection") {
        logLine((d.connected ? "✓ " : "✗ ") + d.message, d.connected ? null : "err");
    } else if (d.type === "focus_lost") {
        logLine(d.message, "warn");
    } else if (d.type === "running") {
        logLine(d.value ? "실행 중" : "실행 종료");
    } else if (d.type === "review_required") {
        showReviewPanel(d);
    } else if (d.type === "review_resolved") {
        hideReviewPanel();
    }
}

// ── 배치 검토 패널 (1 보고 = 1 페이지) ──
let _reviewState = { reports: [], page: 0 };

function showReviewPanel(d) {
    const panel = $("reviewPanel");
    panel.classList.remove("hidden");
    $("reviewResult").textContent = "";
    // 새 페이로드: d.reports = [{queue_index, report_id, steps, status}, ...]
    // 옛 호환: 단일 d.steps + d.report_id면 1개짜리 배열로 감쌈
    if (Array.isArray(d.reports)) {
        _reviewState = { reports: d.reports, page: 0 };
    } else if (d.steps) {
        _reviewState = { reports: [{ report_id: d.report_id, steps: d.steps, status: "pending" }], page: 0 };
    } else {
        _reviewState = { reports: [], page: 0 };
    }
    renderReviewPage();
}

function renderReviewPage() {
    const { reports, page } = _reviewState;
    const total = reports.length;
    if (total === 0) { hideReviewPanel(); return; }
    const cur = Math.max(0, Math.min(page, total - 1));
    _reviewState.page = cur;
    const r = reports[cur];

    // 헤더 — 보고 번호 + 상태
    const statusBadge = r.status === "confirmed"
        ? '<span style="color:#5cb85c;font-weight:bold">✓ 확인됨</span>'
        : '<span style="color:#f0ad4e">대기 중</span>';
    $("reviewReportLabel").innerHTML = `보고 #${r.report_id} — ${statusBadge}`;

    // 17 필드 테이블
    const tbody = $("reviewSteps");
    tbody.innerHTML = "";
    (r.steps || []).forEach((s) => {
        const tr = document.createElement("tr");
        const valDisplay = s.value === "" || s.value === null ? "—" : s.value;
        const isSkip = s.method === "skip" || s.skippable;
        tr.innerHTML =
            `<td>${s.idx + 1}</td><td>${escapeHtml(s.label)}</td>` +
            `<td><code>${escapeHtml(String(valDisplay))}</code></td>` +
            `<td class="muted">${escapeHtml(s.method)}</td>` +
            `<td>${isSkip
                ? '<span class="muted">(SKIP)</span>'
                : `<button class="btn btn-secondary" data-redo="${s.idx}">재실행 #${s.idx + 1}</button>`}</td>`;
        tbody.appendChild(tr);
    });
    tbody.querySelectorAll("button[data-redo]").forEach((btn) => {
        btn.onclick = async () => {
            const idx = parseInt(btn.dataset.redo, 10);
            try {
                const resp = await api("POST", "/api/erp/review/redo-step",
                    { step_index: idx, report_id: r.report_id });
                setResult("reviewResult", resp.message, true);
            } catch (e) { setResult("reviewResult", e.message, false); }
        };
    });

    // pager
    const confirmedCount = reports.filter(x => x.status === "confirmed").length;
    const pager = $("reviewPager");
    if (pager) {
        pager.textContent = `보고 ${cur + 1} / ${total}  (확인됨 ${confirmedCount}/${total})`;
    }
    const btnPrev = $("btnReviewPrev");
    const btnNext = $("btnReviewNext");
    if (btnPrev) btnPrev.disabled = cur === 0;
    if (btnNext) btnNext.disabled = cur >= total - 1;

    // 완료 확인 / 모두 확인 버튼 상태
    const btnConfirm = $("btnConfirm");
    if (btnConfirm) {
        btnConfirm.disabled = r.status === "confirmed";
        btnConfirm.textContent = r.status === "confirmed" ? "이미 확인됨" : "이 보고 완료 확인";
    }
}

function hideReviewPanel() {
    $("reviewPanel").classList.add("hidden");
    _reviewState = { reports: [], page: 0 };
}

// ── 소스 ──
async function loadSource() {
    const d = await api("GET", "/api/source");
    document.querySelectorAll('input[name="source"]').forEach((r) => { r.checked = r.value === d.source; });
    $("sourceInfo").textContent = `API: ${d.api_base_url || "(미설정)"} · DB: ${d.db_configured ? "설정됨" : "미설정"}`;
}

function selectedSource() {
    const r = document.querySelector('input[name="source"]:checked');
    return r ? r.value : "api";
}

// ── ERP 설정 ──
async function loadErpSettings() {
    const d = await api("GET", "/api/erp/settings");
    $("erpWindowTitle").value = d.window_title || "";
    $("erpLaunchPath").value = d.launch_path || "";
    $("erpLoginPw").value = d.login_pw || "";
    $("erpTargetMenu").value = d.target_menu || "";
    $("erpFirstFieldTabs").value = d.first_field_tabs ?? 2;
    $("erpSaveShortcut").value = d.save_shortcut || "";
    $("erpGridColumns").value = d.grid_columns || "";
}

// ── 설정 점검 배너 ──
async function loadSetupCheck() {
    const d = await api("GET", "/api/setup/check");
    const banner = $("setupBanner");
    banner.classList.remove("hidden");
    banner.classList.toggle("ok", d.all_required_ok);
    const head = d.all_required_ok
        ? "✓ 필수 설정 완료"
        : `⚠ 필수 설정 ${d.required_missing_count}개 미완료`;
    const lis = d.items
        .filter((it) => it.status !== "ok")
        .map((it) => `<li class="${it.status === "error" ? "err" : "warn"}">${it.label}: ${it.message}${it.hint ? " — " + it.hint : ""}</li>`)
        .join("");
    banner.innerHTML = `<strong>${head}</strong>` + (lis ? `<ul>${lis}</ul>` : "");
}

// ── 이벤트 바인딩 ──
function bind() {
    $("btnSourceSave").onclick = async () => {
        try { const d = await api("PUT", "/api/source", { source: selectedSource() }); setResult("sourceTestResult", d.message, true); loadSetupCheck(); }
        catch (e) { setResult("sourceTestResult", e.message, false); }
    };
    $("btnSourceTest").onclick = async () => {
        setResult("sourceTestResult", "테스트 중...", true);
        try { const d = await api("POST", "/api/source/test"); setResult("sourceTestResult", d.message, d.ok); }
        catch (e) { setResult("sourceTestResult", e.message, false); }
    };
    $("btnErpSettingsSave").onclick = async () => {
        const body = {
            window_title: $("erpWindowTitle").value,
            launch_path: $("erpLaunchPath").value,
            login_pw: $("erpLoginPw").value,
            target_menu: $("erpTargetMenu").value,
            first_field_tabs: parseInt($("erpFirstFieldTabs").value || "0", 10),
            save_shortcut: $("erpSaveShortcut").value,
            grid_columns: $("erpGridColumns").value,
        };
        try { const d = await api("PUT", "/api/erp/settings", body); setResult("erpSettingsResult", d.message, true); loadSetupCheck(); }
        catch (e) { setResult("erpSettingsResult", e.message, false); }
    };
    $("btnFetch").onclick = async () => {
        try { const d = await api("POST", "/api/reports/fetch"); logLine(d.message); }
        catch (e) { logLine(e.message, "err"); }
    };
    $("btnErpTest").onclick = async () => {
        try {
            const d = await api("POST", "/api/erp/test");
            logLine(d.connected ? `✓ ERP 창 발견: ${d.window_title}` : `✗ ${d.error}`, d.connected ? null : "err");
        } catch (e) { logLine(e.message, "err"); }
    };
    $("btnCalib").onclick = () => showCalibPanel();
    $("btnCalibClose").onclick = () => $("calibPanel").classList.add("hidden");
    $("btnCalibReload").onclick = () => loadCalib();
    $("btnCalibSave").onclick = async () => {
        const rows = document.querySelectorAll("#calibBody tr");
        const fields = [];
        rows.forEach(tr => {
            fields.push({
                label: tr.dataset.label,
                ref_x: parseInt(tr.querySelector("input.ref-x").value, 10),
                ref_y: parseInt(tr.querySelector("input.ref-y").value, 10),
            });
        });
        try {
            const d = await api("PUT", "/api/field-mapping", { fields });
            setResult("calibResult", d.message, true);
            logLine(`✓ ${d.message}`);
        } catch (e) {
            setResult("calibResult", e.message, false);
        }
    };
    $("btnStart").onclick = async () => {
        try { const d = await api("POST", "/api/erp/start", { mode: "pywinauto" }); setResult("runStatus", d.message, true); }
        catch (e) { setResult("runStatus", e.message, false); }
    };
    $("btnPause").onclick = async () => {
        try { const d = await api("POST", "/api/erp/pause"); setResult("runStatus", d.message, true); }
        catch (e) { setResult("runStatus", e.message, false); }
    };
    $("btnStop").onclick = async () => {
        try { const d = await api("POST", "/api/erp/stop"); setResult("runStatus", d.message, true); }
        catch (e) { setResult("runStatus", e.message, false); }
    };
    $("btnRedoAll").onclick = async () => {
        const r = _reviewState.reports[_reviewState.page];
        if (!r) return;
        try { const d = await api("POST", "/api/erp/review/redo-all", { report_id: r.report_id }); setResult("reviewResult", d.message, true); }
        catch (e) { setResult("reviewResult", e.message, false); }
    };
    $("btnConfirm").onclick = async () => {
        const r = _reviewState.reports[_reviewState.page];
        if (!r) return;
        try {
            const d = await api("POST", "/api/erp/review/confirm", { report_id: r.report_id });
            setResult("reviewResult", d.message, true);
            r.status = "confirmed";
            // 다음 미확인 페이지로 자동 이동
            const next = _reviewState.reports.findIndex((x, i) => i > _reviewState.page && x.status !== "confirmed");
            if (next >= 0) _reviewState.page = next;
            renderReviewPage();
        } catch (e) { setResult("reviewResult", e.message, false); }
    };
    const btnConfirmAll = $("btnConfirmAll");
    if (btnConfirmAll) btnConfirmAll.onclick = async () => {
        if (!confirm(`${_reviewState.reports.length}건 모두 완료로 표시하시겠습니까?`)) return;
        try {
            const d = await api("POST", "/api/erp/review/confirm", { report_id: null });
            setResult("reviewResult", d.message, true);
            _reviewState.reports.forEach(x => x.status = "confirmed");
            hideReviewPanel();
        } catch (e) { setResult("reviewResult", e.message, false); }
    };
    // 검토 페이지 이동
    const btnPrev = $("btnReviewPrev");
    const btnNext = $("btnReviewNext");
    if (btnPrev) btnPrev.onclick = () => { _reviewState.page = Math.max(0, _reviewState.page - 1); renderReviewPage(); };
    if (btnNext) btnNext.onclick = () => { _reviewState.page = _reviewState.page + 1; renderReviewPage(); };
}

// ── 캘리브레이션 패널 ──

async function showCalibPanel() {
    $("calibPanel").classList.remove("hidden");
    await loadCalib();
    $("calibPanel").scrollIntoView({ behavior: "smooth" });
}

async function loadCalib() {
    setResult("calibResult", "불러오는 중...", true);
    try {
        const d = await api("GET", "/api/field-mapping");
        const tbody = $("calibBody");
        tbody.innerHTML = "";
        (d.fields || []).forEach(f => {
            const tr = document.createElement("tr");
            tr.dataset.label = f.label;
            const valueDisplay = f.literal ? `literal: "${f.literal}"`
                                : f.ncr_key ? `key: ${f.ncr_key}`
                                : "—";
            tr.innerHTML = `
                <td>${f.index}</td>
                <td>${escapeHtml(f.label)}</td>
                <td><input class="ref-x" type="number" value="${f.ref_x ?? ''}" style="width:80px"></td>
                <td><input class="ref-y" type="number" value="${f.ref_y ?? ''}" style="width:80px"></td>
                <td><span class="muted">${escapeHtml(f.method)}</span></td>
                <td><span class="muted">${escapeHtml(valueDisplay)}</span></td>
            `;
            tbody.appendChild(tr);
        });
        const cal = d.calibration || {};
        const ref = cal.ref_resolution ? cal.ref_resolution.join("x") : "1920x1080";
        setResult("calibResult", `${d.fields.length}개 필드 로드됨 (ref: ${ref})`, true);
    } catch (e) {
        setResult("calibResult", e.message, false);
    }
}

function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// 새로고침 후 검토 중이었으면 복원
async function restoreReviewState() {
    try {
        const d = await api("GET", "/api/erp/review");
        if (d.active) {
            showReviewPanel({ report_id: d.report_id, steps: d.steps });
        }
    } catch (e) { /* ignore */ }
}

window.addEventListener("DOMContentLoaded", () => {
    bind();
    connectWS("/ws/progress", handleProgress);
    connectWS("/ws/erp-log", handleErp);
    loadSource().catch((e) => logLine("소스 로드 실패: " + e.message, "err"));
    loadErpSettings().catch((e) => logLine("ERP 설정 로드 실패: " + e.message, "err"));
    loadSetupCheck().catch(() => {});
    restoreReviewState().catch(() => {});
    logLine("대시보드 준비 완료");
});
