"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
exports.disconnectDB = disconnectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
let memoryServer = null;
/**
 * Connect to MongoDB. If MONGODB_URI is set, use it (local mongod / Atlas).
 * Otherwise spin up an in-memory MongoDB so the API runs with zero setup.
 */
async function connectDB() {
    let uri = env_1.env.mongoUri;
    let inMemory = false;
    if (!uri) {
        // Lazy import so production builds without the dev dependency still work.
        const { MongoMemoryServer } = await Promise.resolve().then(() => __importStar(require('mongodb-memory-server')));
        const mem = await MongoMemoryServer.create();
        uri = mem.getUri('gdc-crm');
        memoryServer = mem;
        inMemory = true;
    }
    mongoose_1.default.set('strictQuery', true);
    await mongoose_1.default.connect(uri);
    return { uri, inMemory };
}
async function disconnectDB() {
    await mongoose_1.default.disconnect();
    if (memoryServer)
        await memoryServer.stop();
}
//# sourceMappingURL=db.js.map