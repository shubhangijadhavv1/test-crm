"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSuperAdmin = ensureSuperAdmin;
const User_1 = require("../models/User");
const env_1 = require("../config/env");
const password_1 = require("../utils/password");
const access_1 = require("../utils/access");
/**
 * Idempotent bootstrap (Blueprint D2.2): ensure ONE Super Admin exists so the
 * app is usable on an empty database. Creates no demo data and never wipes.
 * Safe to run against a live/production database.
 */
async function ensureSuperAdmin() {
    const email = env_1.env.seed.superAdminEmail.toLowerCase();
    const passwordHash = await (0, password_1.hashPassword)(env_1.env.seed.superAdminPassword);
    const existing = await User_1.User.findOne({ role: 'superadmin', isDeleted: false });
    if (existing) {
        await User_1.User.updateOne({ _id: existing._id }, { email, passwordHash });
        return { created: false, email };
    }
    await User_1.User.create({
        fullName: 'Super Admin',
        email,
        passwordHash,
        employeeId: 'GDC-0001',
        role: 'superadmin',
        department: 'Management',
        designation: 'Super Admin',
        workMode: 'hybrid',
        moduleAccess: (0, access_1.defaultModuleAccess)('superadmin'),
    });
    return { created: true, email };
}
//# sourceMappingURL=bootstrap.js.map