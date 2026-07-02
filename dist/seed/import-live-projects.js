"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * One-off importer for the real Live Projects list (idempotent — re-running updates).
 *   npx tsx src/seed/import-live-projects.ts
 * Creates the referenced employees, website types & servers, then the projects with
 * status + a QA process carrying the QA1/QA2 percentages.
 */
const db_1 = require("../config/db");
const User_1 = require("../models/User");
const catalog_1 = require("../models/catalog");
const Project_1 = require("../models/Project");
const qa_1 = require("../models/qa");
const password_1 = require("../utils/password");
const DATA = [
    ['Mysticfrontierworld.com', 'https://mysticfrontierworld.com/', 'React js', 'Serverxdomain.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-06-16'],
    ['Spintitan.com', 'https://spintitan.com/', 'React js', 'Serverxdomain.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-16'],
    ['Slotorbitx.com', 'https://slotorbitx.com/', 'React js', 'Serverxdomain.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-16'],
    ['Crimsonaurora.com', 'https://crimsonaurora.com/', 'React js', 'Serverxdomain.com', 'Prasad Sontakke', 'high', 'completed', 100, 100, '2026-06-13'],
    ['Explorexa.com', 'https://explorexa.com/', 'React js', 'Serverxdomain.com', 'Prasad Sontakke', 'high', 'completed', 100, 100, '2026-06-13'],
    ['Playfinityx.com', 'https://playfinityx.com/', 'React js', 'Serverxdomain.com', 'Prasad Sontakke', 'high', 'completed', 100, 100, '2026-06-13'],
    ['Reelrushplay.com', 'https://reelrushplay.com/', 'React js', 'Serverxdomain.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-15'],
    ['Aurexaio.com', 'https://aurexaio.com/', 'React js', 'Serverxdomain.com', 'Prasad Sontakke', 'high', 'completed', 100, 100, '2026-06-13'],
    ['Luckyspinverse.com', 'https://luckyspinverse.com/', 'React js', 'Serverxdomain.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-15'],
    ['Slotempirex.com', 'https://slotempirex.com/', 'React js', 'Serverxdomain.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-06-15'],
    ['Gampiq.com', 'https://gampiq.com/', 'Wordpress Classic', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-03'],
    ['Velcrion.com', 'https://velcrion.com/', 'React js', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-04'],
    ['Estanciarush.com', 'http://estanciarush.com/', 'React js', 'wpserversingapore1', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-06-08'],
    ['Socialfunverse.com', 'https://socialfunverse.com/', 'React js', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-03'],
    ['funorbitworld.com', 'https://funorbitworld.com/', 'React js', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-08'],
    ['Demonvex.com', 'https://demonvex.com/', 'React js', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-04'],
    ['Obsivora.com', 'https://obsivora.com/', 'React js', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-03'],
    ['Spinvexa.com', 'https://spinvexa.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-04'],
    ['Swissfortunex.com', 'https://swissfortunex.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-03'],
    ['Slotverse360.com', 'https://slotverse360.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-03'],
    ['Neospinclub.com', 'https://neospinclub.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-03'],
    ['Reelinity.com', 'https://reelinity.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 95, '2026-06-03'],
    ['Futuristicplayverse.com', 'https://futuristicplayverse.com/', 'WordPress-(Uicore)', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-02'],
    ['Reelzeno.com', 'https://reelzeno.com/', 'React js', 'wpserveramsterdam1.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-02'],
    ['Crownslotclub.com', 'https://crownslotclub.com/', 'React js', 'wpserveramsterdam1.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-02'],
    ['Helvetiaspin.com', 'https://helvetiaspin.com/', 'React js', 'wpserveramsterdam1.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-02'],
    ['Genevareels.com', 'https://genevareels.com/', 'React js', 'wpserveramsterdam1.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 89, '2026-06-02'],
    ['UrichSlots.com', 'https://urichslots.com/', 'React js', 'wpserveramsterdam1.com', 'Shubhangi Jadhav', 'high', 'completed', 100, 100, '2026-06-01'],
    ['Nextgenplayzone.com', 'https://nextgenplayzone.com/', 'WordPress-(Uicore)', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-02'],
    ['Slotmahotsav.com', 'https://slotmahotsav.com/', 'WordPress-(Uicore)', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-02'],
    ['Spinsx360in.com', 'https://spinsx360in.com/', 'WordPress-(Uicore)', 'wpserversingapore1', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-06-01'],
    ['Punaquest.com', 'https://punaquest.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'finished', 100, 89, '2026-05-18'],
    ['Argenglider.com', 'https://argenglider.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-05-12'],
    ['Litoralplay.com', 'https://litoralplay.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'finished', 100, 92, '2026-05-11'],
    ['Andesglider.com', 'https://andesglider.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-05-11'],
    ['Tangospin.com', 'https://tangospin.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-05-09'],
    ['Mendozaquest.com', 'https://mendozaquest.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-05-08'],
    ['Estanciaplay.com', 'https://estanciaplay.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-05-05'],
    ['Patagoniaspin.com', 'https://patagoniaspin.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-05-05'],
    ['Cordobarush.com', 'https://cordobarush.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'finished', 100, 89, '2026-05-05'],
    ['Gauchoquest.com', 'https://gauchoquest.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-05-05'],
    ['Luzdelsurgames.com', 'https://luzdelsurgames.com/', 'React js', 'wpserverlondon1.com', 'Shubhangi Jadhav', 'medium', 'completed', 100, 100, '2026-05-05'],
    ['Rabbitholeriches.com', 'https://rabbitholeriches.com/', 'Wordpress + Elementor', 'wpserveramsterdam2.com', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-03-25'],
    ['Winabeast.com', 'https://winabeast.com', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-13'],
    ['RainforestMagicBingo.com', 'https://rainforestmagicbingo.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-16'],
    ['Rally4Riches.com', 'https://rally4riches.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-17'],
    ['Goldenticket2.com', 'https://goldenticket2.com', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-12'],
    ['DivineShowdown.com', 'https://divineshowdown.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-04'],
    ['WildhoundDerby.com', 'https://wildhoundderby.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-02'],
    ['LeprechaunGoesWild.com', 'https://leprechaungoeswild.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-02-28'],
    ['Coywolfcash.com', 'https://coywolfcash.com', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-02-27'],
    ['SweetAlchemyBingo.com', 'https://sweetalchemybingo.com/', 'React js', 'wpserveramsterdam2.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-02-26'],
    ['Advertising-solutionsllc.com', 'https://advertising-solutionsllc.com/', 'HTML', '', 'Prasad Sontakke', 'high', 'completed', 100, 100, '2026-05-22'],
    ['Bestdatingplatformslist.com', 'https://bestdatingplatformslist.com/', 'Wordpress + Elementor', 'wpserverlondon1.com', 'Prasad Sontakke', 'high', 'completed', 100, 100, '2026-04-24'],
    ['Datingplatformsreview.com', 'https://datingplatformsreview.com/', 'Wordpress + Elementor', 'wpserveramsterdam2.com', 'Prasad Sontakke', 'high', 'completed', 100, 88, '2026-04-25'],
    ['Cupidtoplist.com', 'https://cupidtoplist.com/', 'Wordpress + Elementor', 'wpserveramsterdam1.com', 'Prasad Sontakke', 'high', 'completed', 100, 100, '2026-04-24'],
    ['Loverankboard.com', 'https://loverankboard.com/', 'Wordpress + Elementor', 'Super Dedicated', 'Prasad Sontakke', 'high', 'completed', 100, 100, '2026-04-24'],
    ['Elitedatinglist.com', 'https://elitedatinglist.com/', 'Wordpress + Elementor', 'wpdserverchile1.com', 'Sanket Rangire', 'medium', 'pending', 100, 0, '2026-04-25'],
    ['AndesTravelAdvisor.com', 'https://andestraveladvisor.com/', 'Wordpress Classic', 'wpdserverchile1.com', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-03-28'],
    ['PlanYourAndesTrip.com', 'https://planyourandestrip.com/', 'Wordpress + Elementor', 'wpdserverchile1.com', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-03-30'],
    ['Vistablissstay.com', 'https://vistablissstay.com/', 'React js', 'wpdserverchile1.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-30'],
    ['Velorastayhotel.com', 'https://velorastayhotel.com/', 'React js', 'wpdserverchile1.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-31'],
    ['ChileTravelRadar.com', 'https://chiletravelradar.com/', 'Wordpress + Elementor', 'wpdserverchile1.com', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-04-01'],
    ['SereneNestHotel.com', 'https://serenenesthotel.com/', 'Wordpress Classic', 'wpdserverchile1.com', 'Prasad Sontakke', 'high', 'live', 100, 94, '2026-04-01'],
    ['goldenpalmsuites.com', 'https://goldenpalmsuites.com/', 'React js', 'wpdserverchile1.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-27'],
    ['Palmvistaretreat.com', 'https://palmvistaretreat.com/', 'React js', 'wpdserverchile1.com', 'Shubhangi Jadhav', 'medium', 'live', 100, 100, '2026-03-28'],
    ['AndesVacationPlanner.com', 'https://andesvacationplanner.com/', 'Wordpress Classic', 'wpdserverchile1.com', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-03-30'],
    ['ExploreChileGuide.com', 'https://explorechileguide.com/', 'Wordpress Classic', 'wpdserverchile1.com', 'Prasad Sontakke', 'high', 'live', 100, 100, '2026-03-27'],
];
async function main() {
    await (0, db_1.connectDB)();
    const sa = await User_1.User.findOne({ role: 'superadmin' }).lean();
    const by = sa?._id;
    // employees
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const empCache = new Map();
    let empSeq = await User_1.User.countDocuments({ role: 'employee' });
    for (const name of [...new Set(DATA.map(r => r[4]))]) {
        let u = await User_1.User.findOne({ fullName: name, isDeleted: false });
        if (!u) {
            const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@gdc.com';
            empSeq++;
            u = await User_1.User.create({ fullName: name, email, employeeId: `EMP-${String(empSeq).padStart(4, '0')}`, passwordHash: await (0, password_1.hashPassword)('Welcome@123'), role: 'employee', department: 'Development', designation: 'Web Developer', createdBy: by });
        }
        empCache.set(name, u._id);
    }
    // website types
    const wtCache = new Map();
    for (const name of [...new Set(DATA.map(r => r[2]))].filter(Boolean)) {
        let w = await catalog_1.WebsiteType.findOne({ name, isDeleted: false });
        if (!w)
            w = await catalog_1.WebsiteType.create({ name, createdBy: by });
        wtCache.set(name, w._id);
    }
    // servers
    const srvCache = new Map();
    for (const name of [...new Set(DATA.map(r => r[3]))].filter(Boolean)) {
        let s = await catalog_1.ServerModel.findOne({ name, isDeleted: false });
        if (!s)
            s = await catalog_1.ServerModel.create({ name, createdBy: by });
        srvCache.set(name, s._id);
    }
    let created = 0, updated = 0;
    let seq = await Project_1.Project.countDocuments({ type: 'live' });
    for (const [name, url, tech, server, assignee, priority, status, qa1, qa2, due] of DATA) {
        const fields = {
            type: 'live', name, url,
            websiteTypeId: wtCache.get(tech), serverId: server ? srvCache.get(server) : undefined,
            ownerId: empCache.get(assignee), priority, status,
            qaProgress: Math.round((qa1 + qa2) / 2), dueDate: new Date(due),
            createdBy: by, updatedBy: by,
        };
        let proj = await Project_1.Project.findOne({ name, type: 'live', isDeleted: false });
        if (proj) {
            Object.assign(proj, fields);
            await proj.save();
            updated++;
        }
        else {
            seq++;
            proj = await Project_1.Project.create({ ...fields, projectCode: `LIV-${String(seq).padStart(4, '0')}` });
            created++;
        }
        // QA process with the QA1/QA2 percentages
        const state = qa1 >= 100 && qa2 >= 100 ? 'passed' : qa1 >= 100 ? 'stage2_inprogress' : 'stage1';
        const stage = (p) => ({ progress: p, status: p >= 100 ? 'done' : p > 0 ? 'inprogress' : 'notstarted', reviewerId: empCache.get(assignee) });
        await qa_1.QaProcess.findOneAndUpdate({ projectId: proj._id }, { projectId: proj._id, stage1: stage(qa1), stage2: stage(qa2), state, updatedBy: by }, { upsert: true, new: true, setDefaultsOnInsert: true });
    }
    console.log(`[import] live projects → created ${created}, updated ${updated} · total ${DATA.length}`);
    await (0, db_1.disconnectDB)();
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=import-live-projects.js.map