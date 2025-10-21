import mongoose, { Schema, InferSchemaType } from "mongoose";

const referralSettingsSchema = new Schema(
  {
    // Referans sistemi aktif mi?
    isActive: { type: Boolean, default: true },
    
    // Referans eden kişiye verilecek yüzde (0-100)
    referrerPercentage: { type: Number, default: 10, min: 0, max: 100 },
    
    // Minimum referans kazanç miktarı
    minReferralEarning: { type: Number, default: 0.01 },
    
    // Maksimum referans kazanç miktarı (0 = sınırsız)
    maxReferralEarning: { type: Number, default: 0 },
    
    
    // Admin notları
    adminNotes: { type: String, maxlength: 500 },
    
    // Son güncelleme yapan admin
    lastUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    
    // Sistem durumu
    status: { 
      type: String, 
      enum: ["active", "paused", "maintenance"], 
      default: "active" 
    }
  },
  { timestamps: true }
);

export type ReferralSettingsDocument = InferSchemaType<typeof referralSettingsSchema> & { 
  _id: mongoose.Types.ObjectId 
};

export const ReferralSettings = mongoose.models.ReferralSettings || mongoose.model("ReferralSettings", referralSettingsSchema);
