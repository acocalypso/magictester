import { spawn } from "node:child_process";
process.chdir(process.env.FORGE_CANDIDATE_HOME);
// Both processes hold the staging directory; Windows must release both before
// cleanup can remove it. This is a process-lifecycle check, not a simulated game.
const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: process.cwd(), stdio: "ignore" });
console.log(JSON.stringify({ event: "setup_lock_ready", pid: process.pid, childPid: child.pid }));
setInterval(() => {}, 1000);
