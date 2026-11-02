import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export type AgentId = "claude" | "codex";

export interface AgentStatus {
  id: AgentId;
  name: string;
  installed: boolean;
  binary: string | null;
  evidence: string[]; // human-readable reasons we think it's installed
}

export interface DetectOptions {
  home?: string;
  pathEnv?: string;
  platform?: NodeJS.Platform;
}

export async function detectAgents(opts: DetectOptions = {}): Promise<AgentStatus[]> {
  const home = opts.home ?? os.homedir();
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const platform = opts.platform ?? process.platform;

  const claudeBinary = await which("claude", pathEnv, platform);
  const claudeEvidence = [
    ...(claudeBinary ? [`claude CLI at ${claudeBinary}`] : []),
    ...((await exists(path.join(home, ".claude"))) ? ["~/.claude config directory"] : []),
    ...(platform === "darwin" && (await exists("/Applications/Claude.app")) ? ["Claude desktop app"] : []),
  ];

  const codexBinary = await which("codex", pathEnv, platform);
  const codexEvidence = [
    ...(codexBinary ? [`codex CLI at ${codexBinary}`] : []),
    ...((await exists(path.join(home, ".codex"))) ? ["~/.codex config directory"] : []),
  ];

  return [
    { id: "claude", name: "Claude Code", installed: claudeEvidence.length > 0, binary: claudeBinary, evidence: claudeEvidence },
    { id: "codex", name: "Codex", installed: codexEvidence.length > 0, binary: codexBinary, evidence: codexEvidence },
  ];
}

async function which(cmd: string, pathEnv: string, platform: NodeJS.Platform): Promise<string | null> {
  const exts = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
