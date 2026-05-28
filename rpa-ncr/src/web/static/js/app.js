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
    }
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
}

window.addEventListener("DOMContentLoaded", () => {
    bind();
    connectWS("/ws/progress", handleProgress);
    connectWS("/ws/erp-log", handleErp);
    loadSource().catch((e) => logLine("소스 로드 실패: " + e.message, "err"));
    loadErpSettings().catch((e) => logLine("ERP 설정 로드 실패: " + e.message, "err"));
    loadSetupCheck().catch(() => {});
    logLine("대시보드 준비 완료");
});
