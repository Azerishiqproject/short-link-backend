"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const User_1 = require("../models/User");
const referralCode_1 = require("../utils/referralCode");
/**
 * Mevcut kullanıcılar için referans kodu oluşturur
 * Bu script sadece bir kez çalıştırılmalıdır
 */
async function addReferralCodesToExistingUsers() {
    try {
        // MongoDB bağlantısı
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/shortlink';
        await mongoose_1.default.connect(mongoUri);
        // Referans kodu olmayan kullanıcıları bul
        const usersWithoutReferralCode = await User_1.User.find({
            referralCode: { $exists: false }
        });
        // Her kullanıcı için benzersiz referans kodu oluştur
        for (const user of usersWithoutReferralCode) {
            try {
                const referralCode = await (0, referralCode_1.generateUniqueReferralCode)();
                await User_1.User.findByIdAndUpdate(user._id, {
                    referralCode,
                    referralCount: 0
                });
            }
            catch (error) {
                console.error(`✗ ${user.email} için referans kodu oluşturulamadı:`, error);
            }
        }
    }
    catch (error) {
        console.error('Hata oluştu:', error);
    }
    finally {
        await mongoose_1.default.disconnect();
    }
}
// Script'i çalıştır
if (require.main === module) {
    addReferralCodesToExistingUsers();
}
exports.default = addReferralCodesToExistingUsers;
