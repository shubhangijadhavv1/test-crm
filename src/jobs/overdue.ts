import { Task } from '../models/Task'
import { notify } from '../utils/notify'
import { emitScoped } from '../realtime/socket'
import { cacheClear } from '../utils/cache'
import { finalizeStaleSessions } from '../agent/session'

const INTERVAL_MS = 5 * 60_000 // every 5 minutes
let running = false

/**
 * Transition past-due open tasks to `overdue` (Blueprint M6). A task is overdue when
 * its dueAt has passed and it is still todo/inprogress. Stops any running timer,
 * notifies the assignee + assigner, pushes a scoped realtime event, and busts the
 * dashboard cache so counters reflect it immediately.
 */
export async function sweepOverdue(): Promise<number> {
  if (running) return 0
  running = true
  try {
    const now = new Date()
    const due = await Task.find({
      isDeleted: false,
      status: { $in: ['todo', 'inprogress'] },
      dueAt: { $lt: now },
    })
    let changed = 0
    for (const task of due) {
      const timer = task.timer
      if (timer?.running && timer.startedAt) {
        timer.accumulatedSeconds = (timer.accumulatedSeconds || 0) + Math.floor((now.getTime() - new Date(timer.startedAt).getTime()) / 1000)
        timer.running = false
        timer.startedAt = undefined as never
        task.timer = timer
      }
      task.status = 'overdue' as never
      await task.save()
      changed++
      emitScoped('task:moved', { id: task._id, status: 'overdue' }, { branchId: task.branchId, userId: task.assigneeId })
      if (task.assigneeId) await notify(String(task.assigneeId), { type: 'task.overdue', title: 'Task overdue', body: task.title, color: 'bad', link: '/kanban' })
      if (task.assignerId && String(task.assignerId) !== String(task.assigneeId)) {
        await notify(String(task.assignerId), { type: 'task.overdue', title: 'Assigned task overdue', body: task.title, color: 'bad', link: '/kanban' })
      }
    }
    if (changed) cacheClear('dashboard')
    return changed
  } finally {
    running = false
  }
}

/**
 * Deadline reminders (Blueprint M6 / M13): notify the assignee once when a task is
 * due within the next 24h and still open. `reminderSentAt` prevents repeat pings.
 */
export async function sweepReminders(): Promise<number> {
  const now = new Date()
  const soon = new Date(now.getTime() + 24 * 60 * 60_000)
  const upcoming = await Task.find({
    isDeleted: false,
    status: { $in: ['todo', 'inprogress'] },
    dueAt: { $gte: now, $lte: soon },
    reminderSentAt: { $exists: false },
  })
  for (const task of upcoming) {
    if (task.assigneeId) await notify(String(task.assigneeId), { type: 'task.reminder', title: 'Task due soon', body: `${task.title} is due within 24 hours`, color: 'warn', link: '/kanban' })
    task.reminderSentAt = now as never
    await task.save()
  }
  return upcoming.length
}

/** Start the periodic sweeps: overdue tasks, deadline reminders, and stale agent sessions. */
export function startOverdueJob(): NodeJS.Timeout {
  const run = () => {
    sweepOverdue().catch(() => {})
    sweepReminders().catch(() => {})
    finalizeStaleSessions().catch(() => {})
  }
  run()
  const handle = setInterval(run, INTERVAL_MS)
  handle.unref?.()
  return handle
}
