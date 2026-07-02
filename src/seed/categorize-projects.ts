/**
 * Assigns a Category (vertical) + Subcategory (region) to every project that lacks one,
 * derived from the project name. Creates the catalog entries as needed. Idempotent.
 *   npx tsx src/seed/categorize-projects.ts
 */
import { connectDB, disconnectDB } from '../config/db'
import { Project } from '../models/Project'
import { Category, Subcategory } from '../models/catalog'
import { User } from '../models/User'

function vertical(name: string): string {
  const n = name.toLowerCase()
  if (/slot/.test(n)) return 'Slots'
  if (/casino/.test(n)) return 'Casino'
  if (/lotter/.test(n)) return 'Lottery'
  if (/hotel|resort|stay|estate|retreat|manor|palace|palacio|grand|reserve|prive|haven|prestige|chteau|château|treehouse|nest/.test(n)) return 'Hotel'
  if (/travel|trip|advisor|guide|radar|vacation|explore|planner/.test(n)) return 'Travel Guide'
  if (/dating|cupid|love|romance/.test(n)) return 'Dating'
  if (/spin|reel|riches|win|fortune|play|game|gam|bingo|wild|showdown|derby|leprechaun|alchemy|ticket|orbit|titan|verse|empire/.test(n)) return 'Slots'
  return 'Other'
}

function region(name: string): string {
  const n = name.toLowerCase()
  if (/\bindia|indian|punaquest|estancia/.test(n)) return 'India'
  if (/finland|finnish|fin(slot|land|hotel)|helvetia|swiss|geneva|genev|lapland|nordic|arctic|aurora|borealis|saar|kaivola|norynth/.test(n)) return 'Finland'
  if (/chile|andes|patagonia|cordoba|mendoza|tango|gaucho|litoral|argen|sur/.test(n)) return 'Chile'
  if (/argentin|argan|argcasino|pampa/.test(n)) return 'Argentina'
  if (/\baus|austral/.test(n)) return 'Australia'
  return 'General'
}

async function main() {
  await connectDB()
  const sa = await User.findOne({ role: 'superadmin' }).lean()
  const by = sa?._id

  const catCache = new Map<string, any>() // eslint-disable-line @typescript-eslint/no-explicit-any
  const subCache = new Map<string, any>() // eslint-disable-line @typescript-eslint/no-explicit-any

  async function catId(name: string) {
    if (catCache.has(name)) return catCache.get(name)
    let c: any = await Category.findOne({ name, isDeleted: false }) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!c) c = await Category.create({ name, createdBy: by })
    catCache.set(name, c._id)
    return c._id
  }
  async function subId(name: string, parent: unknown) {
    const key = `${parent}:${name}`
    if (subCache.has(key)) return subCache.get(key)
    let s: any = await Subcategory.findOne({ name, categoryId: parent, isDeleted: false }) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!s) s = await Subcategory.create({ name, categoryId: parent, createdBy: by })
    subCache.set(key, s._id)
    return s._id
  }

  const projects = await Project.find({ isDeleted: false }).select('_id name categoryId').lean()
  let updated = 0
  for (const p of projects) {
    if (p.categoryId) continue
    const cName = vertical(p.name)
    const rName = region(p.name)
    const cId = await catId(cName)
    const sId = await subId(rName, cId)
    await Project.updateOne({ _id: p._id }, { $set: { categoryId: cId, subCategoryId: sId } })
    updated++
  }

  await disconnectDB()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
