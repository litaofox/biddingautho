// 内存存储模块 - 无数据库架构
import type { Task } from "../types.js";

const store = new Map<string, Task>();
const SESSION_TTL = 30 * 60 * 1000; // 30 分钟

// 定时清理过期会话（基于最后访问时间，活跃会话自动续期）
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of store) {
    const last = task.lastAccessedAt ?? task.createdAt;
    if (now - last > SESSION_TTL) {
      store.delete(id);
      console.log(`[store] session ${id} expired and removed`);
    }
  }
}, 5 * 60 * 1000); // 每 5 分钟清理一次

export function createTask(sessionId: string): Task {
  const task: Task = {
    sessionId,
    procurement: null as any,
    bidders: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  };
  store.set(sessionId, task);
  return task;
}

export function getTask(sessionId: string): Task | undefined {
  const task = store.get(sessionId);
  if (task) {
    task.lastAccessedAt = Date.now(); // 活跃访问续期
  }
  return task;
}

export function updateTask(sessionId: string, patch: Partial<Task>): Task | undefined {
  const task = store.get(sessionId);
  if (!task) return undefined;
  Object.assign(task, patch);
  task.lastAccessedAt = Date.now(); // 活跃写入续期
  return task;
}

export function deleteTask(sessionId: string): boolean {
  return store.delete(sessionId);
}
