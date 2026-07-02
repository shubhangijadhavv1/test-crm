"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Assigns a Category (vertical) + Subcategory (region) to every project that lacks one,
 * derived from the project name. Creates the catalog entries as needed. Idempotent.
 *   npx tsx src/seed/categorize-projects.ts
 */
const db_1 = require("../config/db");
const Project_1 = require("../models/Project");
const catalog_1 = require("../models/catalog");
const User_1 = require("../models/User");
function vertical(name) {
    const n = name.toLowerCase();
    if (/slot/.test(n))
        return 'Slots';
    if (/casino/.test(n))
        return 'Casino';
    if (/lotter/.test(n))
        return 'Lottery';
    if (/hotel|resort|stay|estate|retreat|manor|palace|palacio|grand|reserve|prive|haven|prestige|chteau|château|treehouse|nest/.test(n))
        return 'Hotel';
    if (/travel|trip|advisor|guide|radar|vacation|explore|planner/.test(n))
        return 'Travel Guide';
    if (/dating|cupid|love|romance/.test(n))
        return 'Dating';
    if (/spin|reel|riches|win|fortune|play|game|gam|bingo|wild|showdown|derby|leprechaun|alchemy|ticket|orbit|titan|verse|empire/.test(n))
        return 'Slots';
    return 'Other';
}
function region(name) {
    const n = name.toLowerCase();
    if (/\bindia|indian|punaquest|estancia/.test(n))
        return 'India';
    if (/finland|finnish|fin(slot|land|hotel)|helvetia|swiss|geneva|genev|lapland|nordic|arctic|aurora|borealis|saar|kaivola|norynth/.test(n))
        return 'Finland';
    if (/chile|andes|patagonia|cordoba|mendoza|tango|gaucho|litoral|argen|sur/.test(n))
        return 'Chile';
    if (/argentin|argan|argcasino|pampa/.test(n))
        return 'Argentina';
    if (/\baus|austral/.test(n))
        return 'Australia';
    return 'General';
}
async function main() {
    await (0, db_1.connectDB)();
    const sa = await User_1.User.findOne({ role: 'superadmin' }).lean();
    const by = sa?._id;
    const catCache = new Map(); // eslint-disable-line @typescript-eslint/no-explicit-any
    const subCache = new Map(); // eslint-disable-line @typescript-eslint/no-explicit-any
    async function catId(name) {
        if (catCache.has(name))
            return catCache.get(name);
        let c = await catalog_1.Category.findOne({ name, isDeleted: false }); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!c)
            c = await catalog_1.Category.create({ name, createdBy: by });
        catCache.set(name, c._id);
        return c._id;
    }
    async function subId(name, parent) {
        const key = `${parent}:${name}`;
        if (subCache.has(key))
            return subCache.get(key);
        let s = await catalog_1.Subcategory.findOne({ name, categoryId: parent, isDeleted: false }); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!s)
            s = await catalog_1.Subcategory.create({ name, categoryId: parent, createdBy: by });
        subCache.set(key, s._id);
        return s._id;
    }
    const projects = await Project_1.Project.find({ isDeleted: false }).select('_id name categoryId').lean();
    let updated = 0;
    for (const p of projects) {
        if (p.categoryId)
            continue;
        const cName = vertical(p.name);
        const rName = region(p.name);
        const cId = await catId(cName);
        const sId = await subId(rName, cId);
        await Project_1.Project.updateOne({ _id: p._id }, { $set: { categoryId: cId, subCategoryId: sId } });
        updated++;
    }
    await (0, db_1.disconnectDB)();
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=categorize-projects.js.map