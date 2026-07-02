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
    const existing = await User_1.User.findOne({ role: 'superadmin', isDeleted: false }).lean();
    if (existing)
        return { created: false, email: existing.email || email };
    const passwordHash = await (0, password_1.hashPassword)(env_1.env.seed.superAdminPassword);
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