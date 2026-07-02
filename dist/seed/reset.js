"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Danger: clears all operational data, keeping ONLY the Super Admin account.
 * Use to return a database to a clean post-bootstrap state.
 *   npm run reset   (reads MONGODB_URI from .env)
 */
const db_1 = require("../config/db");
const User_1 = require("../models/User");
const Branch_1 = require("../models/Branch");
const catalog_1 = require("../models/catalog");
const Project_1 = require("../models/Project");
const Task_1 = require("../models/Task");
const qa_1 = require("../models/qa");
const Attendance_1 = require("../models/Attendance");
const leave_1 = require("../models/leave");
const announcement_1 = require("../models/announcement");
const misc_1 = require("../models/misc");
const ActivityTick_1 = require("../models/ActivityTick");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
async function main() {
    await (0, db_1.connectDB)();
    const results = await Promise.all([
        Branch_1.Branch.deleteMany({}), Branch_1.Holiday.deleteMany({}),
        catalog_1.Category.deleteMany({}), catalog_1.Subcategory.deleteMany({}), catalog_1.WebsiteType.deleteMany({}), catalog_1.ServerModel.deleteMany({}),
        Project_1.Project.deleteMany({}), Task_1.Task.deleteMany({}), qa_1.ChecklistTemplate.deleteMany({}), qa_1.QaProcess.deleteMany({}),
        Attendance_1.Attendance.deleteMany({}), leave_1.LeaveRequest.deleteMany({}), leave_1.LeaveBalance.deleteMany({}),
        announcement_1.Announcement.deleteMany({}), announcement_1.AnnouncementRead.deleteMany({}),
        misc_1.Notification.deleteMany({}), misc_1.Session.deleteMany({}), misc_1.AuditLog.deleteMany({}),
        ActivityTick_1.ActivityTick.deleteMany({}), ActivityTick_1.Screenshot.deleteMany({}),
        User_1.User.deleteMany({ role: { $ne: 'superadmin' } }),
    ]);
    // also clear uploaded screenshot files on disk
    try {
        fs_1.default.rmSync(path_1.default.join(process.cwd(), 'uploads', 'screenshots'), { recursive: true, force: true });
    }
    catch { /* ignore */ }
    const removed = results.reduce((a, r) => a + (r.deletedCount || 0), 0);
    const superAdmins = await User_1.User.countDocuments({ role: 'superadmin' });

    await (0, db_1.disconnectDB)();
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=reset.js.map