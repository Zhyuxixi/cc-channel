import { homedir, platform } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isMacOS = platform() === "darwin";
const isLinux = platform() === "linux";
const isWindows = platform() === "win32";

const LAUNCH_AGENT_NAME = "com.cc-channel";
const SYSTEMD_SERVICE_NAME = "cc-channel";

function getLaunchAgentPath(): string {
  const dir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, `${LAUNCH_AGENT_NAME}.plist`);
}

function getSystemdServicePath(): string {
  const dir = join(homedir(), ".config", "systemd", "user");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, `${SYSTEMD_SERVICE_NAME}.service`);
}

function getWindowsStartupBatPath(): string {
  const dir = join(homedir(), ".cc-channel");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, "cc-channel-daemon.bat");
}

function getWindowsLogPath(): string {
  return join(homedir(), ".cc-channel", "logs");
}

function getNodePath(): string {
  return process.execPath;
}

function getDaemonScriptPath(): string {
  // __dirname is dist/daemon/ (this file is dist/daemon/service.js)
  // daemon.js is in dist/daemon.js
  return join(__dirname, "..", "daemon.js");
}

/**
 * Generate macOS LaunchAgent plist content
 */
function generateLaunchAgentPlist(): string {
  const nodePath = getNodePath();
  const daemonPath = getDaemonScriptPath();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${daemonPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/cc-channel.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/cc-channel.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${join(homedir(), ".local", "bin")}</string>
    </dict>
</dict>
</plist>`;
}

/**
 * Generate Linux systemd service content
 */
function generateSystemdService(): string {
  const nodePath = getNodePath();
  const daemonPath = getDaemonScriptPath();

  return `[Unit]
Description=CC-Channel - Feishu channel for Claude Code
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${daemonPath}
Restart=always
RestartSec=10
StandardOutput=file:/tmp/cc-channel.log
StandardError=file:/tmp/cc-channel.error.log
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${join(homedir(), ".local", "bin")}

[Install]
WantedBy=default.target
`;
}

/**
 * Generate Windows batch script to start daemon
 */
function generateWindowsStartupBat(): string {
  const nodePath = getNodePath();
  const daemonPath = getDaemonScriptPath();
  const logDir = getWindowsLogPath();

  // Ensure log directory exists
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const logPath = join(logDir, "cc-channel.log");
  const errorLogPath = join(logDir, "cc-channel-error.log");

  return `@echo off
cd /d "${homedir()}"
start /b "" "${nodePath}" "${daemonPath}" > "${logPath}" 2> "${errorLogPath}"
`;
}

export interface DaemonStatus {
  installed: boolean;
  running: boolean;
  platform: "macos" | "linux" | "windows" | "unsupported";
}

/**
 * Check if daemon is installed
 */
export function isDaemonInstalled(): boolean {
  if (isMacOS) {
    return existsSync(getLaunchAgentPath());
  }
  if (isLinux) {
    return existsSync(getSystemdServicePath());
  }
  if (isWindows) {
    return existsSync(getWindowsStartupBatPath());
  }
  return false;
}

/**
 * Install daemon service
 */
export async function installDaemon(): Promise<{ success: boolean; message: string }> {
  if (isMacOS) {
    const plistPath = getLaunchAgentPath();
    const plistContent = generateLaunchAgentPlist();

    writeFileSync(plistPath, plistContent);

    return {
      success: true,
      message: `LaunchAgent installed at ${plistPath}`,
    };
  }

  if (isLinux) {
    const servicePath = getSystemdServicePath();
    const serviceContent = generateSystemdService();

    writeFileSync(servicePath, serviceContent);

    return {
      success: true,
      message: `Systemd service installed at ${servicePath}. Run 'systemctl --user daemon-reload' to reload.`,
    };
  }

  if (isWindows) {
    const batPath = getWindowsStartupBatPath();
    const batContent = generateWindowsStartupBat();

    writeFileSync(batPath, batContent);

    return {
      success: true,
      message: `Windows startup script installed at ${batPath}. You can run it manually or add to startup.`,
    };
  }

  return {
    success: false,
    message: "Unsupported platform. Only macOS, Linux, and Windows are supported.",
  };
}

/**
 * Uninstall daemon service
 */
export async function uninstallDaemon(): Promise<{ success: boolean; message: string }> {
  if (isMacOS) {
    const plistPath = getLaunchAgentPath();

    if (existsSync(plistPath)) {
      // First unload if running
      try {
        const { execSync } = await import("child_process");
        execSync(`launchctl bootout gui/${process.getuid?.() ?? ""} ${LAUNCH_AGENT_NAME}`, {
          stdio: "ignore",
        });
      } catch {
        // Ignore errors if not loaded
      }

      unlinkSync(plistPath);
    }

    return {
      success: true,
      message: "LaunchAgent uninstalled",
    };
  }

  if (isLinux) {
    const servicePath = getSystemdServicePath();

    if (existsSync(servicePath)) {
      unlinkSync(servicePath);
    }

    return {
      success: true,
      message: "Systemd service uninstalled",
    };
  }

  if (isWindows) {
    const batPath = getWindowsStartupBatPath();

    // Stop the daemon first
    await stopDaemon();

    if (existsSync(batPath)) {
      unlinkSync(batPath);
    }

    return {
      success: true,
      message: "Windows startup script uninstalled",
    };
  }

  return {
    success: false,
    message: "Unsupported platform",
  };
}

/**
 * Start daemon service
 */
export async function startDaemon(): Promise<{ success: boolean; message: string }> {
  if (!isDaemonInstalled()) {
    await installDaemon();
  }

  if (isMacOS) {
    const { execSync } = await import("child_process");
    const plistPath = getLaunchAgentPath();
    const uid = process.getuid?.() ?? "";

    // First try to bootout in case service is in weird state
    try {
      execSync(`launchctl bootout gui/${uid} ${LAUNCH_AGENT_NAME}`, {
        stdio: "ignore",
      });
    } catch {
      // Ignore if not loaded
    }

    // Also try remove for cached entries with SIGKILL status
    try {
      execSync(`launchctl remove ${LAUNCH_AGENT_NAME}`, {
        stdio: "ignore",
      });
    } catch {
      // Ignore if not present
    }

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      execSync(`launchctl bootstrap gui/${uid} ${plistPath}`, {
        stdio: "pipe",
      });

      return {
        success: true,
        message: "Daemon started. Logs: /tmp/cc-channel.log",
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to start: ${err}`,
      };
    }
  }

  if (isLinux) {
    const { execSync } = await import("child_process");

    try {
      execSync("systemctl --user daemon-reload", { stdio: "pipe" });
      execSync(`systemctl --user start ${SYSTEMD_SERVICE_NAME}`, { stdio: "pipe" });
      execSync(`systemctl --user enable ${SYSTEMD_SERVICE_NAME}`, { stdio: "pipe" });

      return {
        success: true,
        message: "Daemon started. Logs: /tmp/cc-channel.log",
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to start: ${err}`,
      };
    }
  }

  if (isWindows) {
    const { spawn } = await import("child_process");
    const logDir = getWindowsLogPath();

    // Ensure log directory exists
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Kill any existing process first
    try {
      const { execSync } = await import("child_process");
      execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq cc-channel*"', {
        stdio: "ignore",
      });
    } catch {
      // Ignore if no process to kill
    }

    // Start the daemon using PowerShell Start-Process for background execution
    try {
      const nodePath = getNodePath();
      const daemonPath = getDaemonScriptPath();
      const logPath = join(logDir, "cc-channel.log");
      const errorLogPath = join(logDir, "cc-channel-error.log");

      // Use PowerShell to start a detached process with proper escaping
      const psArgs = [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath '${nodePath}' -ArgumentList '${daemonPath}' -WindowStyle Hidden -RedirectStandardOutput '${logPath}' -RedirectStandardError '${errorLogPath}'`,
      ];

      spawn("powershell", psArgs, {
        detached: true,
        stdio: "ignore",
        shell: false,
      });

      return {
        success: true,
        message: `Daemon started. Logs: ${logDir}\\cc-channel.log`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to start: ${err}`,
      };
    }
  }

  return {
    success: false,
    message: "Unsupported platform",
  };
}

/**
 * Stop daemon service
 */
export async function stopDaemon(): Promise<{ success: boolean; message: string }> {
  if (isMacOS) {
    const { execSync } = await import("child_process");

    // Step 1: Kill daemon processes first (while launchd is still managing)
    try {
      execSync("pkill -9 -f 'node.*cc-channel.*daemon.js'", { stdio: "ignore" });
    } catch {
      // Ignore if no process to kill
    }

    // Step 2: Wait for processes to terminate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Step 3: Bootout from launchd to stop managing
    try {
      execSync(`launchctl bootout gui/${process.getuid?.() ?? ""} ${LAUNCH_AGENT_NAME}`, {
        stdio: "ignore",
      });
    } catch {
      // Ignore if not loaded
    }

    // Step 3.5: Also remove cached entry (for SIGKILL'd services)
    try {
      execSync(`launchctl remove ${LAUNCH_AGENT_NAME}`, { stdio: "ignore" });
    } catch {
      // Ignore if not present
    }

    // Step 4: Verify process is stopped
    await new Promise((resolve) => setTimeout(resolve, 500));

    let stillRunning = false;
    try {
      const result = execSync("pgrep -f 'node.*cc-channel.*daemon.js'", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe"],
      });
      stillRunning = result.toString().trim().length > 0;
    } catch {
      // pgrep returns non-zero when no match
      stillRunning = false;
    }

    if (stillRunning) {
    // Force kill any remaining
    try {
      execSync("pkill -9 -f 'node.*cc-channel.*daemon.js'", { stdio: "ignore" });
    } catch {
      // Ignore
    }
    }

    return {
      success: true,
      message: "Daemon stopped",
    };
  }

  if (isLinux) {
    const { execSync } = await import("child_process");

    try {
      execSync(`systemctl --user stop ${SYSTEMD_SERVICE_NAME}`, { stdio: "pipe" });
    } catch {
      // Ignore errors
    }

    return {
      success: true,
      message: "Daemon stopped",
    };
  }

  if (isWindows) {
    const { execSync } = await import("child_process");

    // Kill node processes running cc-channel daemon
    try {
      // Find processes running daemon.js
      execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq cc-channel*"', {
        stdio: "ignore",
      });
    } catch {
      // Ignore if no process to kill
    }

    // Also try to kill by command line pattern
    try {
      execSync('wmic process where "name=\'node.exe\' and commandline like \'%cc-channel%daemon.js%\'" call terminate', {
        stdio: "ignore",
      });
    } catch {
      // Ignore errors
    }

    return {
      success: true,
      message: "Daemon stopped",
    };
  }

  return {
    success: false,
    message: "Unsupported platform",
  };
}

/**
 * Get daemon status
 */
export async function getDaemonStatus(): Promise<DaemonStatus> {
  const platformName = isMacOS ? "macos" : isLinux ? "linux" : isWindows ? "windows" : "unsupported";

  if (!isMacOS && !isLinux && !isWindows) {
    return {
      installed: false,
      running: false,
      platform: platformName,
    };
  }

  const installed = isDaemonInstalled();

  let running = false;

  if (isMacOS && installed) {
    try {
      const { execSync } = await import("child_process");
      const result = execSync(`launchctl print gui/${process.getuid?.() ?? ""}/${LAUNCH_AGENT_NAME}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      running = result.includes("state = running");
    } catch {
      running = false;
    }
  }

  if (isLinux && installed) {
    try {
      const { execSync } = await import("child_process");
      const result = execSync(`systemctl --user is-active ${SYSTEMD_SERVICE_NAME}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      running = result.trim() === "active";
    } catch {
      running = false;
    }
  }

  if (isWindows && installed) {
    try {
      const { execSync } = await import("child_process");
      // Use PowerShell to get running processes
      const psCommand = "Get-Process node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id";
      const result = execSync(`powershell -Command "${psCommand}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      // If we have any node processes, check if daemon is running
      // For simplicity, if there's any node process and our bat file exists, consider it running
      running = result.toString().trim().length > 0;
    } catch {
      running = false;
    }
  }

  return {
    installed,
    running,
    platform: platformName,
  };
}
