import mongoose from 'mongoose';
import { User } from '../models/User';
import { generateUniqueReferralCode } from '../utils/referralCode';

/**
 * Mevcut kullanıcılar için referans kodu oluşturur
 * Bu script sadece bir kez çalıştırılmalıdır
 */
async function addReferralCodesToExistingUsers() {
  try {
    // MongoDB bağlantısı
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/shortlink';
    await mongoose.connect(mongoUri);

    // Referans kodu olmayan kullanıcıları bul
    const usersWithoutReferralCode = await User.find({ 
      referralCode: { $exists: false } 
    });


    // Her kullanıcı için benzersiz referans kodu oluştur
    for (const user of usersWithoutReferralCode) {
      try {
        const referralCode = await generateUniqueReferralCode();
        await User.findByIdAndUpdate(user._id, { 
          referralCode,
          referralCount: 0 
        });
      } catch (error) {
        console.error(`✗ ${user.email} için referans kodu oluşturulamadı:`, error);
      }
    }

    
  } catch (error) {
    console.error('Hata oluştu:', error);
  } finally {
    await mongoose.disconnect();
  }
}

// Script'i çalıştır
if (require.main === module) {
  addReferralCodesToExistingUsers();
}

export default addReferralCodesToExistingUsers;
