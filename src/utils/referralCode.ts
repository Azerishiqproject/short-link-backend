import { User } from "../models/User";

/**
 * 6 karakterli benzersiz referans kodu oluşturur
 * Format: 3 harf + 3 rakam (örn: ABC123)
 */
export function generateReferralCode(): string {
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
export async function generateUniqueReferralCode(): Promise<string> {
  let code: string;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;
  
  do {
    code = generateReferralCode();
    const existingUser = await User.findOne({ referralCode: code });
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
export async function validateReferralCode(referralCode: string): Promise<{ isValid: boolean; referrer?: any }> {
  if (!referralCode || referralCode.length !== 6) {
    return { isValid: false };
  }
  
  const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
  
  if (!referrer) {
    return { isValid: false };
  }
  
  return { isValid: true, referrer };
}
