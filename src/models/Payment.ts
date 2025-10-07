import mongoose, { Schema, InferSchemaType } from "mongoose";

const paymentSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "TRY" },
    method: { type: String, default: "credit_card" },
    description: { type: String },
    status: { type: String, enum: ["pending", "paid", "failed", "refunded", "approved", "rejected"], default: "pending", index: true },
    category: { type: String, enum: ["payment", "withdrawal", "earning"], default: "payment", index: true },
    audience: { type: String, enum: ["user", "advertiser"], default: "advertiser", index: true },
    metadata: { type: Schema.Types.Mixed },
    // Kullanıcı çekimleri için ek alanlar
    iban: { type: String, required: false, maxlength: 26 },
    fullName: { type: String, required: false, maxlength: 100 },
    adminNotes: { type: String, required: false, maxlength: 500 }, // Admin notları
  },
  { timestamps: true }
);

export type PaymentDocument = InferSchemaType<typeof paymentSchema> & { _id: mongoose.Types.ObjectId };

export const Payment = mongoose.models.Payment || mongoose.model("Payment", paymentSchema);


