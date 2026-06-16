import net from "node:net"
import { execFileSync } from "node:child_process"

const SOURCE = "herdr:opencode"
const AGENT = "opencode"
const DISPLAY_AGENT = "mimocode"
let reportSeq = Date.now() * 1000
let released = false

function nextReportSeq() {
  reportSeq += 1
  return reportSeq
}

function sessionIDFromProperties(properties: any): string | undefined {
  return typeof properties?.sessionID === "string" && properties.sessionID
    ? properties.sessionID
    : undefined
}

function request(method: string, params: Record<string, any>): Promise<void> {
  const paneId = process.env.HERDR_PANE_ID
  const socketPath = process.env.HERDR_SOCKET_PATH

  if (!paneId || !socketPath) {
    return Promise.resolve()
  }

  const requestId = `${SOURCE}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`
  const req = {
    id: requestId,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      seq: nextReportSeq(),
      ...params,
    },
  }

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      client.write(`${JSON.stringify(req)}\n`)
    })

    const finish = () => {
      client.destroy()
      resolve()
    }

    client.setTimeout(500, finish)
    client.on("data", finish)
    client.on("error", finish)
    client.on("end", finish)
    client.on("close", resolve)
  })
}

function reportSession(sessionID: string | undefined) {
  if (!sessionID) {
    return Promise.resolve()
  }
  return request("pane.report_agent_session", { agent_session_id: sessionID })
}

function reportState(state: string, sessionID?: string) {
  const params: Record<string, any> = { state }
  if (sessionID) {
    params.agent_session_id = sessionID
  }
  return request("pane.report_agent", params)
}

function reportDisplayAgent() {
  return request("pane.report_metadata", {
    source: "user:mimocode-herdr",
    applies_to_source: SOURCE,
    display_agent: DISPLAY_AGENT,
  })
}

async function releaseAgent() {
  if (released) return
  released = true
  return request("pane.release_agent", {})
}

function releaseAgentSync() {
  if (released) return
  released = true
  const paneId = process.env.HERDR_PANE_ID
  const socketPath = process.env.HERDR_SOCKET_PATH
  if (!paneId || !socketPath) return
  const payload = JSON.stringify({
    id: `release:${Date.now()}`,
    method: "pane.release_agent",
    params: { pane_id: paneId, source: SOURCE, agent: AGENT },
  })
  try {
    execFileSync("node", ["-e", `require("net").createConnection(${JSON.stringify(socketPath)}).end(${JSON.stringify(payload)}+"\\n")`], {
      timeout: 500,
      stdio: "ignore",
    })
  } catch {}
}

function registerExitHandlers() {
  process.once("SIGINT", () => { releaseAgentSync(); process.exit(130) })
  process.once("SIGTERM", () => { releaseAgentSync(); process.exit(143) })
  process.on("beforeExit", () => { releaseAgentSync() })
}

export const HerdrAgentState = async () => {
  if (
    process.env.HERDR_ENV !== "1" ||
    !process.env.HERDR_SOCKET_PATH ||
    !process.env.HERDR_PANE_ID
  ) {
    return {}
  }

  registerExitHandlers()
  await reportState("idle")
  await reportDisplayAgent()

  return {
    "chat.message": async ({ sessionID }: { sessionID: string }) => {
      await reportState("working", sessionID)
    },
    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      const type = event?.type
      const properties = event?.properties ?? {}
      const sessionID = sessionIDFromProperties(properties)

      switch (type) {
        case "session.created":
        case "session.updated":
          await reportSession(sessionID)
          break
        case "session.status": {
          const info = properties.status
          if (info && typeof info === "object" && typeof info.type === "string") {
            if (info.type === "idle") {
              await reportState("idle", sessionID)
            } else if (info.type === "busy") {
              await reportState("working", sessionID)
            }
          }
          break
        }
        case "tool.execute.before":
        case "tool.execute.after":
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
        case "session.compacted":
          await reportState("working", sessionID)
          break
        case "permission.asked":
        case "question.asked":
        case "session.error":
          await reportState("blocked", sessionID)
          break
        case "session.idle":
          await reportState("idle", sessionID)
          break
        case "session.deleted":
          await releaseAgent()
          break
        default:
          break
      }
    },
  }
}
