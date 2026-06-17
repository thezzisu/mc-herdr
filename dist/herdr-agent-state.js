import net from "node:net";
const SOURCE = "herdr:opencode";
const AGENT = "opencode";
const DISPLAY_AGENT = "mimocode";
let reportSeq = Date.now() * 1000;
// herdr's full_lifecycle_hook_report_is_suppressed mechanism adds the source to
// a suppression set after release_agent. Subsequent reports from the same source
// WITHOUT an agent_session_id are silently rejected (the API still returns ok).
// To work around this, we generate a unique session ID on plugin load and include
// it in every report and release request. This is a workaround for a herdr design
// limitation — ideally herdr would not require a session_ref for basic state reporting.
const pluginSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function nextReportSeq() {
    reportSeq += 1;
    return reportSeq;
}
function sessionIDFromProperties(properties) {
    return typeof properties?.sessionID === "string" && properties.sessionID
        ? properties.sessionID
        : undefined;
}
function request(method, params) {
    const paneId = process.env.HERDR_PANE_ID;
    const socketPath = process.env.HERDR_SOCKET_PATH;
    if (!paneId || !socketPath)
        return Promise.resolve();
    const requestId = `${SOURCE}:${Date.now()}:${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`;
    const req = {
        id: requestId,
        method,
        params: { pane_id: paneId, source: SOURCE, agent: AGENT, seq: nextReportSeq(), ...params },
    };
    return new Promise((resolve) => {
        const client = net.createConnection(socketPath, () => {
            client.write(`${JSON.stringify(req)}\n`);
        });
        const finish = () => { client.destroy(); resolve(); };
        client.setTimeout(500, finish);
        client.on("data", finish);
        client.on("error", finish);
        client.on("end", finish);
        client.on("close", resolve);
    });
}
function reportSession(sessionID) {
    if (!sessionID)
        return Promise.resolve();
    return request("pane.report_agent_session", { agent_session_id: sessionID });
}
function reportState(state, sessionID) {
    return request("pane.report_agent", {
        state,
        agent_session_id: sessionID ?? pluginSessionId,
    });
}
function reportDisplayAgent() {
    return request("pane.report_metadata", {
        source: "user:mimocode-herdr",
        applies_to_source: SOURCE,
        display_agent: DISPLAY_AGENT,
    });
}
function releaseAgentSync() {
    const paneId = process.env.HERDR_PANE_ID;
    const socketPath = process.env.HERDR_SOCKET_PATH;
    if (!paneId || !socketPath)
        return;
    const payload = JSON.stringify({
        id: `release:${Date.now()}`,
        method: "pane.release_agent",
        params: { pane_id: paneId, source: SOURCE, agent: AGENT, seq: nextReportSeq(), agent_session_id: pluginSessionId },
    });
    try {
        const { Worker } = require("node:worker_threads");
        const sab = new SharedArrayBuffer(4);
        const signal = new Int32Array(sab);
        const worker = new Worker(`const{createConnection}=require("net");const{workerData}=require("worker_threads");const{path,payload,sab}=workerData;const sig=new Int32Array(sab);const s=createConnection(path);s.on("connect",()=>s.end(payload+"\\n"));s.on("close",()=>{Atomics.store(sig,0,1);Atomics.notify(sig,0)});s.on("error",()=>{Atomics.store(sig,0,1);Atomics.notify(sig,0)});s.setTimeout(400,()=>s.destroy())`, { eval: true, workerData: { path: socketPath, payload, sab } });
        Atomics.wait(signal, 0, 0, 500);
        worker.terminate();
    }
    catch { }
}
export const HerdrAgentState = async () => {
    if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_SOCKET_PATH || !process.env.HERDR_PANE_ID) {
        return {};
    }
    // process.on("exit") is the primary cleanup path — mimo exits via
    // server.instance.disposed (a bus event, not a process signal), so
    // SIGINT/SIGTERM handlers are unreliable. The Worker + Atomics.wait
    // approach ensures the synchronous socket write completes before the
    // process terminates, without depending on external binaries or execPath.
    process.on("exit", () => { releaseAgentSync(); });
    await reportState("idle");
    await reportDisplayAgent();
    return {
        "chat.message": async ({ sessionID }) => {
            await reportState("working", sessionID);
        },
        event: async ({ event }) => {
            const type = event?.type;
            const properties = event?.properties ?? {};
            const sessionID = sessionIDFromProperties(properties);
            switch (type) {
                case "session.created":
                case "session.updated":
                    await reportSession(sessionID);
                    break;
                case "session.status": {
                    const info = properties.status;
                    if (info?.type === "idle")
                        await reportState("idle", sessionID);
                    else if (info?.type === "busy")
                        await reportState("working", sessionID);
                    break;
                }
                case "tool.execute.before":
                case "tool.execute.after":
                case "permission.replied":
                case "question.replied":
                case "question.rejected":
                case "session.compacted":
                    await reportState("working", sessionID);
                    break;
                case "permission.asked":
                case "question.asked":
                case "session.error":
                    await reportState("blocked", sessionID);
                    break;
                case "session.idle":
                    await reportState("idle", sessionID);
                    break;
                case "server.instance.disposed":
                    releaseAgentSync();
                    break;
            }
        },
    };
};
