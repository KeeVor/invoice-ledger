import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { existsSync, appendFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { app } from "electron";

export class OCRWorker {
  child: ChildProcessWithoutNullStreams | null = null;
  pending = new Map<
    string,
    {
      resolve: (v: any[]) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  buffer = "";
  constructor(private dataDir: string) {}
  executable() {
    return app.isPackaged
      ? join(process.resourcesPath, "ocr", "invoice-worker.exe")
      : join(app.getAppPath(), ".venv", "Scripts", "python.exe");
  }
  available() {
    return existsSync(this.executable());
  }
  start() {
    if (this.child) return;
    if (!this.available())
      throw new Error(
        "本地识别引擎未安装。开发环境请运行 npm run python:setup；安装版请重新安装完整软件。",
      );
    const args = app.isPackaged
      ? []
      : ["-u", join(app.getAppPath(), "python", "worker.py")];
    this.buffer = "";
    const child = spawn(this.executable(), args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        ...(app.isPackaged
          ? {}
          : { INVOICE_MODELS: join(app.getAppPath(), "python", "models") }),
      },
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      this.buffer += chunk;
      if (this.buffer.length > 30_000_000) {
        this.stop("识别返回内容过大");
        return;
      }
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        try {
          const result = JSON.parse(line),
            p = this.pending.get(result.id);
          if (!p) continue;
          clearTimeout(p.timer);
          this.pending.delete(result.id);
          result.error
            ? p.reject(new Error(result.error))
            : p.resolve(result.results);
        } catch {
          /* Third-party diagnostics are not part of the response protocol. */
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      const log = join(this.dataDir, "engine.log");
      try {
        if (existsSync(log) && statSync(log).size > 2_000_000)
          writeFileSync(log, "");
        appendFileSync(log, chunk);
      } catch {
        /* Logging must not interrupt recognition. */
      }
    });
    child.on("error", (error) => {
      if (this.child === child) this.fail(error);
    });
    child.on("exit", () => {
      if (this.child === child) {
        this.child = null;
        this.fail(new Error("识别进程已退出，请重试"));
      }
    });
    child.stdin.on("error", (error) => {
      if (this.child === child) this.fail(error);
    });
  }
  fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  stop(message = "识别已取消") {
    const child = this.child;
    this.child = null;
    child?.kill();
    this.fail(new Error(message));
    this.buffer = "";
  }
  run(path: string, outputDir: string): Promise<any[]> {
    this.start();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () => this.stop("单个文件识别超时（10 分钟），请拆分或缩小后重试"),
        600000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, path, outputDir }) + "\n");
    });
  }
}
