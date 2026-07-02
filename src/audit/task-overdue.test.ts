/**
 * Overdue sweep test (C5): a past-due open task is transitioned to `overdue`, with cleanup.
 *   npx tsx src/audit/task-overdue.test.ts
 */
import { connectDB, disconnectDB } from '../config/db'
import { Task } from '../models/Task'
import { Notification } from '../models/misc'
import { sweepOverdue } from '../jobs/overdue'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++;  }

async function main() {

  await connectDB()

  const past = new Date(Date.now() - 86_400_000) // yesterday
  const future = new Date(Date.now() + 86_400_000)
  const tag = Date.now()
  const overdueId = (await Task.create({ title: `OD past ${tag}`, status: 'todo', dueAt: past, timer: { running: true, startedAt: past, accumulatedSeconds: 10 } }))._id
  const freshId = (await Task.create({ title: `OD future ${tag}`, status: 'todo', dueAt: future }))._id
  const doneId = (await Task.create({ title: `OD done ${tag}`, status: 'done', dueAt: past }))._id

  const changed = await sweepOverdue()
  check('sweep reported ≥1 change', changed >= 1, `changed=${changed}`)

  const od = await Task.findById(overdueId).lean()
  check('past-due open task → overdue', od?.status === 'overdue', `status=${od?.status}`)
  check('running timer stopped + accumulated', od?.timer?.running === false && (od?.timer?.accumulatedSeconds || 0) > 10, `acc=${od?.timer?.accumulatedSeconds}`)

  const fresh = await Task.findById(freshId).lean()
  check('future-due task untouched', fresh?.status === 'todo')

  const done = await Task.findById(doneId).lean()
  check('completed task untouched', done?.status === 'done')

  // ---- cleanup ----
  await Task.deleteMany({ _id: { $in: [overdueId, freshId, doneId] } })
  await Notification.deleteMany({ type: 'task.overdue', body: `OD past ${tag}` })
  await disconnectDB()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
