import mongoose, { Schema, InferSchemaType } from "mongoose";

const referralTransactionSchema = new Schema(
  {
    // Referans eden kullanıcı
    referrer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    
    // Referans edilen kullanıcı
    referee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    
    // İşlem türü
    action: { 
      type: String, 
      enum: ["registration", "click"],
      required: true 
    },
    
    // Kazanç miktarı
    amount: { type: Number, required: true, min: 0 },
    
    // Yüzde oranı
    percentage: { type: Number, required: true, min: 0, max: 100 },
    
    // Hangi işlemden kazanç elde edildi (link ID, kampanya ID vb.)
    sourceId: { type: String },
    sourceType: { 
      type: String, 
      enum: ["link", "campaign", "registration", "other"] 
    },
    
    // İşlem durumu
    status: { 
      type: String, 
      enum: ["pending", "completed", "cancelled", "refunded"], 
      default: "pending" 
    },
    
    // Ödeme durumu
    paymentStatus: { 
      type: String, 
      enum: ["pending", "paid", "failed"], 
      default: "pending" 
    },
    
    // Ödeme tarihi
    paidAt: { type: Date },
    
    // Admin notları
    adminNotes: { type: String, maxlength: 500 },
    
    // İşlem açıklaması
    description: { type: String, maxlength: 200 }
  },
  { timestamps: true }
);

// Index'ler
referralTransactionSchema.index({ referrer: 1, createdAt: -1 });
referralTransactionSchema.index({ referee: 1, createdAt: -1 });
referralTransactionSchema.index({ status: 1 });
referralTransactionSchema.index({ paymentStatus: 1 });

export type ReferralTransactionDocument = InferSchemaType<typeof referralTransactionSchema> & { 
  _id: mongoose.Types.ObjectId 
};

export const ReferralTransaction = mongoose.models.ReferralTransaction || mongoose.model("ReferralTransaction", referralTransactionSchema);
