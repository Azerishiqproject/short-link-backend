import mongoose, { Schema, InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    passwordSalt: { type: String, required: false },
    name: { type: String },
    role: { type: String, enum: ["user", "admin", "advertiser"], default: "user" },
    available_balance: { type: Number, default: 0 },
    reserved_balance: { type: Number, default: 0 },
    earned_balance: { type: Number, default: 0 }, // Kullanıcıların kazandığı ama henüz çekmediği para
    reserved_earned_balance: { type: Number, default: 0 }, // Çekim isteği için rezerve edilen para
    referral_earned: { type: Number, default: 0 }, // Referans sistemi ile kazanılan para
    reserved_referral_earned: { type: Number, default: 0 }, // Referans kazancı çekim isteği için rezerve edilen para
    // Çekim istekleri için oran sınırlaması
    lastWithdrawalAt: { type: Date, required: false },
    // Referans sistemi
    referralCode: { type: String, required: true, unique: true, index: true }, // 6 karakterli benzersiz referans kodu
    referredBy: { type: Schema.Types.ObjectId, ref: 'User', required: false }, // Kim tarafından referans edildi
    referralCount: { type: Number, default: 0 }, // Kaç kişi bu kullanıcının referansıyla kayıt oldu
    // IBAN bilgileri
    iban: { type: String, required: false, maxlength: 26 },
    fullName: { type: String, required: false, maxlength: 100 },
    paymentDescription: { type: String, required: false, maxlength: 100 },
    // Security/telemetry
    registrationIp: { type: String, required: false },
    registrationDeviceId: { type: String, required: false },
    lastLoginIp: { type: String, required: false },
    deviceIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

export const User = mongoose.models.User || mongoose.model("User", userSchema);


