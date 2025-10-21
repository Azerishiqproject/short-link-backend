"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReferralCode = generateReferralCode;
exports.generateUniqueReferralCode = generateUniqueReferralCode;
exports.validateReferralCode = validateReferralCode;
const User_1 = require("../models/User");
/**
 * 6 karakterli benzersiz referans kodu oluşturur
 * Format: 3 harf + 3 rakam (örn: ABC123)
 */
function generateReferralCode() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    let code = '';
    // 3 harf ekle
    for (let i = 0; i < 3; i++) {
        code += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    // 3 rakam ekle
    for (let i = 0; i < 3; i++) {
        code += numbers.charAt(Math.floor(Math.random() * numbers.length));
    }
    return code;
}
/**
 * Benzersiz referans kodu oluşturur ve veritabanında kontrol eder
 */
async function generateUniqueReferralCode() {
    let code;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;
    do {
        code = generateReferralCode();
        const existingUser = await User_1.User.findOne({ referralCode: code });
        isUnique = !existingUser;
        attempts++;
        if (attempts >= maxAttempts) {
            throw new Error('Benzersiz referans kodu oluşturulamadı');
        }
    } while (!isUnique);
    return code;
}
/**
 * Referans kodunu doğrular ve referans eden kullanıcıyı bulur
 */
async function validateReferralCode(referralCode) {
    if (!referralCode || referralCode.length !== 6) {
        return { isValid: false };
    }
    const referrer = await User_1.User.findOne({ referralCode: referralCode.toUpperCase() });
    if (!referrer) {
        return { isValid: false };
    }
    return { isValid: true, referrer };
}
