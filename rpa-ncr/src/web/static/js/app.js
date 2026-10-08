// NCR → UNIERP RPA 대시보드 클라이언트 (2026 재편)
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])));

// ───── Log pane ─────
function logLine(msg, cls) {
    const pane = $("logPane");
    if (!pane) return;
    const div = document.createElement("div");
    if (cls) div.className = cls;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    pane.appendChild(div);
    pane.scrollTop = pane.scrollHeight;
}

// ───── API helper ─────
async function api(method, url, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    let data = null;
    try { data = await resp.json(); } catch { /* no body */ }
    if (!resp.ok) {
        const err = (data && (data.error || data.message)) || resp.statusText;
        throw new Error(err);
    }
    return data;
}
function setResult(id, msg, ok) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.className = "result " + (ok ? "ok" : "err");
}

// ───── 상태바 (chips) ─────
function setChip(id, text, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = "chip chip-" + (kind || "neutral");
}

function updateQueueChip(queue) {
    if (!queue || queue.length === 0) {
        setChip("chipQueue", "큐 비어있음", "neutral");
        return;
    }
    const total = queue.length;
    const done = queue.filter(q => /완료|저장됨/.test(q.status)).length;
    const err = queue.filter(q => /오류|실패/.test(q.status)).length;
    const kind = err > 0 ? "err" : (done === total ? "ok" : "neutral");
    setChip("chipQueue", `큐 ${done}/${total} 완료${err ? ` · 오류 ${err}` : ""}`, kind);
}

// ───── 큐 테이블 ─────
function statusPill(status) {
    if (!status) return `<span class="pill pill-pending">대기</span>`;
    const s = String(status).trim();
    if (/완료|COMPLETED/i.test(s))     return `<span class="pill pill-completed">${esc(s)}</span>`;
    if (/저장됨|REVIEW/i.test(s))      return `<span class="pill pill-review">${esc(s)}</span>`;
    if (/오류|실패|FAILED/i.test(s))   return `<span class="pill pill-failed">${esc(s)}</span>`;
    if (/입력|PROCESSING/i.test(s))    return `<span class="pill pill-processing">${esc(s)}</span>`;
    return `<span class="pill pill-pending">${esc(s)}</span>`;
}

function retryBadge(count, lastError) {
    const n = Number(count || 0);
    if (!n) return `<span class="retry-badge zero">-</span>`;
    const title = lastError ? `마지막 오류: ${lastError}` : `재시도 ${n}회`;
    return `<span class="retry-badge" title="${esc(title)}">↻ ${n}</span>`;
}

function qcBadge(qc) {
    if (!qc) return `<span class="muted">—</span>`;
    const s = String(qc);
    if (/APPROVED/i.test(s))   return `<span class="pill pill-completed">승인</span>`;
    if (/ERP_SYNCED/i.test(s)) return `<span class="pill pill-completed">ERP</span>`;
    if (/REVIEW/i.test(s))     return `<span class="pill pill-review">검토</span>`;
    return `<span class="pill pill-pending">${esc(s)}</span>`;
}

function renderQueue(queue) {
    const body = $("queueBody");
    $("queueCount").textContent = queue && queue.length ? `(${queue.length}건)` : "";
    updateQueueChip(queue);
    if (!queue || queue.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="muted empty-row">조회된 보고 없음 — 상단 [PENDING 조회]</td></tr>';
        return;
    }
    body.innerHTML = "";
    queue.forEach((q) => {
        const tr = document.createElement("tr");
        tr.dataset.index = q.index;
        tr.innerHTML =
            `<td>${q.index + 1}</td>` +
            `<td>${q.id}</td>` +
            `<td>${esc(q.ncr_number || "")}</td>` +
            `<td>${esc(q.item_code || "")}</td>` +
            `<td>${qcBadge(q.qc_status)}</td>` +
            `<td class="qstatus">${statusPill(q.status)}<div class="qprogress muted" style="font-size:11px">${esc(q.progress || "")}</div></td>` +
            `<td class="qretry">${retryBadge(q.attempt_count, q.last_error)}</td>`;
        body.appendChild(tr);
    });
}

function updateQueueRow(index, status, progress) {
    const tr = $("queueBody").querySelector(`tr[data-index="${index}"]`);
    if (!tr) return;
    const st = tr.querySelector(".qstatus");
    st.innerHTML = statusPill(status) +
        `<div class="qprogress muted" style="font-size:11px">${esc(progress || "")}</div>`;
    // 큐 전체 상태바 갱신: DOM 에서 수집
    const q = [...$("queueBody").querySelectorAll("tr")]
        .map(r => ({ status: r.querySelector(".pill")?.textContent || "대기" }));
    updateQueueChip(q);
}

// ───── WebSocket ─────
function connectWS(path, onMessage) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}${path}`);
    ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch { /* ignore */ } };
    ws.onclose = () => setTimeout(() => connectWS(path, onMessage), 2000);
    return ws;
}

function handleProgress(d) {
    if (d.type === "fetched") {
        renderQueue(d.queue);
        logLine(`PENDING 보고 ${d.count}건 조회됨`, "ok");
    } else if (d.type === "error") {
        logLine(`조회 오류: ${d.message}`, "err");
    }
}

function handleErp(d) {
    if (d.type === "log") {
        const cls = /오류|실패/.test(d.message) ? "err"
                  : /⚠|warn/i.test(d.message)  ? "warn"
                  : /✓|OK|성공/i.test(d.message) ? "ok" : null;
        logLine(d.message, cls);
    } else if (d.type === "queue_update") {
        updateQueueRow(d.index, d.status, d.progress);
    } else if (d.type === "connection") {
        setChip("chipErp", d.connected ? "ERP 연결됨" : "ERP 미연결", d.connected ? "ok" : "err");
        logLine((d.connected ? "✓ " : "✗ ") + d.message, d.connected ? "ok" : "err");
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

// ───── 배치 검토 ─────
let _reviewState = { reports: [], page: 0 };

function showReviewPanel(d) {
    const panel = $("reviewPanel");
    panel.classList.remove("hidden");
    $("reviewResult").textContent = "";
    if (Array.isArray(d.reports)) {
        _reviewState = { reports: d.reports, page: 0 };
    } else if (d.steps) {
        _reviewState = { reports: [{ report_id: d.report_id, steps: d.steps, status: "pending" }], page: 0 };
    } else {
        _reviewState = { reports: [], page: 0 };
    }
    renderReviewPage();
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderReviewPage() {
    const { reports, page } = _reviewState;
    const total = reports.length;
    if (total === 0) { hideReviewPanel(); return; }
    const cur = Math.max(0, Math.min(page, total - 1));
    _reviewState.page = cur;
    const r = reports[cur];

    const statusBadge = r.status === "confirmed"
        ? '<span class="pill pill-completed">✓ 확인됨</span>'
        : '<span class="pill pill-review">대기 중</span>';
    const formTag = r.form_id
        ? ` <span class="pill pill-processing">${esc(r.form_id)}${r.phase ? ` · P${r.phase}` : ''}</span>`
        : '';
    $("reviewReportLabel").innerHTML = `보고 #${r.report_id}${formTag} ${statusBadge}`;

    const tbody = $("reviewSteps");
    tbody.innerHTML = "";
    (r.steps || []).forEach((s) => {
        const tr = document.createElement("tr");
        const valDisplay = s.value === "" || s.value === null ? "—" : s.value;
        const isSkip = s.method === "skip" || s.skippable;
        tr.innerHTML =
            `<td>${s.idx + 1}</td><td>${esc(s.label)}</td>` +
            `<td><code>${esc(String(valDisplay))}</code></td>` +
            `<td class="muted">${esc(s.method)}</td>` +
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

    const uniqueReports = new Set(reports.map(x => x.report_id)).size;
    const uniqueConfirmed = new Set(reports.filter(x => x.status === "confirmed").map(x => x.report_id)).size;
    const pager = $("reviewPager");
    if (pager) pager.textContent = `엔트리 ${cur + 1}/${total}  (보고 ${uniqueConfirmed}/${uniqueReports} 확인)`;

    const btnPrev = $("btnReviewPrev");
    const btnNext = $("btnReviewNext");
    if (btnPrev) btnPrev.disabled = cur === 0;
    if (btnNext) btnNext.disabled = cur >= total - 1;

    const btnConfirm = $("btnConfirm");
    if (btnConfirm) {
        btnConfirm.disabled = r.status === "confirmed";
        btnConfirm.textContent = r.status === "confirmed" ? "이미 확인됨" : "이 보고 완료";
    }
}

function hideReviewPanel() {
    $("reviewPanel").classList.add("hidden");
    _reviewState = { reports: [], page: 0 };
}

// ───── 설정 로드 ─────
async function loadSource() {
    const d = await api("GET", "/api/source");
    document.querySelectorAll('input[name="source"]').forEach((r) => { r.checked = r.value === d.source; });
    const info = $("sourceInfo");
    if (info) info.textContent = `API: ${d.api_base_url || "(미설정)"} · DB: ${d.db_configured ? "설정됨" : "미설정"}`;
    const label = d.source === "db" ? "DB (Neon)" : "API (리플릿)";
    setChip("chipSource", `소스: ${label}`, d.db_configured || d.api_base_url ? "ok" : "warn");
}
function selectedSource() {
    const r = document.querySelector('input[name="source"]:checked');
    return r ? r.value : "api";
}

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

async function loadSetupCheck() {
    try {
        const d = await api("GET", "/api/setup/check");
        const banner = $("setupBanner");
        if (!banner) return;
        if (d.all_required_ok && d.recommended_missing_count === 0) {
            banner.classList.add("hidden");
            return;
        }
        banner.classList.remove("hidden");
        banner.classList.toggle("ok", d.all_required_ok);
        const head = d.all_required_ok
            ? "✓ 필수 설정 완료"
            : `⚠ 필수 설정 ${d.required_missing_count}개 미완료`;
        const lis = d.items
            .filter((it) => it.status !== "ok")
            .map((it) => `<li class="${it.status === "error" ? "err" : "warn"}">${esc(it.label)}: ${esc(it.message)}${it.hint ? " — " + esc(it.hint) : ""}</li>`)
            .join("");
        banner.innerHTML = `<strong>${head}</strong>` + (lis ? `<ul>${lis}</ul>` : "");
    } catch { /* ignore */ }
}

// ───── Drawer ─────
function openDrawer() {
    const d = $("settingsDrawer");
    d.classList.remove("hidden");
    requestAnimationFrame(() => d.classList.add("open"));
    d.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
    const d = $("settingsDrawer");
    d.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
    setTimeout(() => d.classList.add("hidden"), 220);
}

// ───── Modal ─────
function openModal(id) {
    const m = $(id);
    m.classList.remove("hidden");
    m.setAttribute("aria-hidden", "false");
}
function closeModal(id) {
    const m = $(id);
    m.classList.add("hidden");
    m.setAttribute("aria-hidden", "true");
}

// ───── Updater ─────
const Updater = {
    lastResult: null,

    async check(openModalOnFound) {
        try {
            const data = await api("GET", "/api/update/check");
            Updater.lastResult = data;
            Updater._renderBadge(data);
            Updater._render(data);
            if (openModalOnFound && data.update_available) openModal("updateModal");
        } catch (e) {
            logLine(`업데이트 확인 실패: ${e.message}`, "warn");
            const body = $("updateModalBody");
            if (body) body.innerHTML = `<div class="result err">업데이트 확인 실패: ${esc(e.message)}</div>`;
        }
    },

    _renderBadge(data) {
        // 배지는 항상 보임 — 상태만 다름 (사내망에서 원격 조회 실패해도 사용자가 버튼 발견 가능).
        const btn = $("btnUpdateOpen");
        const lbl = $("updateBtnLabel");
        const dot = $("updateDot");
        if (!btn) return;
        btn.classList.remove("hidden");

        // 상태별 라벨 + 색상
        btn.classList.remove("update-new", "update-ok", "update-offline");
        if (!data) {
            if (lbl) lbl.textContent = "⬆ 업데이트";
            if (dot) dot.style.visibility = "hidden";
            return;
        }
        if (data.update_available) {
            // 새 버전 있음 — 깜빡이 강조
            btn.classList.add("update-new");
            if (lbl) lbl.textContent = "⬆ 새 업데이트";
            if (dot) dot.style.visibility = "visible";
        } else if (data.reason && /원격|조회|네트워크/i.test(data.reason)) {
            // 원격 조회 실패 (사내망 DNS 차단 등)
            btn.classList.add("update-offline");
            if (lbl) lbl.textContent = "⬆ 업데이트 (오프라인)";
            if (dot) dot.style.visibility = "hidden";
        } else {
            // 최신 상태
            btn.classList.add("update-ok");
            if (lbl) lbl.textContent = "⬆ 업데이트";
            if (dot) dot.style.visibility = "hidden";
        }
    },

    _render(data) {
        const body = $("updateModalBody");
        const btnApply = $("btnUpdateApply");
        if (!body) return;
        if (!data) {
            body.innerHTML = `<div class="muted">업데이트 정보 없음</div>`;
            if (btnApply) btnApply.classList.add("hidden");
            return;
        }
        const local = data.local_commit ? data.local_commit.slice(0, 10) : "(미확정)";
        const remote = data.remote_commit ? data.remote_commit.slice(0, 10) : "(미확인)";
        const msg = (data.remote_message || "").trim();
        let html = `<dl class="version-grid">
            <dt>현재</dt><dd>${esc(local)} <span class="muted">(${esc(data.mode || "?")})</span></dd>
            <dt>원격</dt><dd>${esc(remote)}</dd>
        </dl>`;
        if (data.update_available) {
            html += `<div style="margin-bottom:6px;font-weight:600">새 변경사항</div>
                     <div class="commit-box">${esc(msg || "(커밋 메시지 없음)")}</div>`;
            if (btnApply) btnApply.classList.remove("hidden");
        } else if (data.reason) {
            html += `<div class="result err">${esc(data.reason)}</div>`;
            if (btnApply) btnApply.classList.add("hidden");
        } else {
            html += `<div class="result ok">✓ 최신 버전입니다.</div>`;
            if (btnApply) btnApply.classList.add("hidden");
        }
        body.innerHTML = html;
    },

    async apply() {
        const btnApply = $("btnUpdateApply");
        if (btnApply) { btnApply.disabled = true; btnApply.textContent = "업데이트 중..."; }
        try {
            const data = await api("POST", "/api/update/apply", {});
            const body = $("updateModalBody");
            if (data.success) {
                if (body) body.innerHTML = `<div class="result ok">✓ 업데이트 완료 — 프로그램을 재시작하세요.</div>
                    <div class="muted" style="margin-top:8px">${esc(data.message || "")}</div>`;
                if (btnApply) btnApply.classList.add("hidden");
            } else {
                if (body) body.innerHTML = `<div class="result err">업데이트 실패: ${esc(data.message || "")}</div>`;
                if (btnApply) { btnApply.disabled = false; btnApply.textContent = "지금 업데이트"; }
            }
        } catch (e) {
            const body = $("updateModalBody");
            if (body) body.innerHTML = `<div class="result err">업데이트 오류: ${esc(e.message)}</div>`;
            if (btnApply) { btnApply.disabled = false; btnApply.textContent = "지금 업데이트"; }
        }
    },

    async applyForce() {
        const btnForce = $("btnUpdateForce");
        if (!confirm("원격 조회 없이 main branch 를 바로 받아 전체 교체합니다.\n(사내망에서 DNS 로 remote SHA 조회가 안 될 때 사용)\n계속할까요?")) return;
        if (btnForce) { btnForce.disabled = true; btnForce.textContent = "강제 재다운 중..."; }
        try {
            const data = await api("POST", "/api/update/force", {});
            const body = $("updateModalBody");
            if (data.success) {
                if (body) body.innerHTML = `<div class="result ok">✓ 강제 재다운 완료 — 프로그램을 재시작하세요.</div>
                    <div class="muted" style="margin-top:8px">${esc(data.message || "")}</div>
                    <div class="muted" style="margin-top:4px">※ SHA 추적 불가 — 다음 체크 때 "오프라인" 표시 가능</div>`;
            } else {
                if (body) body.innerHTML = `<div class="result err">강제 재다운 실패: ${esc(data.message || "")}</div>`;
            }
        } catch (e) {
            const body = $("updateModalBody");
            if (body) body.innerHTML = `<div class="result err">강제 재다운 오류: ${esc(e.message)}</div>`;
        } finally {
            if (btnForce) { btnForce.disabled = false; btnForce.textContent = "🔄 최신 강제 재다운"; }
        }
    },
};

// ───── 이벤트 바인딩 ─────
function bind() {
    // 데이터 소스
    $("btnSourceSave").onclick = async () => {
        try { const d = await api("PUT", "/api/source", { source: selectedSource() });
            setResult("sourceTestResult", d.message, true); loadSetupCheck(); loadSource(); }
        catch (e) { setResult("sourceTestResult", e.message, false); }
    };
    $("btnSourceTest").onclick = async () => {
        setResult("sourceTestResult", "테스트 중...", true);
        try { const d = await api("POST", "/api/source/test"); setResult("sourceTestResult", d.message, d.ok); }
        catch (e) { setResult("sourceTestResult", e.message, false); }
    };
    // ERP 설정
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
    // 실행
    $("btnFetch").onclick = async () => {
        try { const d = await api("POST", "/api/reports/fetch"); logLine(d.message, "ok"); }
        catch (e) { logLine(e.message, "err"); }
    };
    $("btnErpTest").onclick = async () => {
        try {
            const d = await api("POST", "/api/erp/test");
            setChip("chipErp", d.connected ? "ERP 연결됨" : "ERP 미연결", d.connected ? "ok" : "err");
            logLine(d.connected ? `✓ ERP 창 발견: ${d.window_title}` : `✗ ${d.error}`, d.connected ? "ok" : "err");
        } catch (e) { logLine(e.message, "err"); }
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
    // 검토 패널
    $("btnRedoAll").onclick = async () => {
        const r = _reviewState.reports[_reviewState.page]; if (!r) return;
        try { const d = await api("POST", "/api/erp/review/redo-all", { report_id: r.report_id });
            setResult("reviewResult", d.message, true); }
        catch (e) { setResult("reviewResult", e.message, false); }
    };
    $("btnConfirm").onclick = async () => {
        const r = _reviewState.reports[_reviewState.page]; if (!r) return;
        try {
            const d = await api("POST", "/api/erp/review/confirm", { report_id: r.report_id });
            setResult("reviewResult", d.message, true);
            r.status = "confirmed";
            const next = _reviewState.reports.findIndex((x, i) => i > _reviewState.page && x.status !== "confirmed");
            if (next >= 0) _reviewState.page = next;
            renderReviewPage();
        } catch (e) { setResult("reviewResult", e.message, false); }
    };
    $("btnConfirmAll").onclick = async () => {
        if (!confirm(`${_reviewState.reports.length}건 모두 완료로 표시하시겠습니까?`)) return;
        try {
            const d = await api("POST", "/api/erp/review/confirm", { report_id: null });
            setResult("reviewResult", d.message, true);
            _reviewState.reports.forEach(x => x.status = "confirmed");
            hideReviewPanel();
        } catch (e) { setResult("reviewResult", e.message, false); }
    };
    $("btnReviewPrev").onclick = () => { _reviewState.page = Math.max(0, _reviewState.page - 1); renderReviewPage(); };
    $("btnReviewNext").onclick = () => { _reviewState.page = _reviewState.page + 1; renderReviewPage(); };

    // 로그 접기
    $("btnLogToggle").onclick = () => {
        const pane = $("logPane");
        const btn = $("btnLogToggle");
        pane.classList.toggle("collapsed");
        btn.textContent = pane.classList.contains("collapsed") ? "펼치기" : "접기";
    };

    // Drawer
    $("btnOpenSettings").onclick = openDrawer;
    $("btnCloseSettings").onclick = closeDrawer;

    // Update modal
    $("btnUpdateOpen").onclick = () => { openModal("updateModal"); Updater.check(false); };
    $("btnUpdateRecheck").onclick = () => Updater.check(false);
    $("btnUpdateApply").onclick = () => Updater.apply();
    $("btnUpdateForce").onclick = () => Updater.applyForce();
    document.querySelectorAll("[data-close-modal]").forEach(el => {
        el.onclick = () => closeModal("updateModal");
    });

    // ESC 로 drawer/modal 닫기
    document.addEventListener("keydown", (ev) => {
        if (ev.key !== "Escape") return;
        if (!$("updateModal").classList.contains("hidden")) closeModal("updateModal");
        else if ($("settingsDrawer").classList.contains("open")) closeDrawer();
    });
}

// 새로고침 후 검토 중이었으면 복원
async function restoreReviewState() {
    try {
        const d = await api("GET", "/api/erp/review");
        if (d.active) {
            showReviewPanel({ reports: d.reports || [], report_id: d.report_id, steps: d.steps });
        }
    } catch { /* ignore */ }
}

window.addEventListener("DOMContentLoaded", () => {
    bind();
    connectWS("/ws/progress", handleProgress);
    connectWS("/ws/erp-log", handleErp);
    loadSource().catch((e) => logLine("소스 로드 실패: " + e.message, "err"));
    loadErpSettings().catch((e) => logLine("ERP 설정 로드 실패: " + e.message, "err"));
    loadSetupCheck().catch(() => {});
    restoreReviewState().catch(() => {});
    // 배경에서 1회 업데이트 체크 (모달 자동 오픈 X, 배지만)
    Updater.check(false).catch(() => {});
    logLine("대시보드 준비 완료", "ok");
});
