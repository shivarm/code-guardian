import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (!isMainThread) {
  // runs inside the isolated worker thread
  const { line, pattern, flags } = workerData;
  try {
    const regex = new RegExp(pattern, flags || "g");
    const matched = regex.test(line);
    parentPort.postMessage({ success: true, matched });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
}

/* 
 * runs on main thread
 */
export function matchWithTimeout(line, rule, timeoutMs = 50) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { line, pattern: rule.pattern, flags: rule.flags },
    });

    // Kill the thread if it takes too long
    const timeout = setTimeout(() => {
      worker.terminate();
      resolve(false);
    }, timeoutMs);

    worker.on("message", (msg) => {
      clearTimeout(timeout);
      worker.terminate();
      if (msg.success) {
        resolve(msg.matched);
      } else {
        resolve(false);
      }
    });

    worker.on("error", () => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(false);
    });
  });
}
